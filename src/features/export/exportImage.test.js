import { describe, expect, test, vi } from "vitest";
import {
  createExportPlan,
  decodeOriginalSource,
  isSafeExport,
  renderProjectFrameToBlob,
  renderProjectToBlob,
} from "./exportImage.js";
import { applyEffectStack } from "../filters/effectStack.js";

describe("export planning", () => {
  test("creates exact 2x output dimensions", () => {
    expect(createExportPlan({ width: 1080, height: 1350 }, 2, false)).toEqual({
      width: 2160,
      height: 2700,
      includeBackground: true,
      estimatedBytes: 2160 * 2700 * 4,
    });
  });

  test("creates transparent overlay plans", () => {
    expect(createExportPlan({ width: 1080, height: 1350 }, 1, true).includeBackground).toBe(false);
  });

  test("rejects invalid dimensions and clamps scales", () => {
    expect(() => createExportPlan({ width: 0, height: 100 }, 1)).toThrow(/尺寸/);
    expect(createExportPlan({ width: 100, height: 100 }, 0).width).toBe(100);
    expect(createExportPlan({ width: 100, height: 100 }, 8).width).toBe(400);
  });

  test("marks large plans unsafe before allocation", () => {
    expect(isSafeExport({ width: 20_000, height: 20_000, estimatedBytes: 1_600_000_000 })).toBe(false);
    expect(isSafeExport({ width: 100, height: 100, estimatedBytes: 40_000 }, 4)).toBe(true);
  });
});

describe("composition export", () => {
  test("does not dispose borrowed editor image bitmaps", async () => {
    const borrowed = { width: 2, height: 2, close: vi.fn() };
    const decoded = await decodeOriginalSource({ source: borrowed });
    decoded.dispose();
    expect(borrowed.close).not.toHaveBeenCalled();
  });

  test("falls back to an owned object-url image when bitmap decode rejects", async () => {
    const originalBitmap = globalThis.createImageBitmap;
    const originalImage = globalThis.Image;
    const originalUrl = globalThis.URL;
    const revoke = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("unsupported")));
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: revoke });
    class FakeImage {
      naturalWidth = 2;
      naturalHeight = 2;
      set src(value) { this.url = value; queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("Image", FakeImage);
    const decoded = await decodeOriginalSource({ originalFile: new Blob(["x"]) });
    decoded.dispose();
    expect(revoke).toHaveBeenCalledWith("blob:test");
    vi.stubGlobal("createImageBitmap", originalBitmap);
    vi.stubGlobal("Image", originalImage);
    vi.stubGlobal("URL", originalUrl);
  });

  test("renders transparent overlays without drawing the source", async () => {
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
      setLineDash: vi.fn(),
      canvas: { width: 100, height: 100 },
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (callback, type) => callback(new Blob([type], { type })),
    };
    vi.stubGlobal("document", { createElement: () => canvas });

    const blob = await renderProjectToBlob({
      project: {
        canvas: { width: 100, height: 100 },
        filters: {},
        layers: [],
      },
      sourceBitmap: { width: 100, height: 100 },
      transparentOverlay: true,
      scale: 1,
      format: "png",
    });

    expect(blob.type).toBe("image/png");
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    vi.unstubAllGlobals();
  });

  test("applies named effect-stack pixels after drawing a complete image", async () => {
    const sourcePixels = new ImageData(
      new Uint8ClampedArray([100, 150, 200, 255, 30, 60, 90, 255]),
      2,
      1,
    );
    const effectStack = [{
      id: "brightness-1", type: "brightness", name: "亮度", visible: true,
      opacity: 1, settings: { amount: 1.2 },
    }];
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => sourcePixels),
      putImageData: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      canvas: { width: 2, height: 2 },
      setLineDash: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (callback, type) => callback(new Blob([type], { type })),
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    await renderProjectToBlob({
      project: {
        canvas: { width: 2, height: 2 },
        filters: {},
        effectStack,
        layers: [],
      },
      sourceBitmap: { width: 2, height: 2 },
      format: "png",
    });
    expect(context.filter).toBe("none");
    expect(context.putImageData).toHaveBeenCalledTimes(1);
    expect(Array.from(context.putImageData.mock.calls[0][0].data)).toEqual(
      Array.from(applyEffectStack(sourcePixels, effectStack).data),
    );
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    vi.unstubAllGlobals();
  });

  test("throws typed memory errors before an unsafe canvas allocation", async () => {
    await expect(
      renderProjectToBlob({
        project: { canvas: { width: 20_000, height: 20_000 }, layers: [] },
        sourceBitmap: { width: 20_000, height: 20_000 },
        scale: 4,
        format: "png",
      }),
    ).rejects.toMatchObject({ code: "EXPORT_MEMORY" });
  });

  test("renders a supplied animation frame with the preview transform and clip", async () => {
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
      fillText: vi.fn(),
      canvas: { width: 100, height: 100 },
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (callback, type) => callback(new Blob([type], { type })),
    };
    vi.stubGlobal("document", { createElement: () => canvas });

    await renderProjectFrameToBlob({
      project: {
        canvas: { width: 100, height: 100 },
        layers: [{
          id: "animated-path",
          type: "path",
          points: [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }],
          style: { lineColor: "#e5484d", textColor: "#fff", anchorColor: "#f66", lineWidth: 2, opacity: 1 },
          animation: { type: "draw", durationMs: 1000, delayMs: 0, loop: false, amplitude: 0.5 },
        }],
      },
      sourceBitmap: { width: 100, height: 100 },
      timeMs: 500,
      format: "png",
    });

    expect(context.clip).toHaveBeenCalledTimes(1);
    expect(context.rect).toHaveBeenCalledWith(10, 16, 48, 9);
    expect(context.moveTo).toHaveBeenCalledWith(10, 20);
    expect(context.lineTo).toHaveBeenCalledWith(90, 20);
    vi.unstubAllGlobals();
  });

  test("keeps static export as the zero-time animation frame", async () => {
    const makeContext = () => ({
      clearRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(),
      beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
      moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(),
      fillText: vi.fn(),
      canvas: { width: 100, height: 100 },
    });
    const contexts = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const context = makeContext();
        contexts.push(context);
        return {
          width: 0,
          height: 0,
          getContext: () => context,
          toBlob: (callback, type) => callback(new Blob([type], { type })),
        };
      },
    });
    const project = {
      canvas: { width: 100, height: 100 },
      layers: [{
        id: "fade-path", type: "path",
        points: [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }],
        style: { lineColor: "#e5484d", textColor: "#fff", anchorColor: "#f66", lineWidth: 2, opacity: 1 },
        animation: { type: "fade", durationMs: 1000, delayMs: 0, loop: false, amplitude: 0.5 },
      }],
    };
    const sourceBitmap = { width: 100, height: 100 };
    await renderProjectToBlob({ project, sourceBitmap, format: "png" });
    await renderProjectFrameToBlob({ project, sourceBitmap, timeMs: 0, format: "png" });

    expect(contexts).toHaveLength(2);
    expect(contexts[0].moveTo.mock.calls).toEqual(contexts[1].moveTo.mock.calls);
    expect(contexts[0].lineTo.mock.calls).toEqual(contexts[1].lineTo.mock.calls);
    expect(contexts[0].clip.mock.calls).toEqual(contexts[1].clip.mock.calls);
    vi.unstubAllGlobals();
  });
});
