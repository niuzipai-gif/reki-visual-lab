// @vitest-environment jsdom
import "./setup";

import { initializeCanvas, readPsd } from "ag-psd";
import { describe, expect, it } from "vitest";

import { createInitialEditorDocument } from "../editor/operations";
import { buildPsdBytes, createAuraProjectJson } from "../editor/exporters";

function sourceImage(): ImageData {
  return {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([90, 110, 130, 255, 190, 170, 150, 255]),
  } as ImageData;
}

describe("editor exporters", () => {
  it("writes a readable PSD with original, adjustment, and mask layers", () => {
    initializeCanvas(
      () => ({ getContext: () => null } as unknown as HTMLCanvasElement),
      (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height } as ImageData),
    );
    const document = createInitialEditorDocument("miku.jpg", 2, 1);
    document.layers[1].adjustments.exposure = 35;
    document.layers[1].maskStrokes = [{ mode: "add", width: 30, points: [{ x: 0.25, y: 0.5 }] }];

    const bytes = buildPsdBytes(document, sourceImage());
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("8BPS");
    expect(bytes.length).toBeGreaterThan(100);

    const parsed = readPsd(bytes, { useImageData: true });
    expect(parsed.width).toBe(2);
    expect(parsed.height).toBe(1);
    expect(parsed.children?.map((layer) => layer.name)).toEqual(["原图（锁定）", "光影与色彩"]);
    expect(parsed.children?.[1].mask?.imageData?.width).toBe(2);
  });

  it("serializes an AURA project without secrets or remote URLs", () => {
    const document = createInitialEditorDocument("miku.jpg", 2, 1);
    document.sourceDataUrl = "data:image/jpeg;base64,private-photo";
    const project = createAuraProjectJson(document);

    expect(project.filename).toBe("miku.jpg");
    expect(project.sourceDataUrl).toBeNull();
    expect(project.layers).toHaveLength(2);
    expect(JSON.stringify(project)).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
    expect(JSON.stringify(project)).not.toContain("https://");
  });
});
