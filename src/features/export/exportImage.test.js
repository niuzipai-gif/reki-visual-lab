import { describe, expect, test, vi } from "vitest";
import {
  createExportPlan,
  decodeOriginalSource,
  isSafeExport,
  renderProjectToBlob,
} from "./exportImage.js";

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

  test("applies the same base filter string before drawing a complete image", async () => {
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => new ImageData(2, 2)),
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
    let drawnFilter;
    context.drawImage.mockImplementation(() => { drawnFilter = context.filter; });
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
        filters: { brightness: 1.2, contrast: 1.1, saturation: 0.8, sharpness: 0.5 },
        layers: [],
      },
      sourceBitmap: { width: 2, height: 2 },
      format: "png",
    });
    expect(drawnFilter).toContain("brightness(1.2)");
    expect(drawnFilter).toContain("contrast(1.175)");
    expect(drawnFilter).toContain("saturate(0.8)");
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
});
