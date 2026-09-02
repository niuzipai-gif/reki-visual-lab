import { describe, expect, it } from "vitest";

import {
  applyAdjustments,
  applyPreset,
  clampAdjustments,
  createInitialEditorDocument,
  expandPreset,
  normalizeMaskStrokes,
  toCanvasBlendMode,
} from "../editor/operations";
import { DEFAULT_ADJUSTMENTS, type AdjustmentValues } from "../domain/editor";

describe("editor operations", () => {
  it("creates a non-destructive COS document with a locked original layer", () => {
    const document = createInitialEditorDocument("miku.jpg", 120, 80);

    expect(document.width).toBe(120);
    expect(document.height).toBe(80);
    expect(document.layers[0]).toMatchObject({
      id: "original",
      name: "原图（锁定）",
      kind: "image",
      locked: true,
      visible: true,
    });
    expect(document.layers.some((layer) => layer.kind === "adjustment")).toBe(true);
  });

  it("leaves pixels untouched at zero adjustment and changes pixels at positive exposure", () => {
    const source = {
      data: new Uint8ClampedArray([80, 100, 120, 255]),
      width: 1,
      height: 1,
    } as ImageData;

    expect(applyAdjustments(source, DEFAULT_ADJUSTMENTS).data).toEqual(source.data);

    const brighter = applyAdjustments(source, { ...DEFAULT_ADJUSTMENTS, exposure: 60 });
    expect(Array.from(brighter.data)).toEqual([121, 152, 182, 255]);
  });

  it("clamps adjustment values to the editor contract", () => {
    const values: AdjustmentValues = {
      exposure: 180,
      contrast: -140,
      saturation: 50,
      temperature: -180,
      sharpness: 101,
      grain: -1,
      vignette: 200,
    };

    expect(clampAdjustments(values)).toEqual({
      exposure: 100,
      contrast: -100,
      saturation: 50,
      temperature: -100,
      sharpness: 100,
      grain: 0,
      vignette: 100,
    });
  });

  it("expands a named COS preset into bounded, stable operations", () => {
    const operations = expandPreset("retro-film");

    expect(operations).toHaveLength(3);
    expect(operations.map((operation) => operation.id)).toEqual([
      "retro-film-light",
      "retro-film-color",
      "retro-film-grain",
    ]);
    expect(operations.every((operation) => operation.preserve.includes("face identity"))).toBe(true);
  });

  it("normalizes mask points and drops empty strokes", () => {
    expect(normalizeMaskStrokes([
      { mode: "add", width: 30, points: [{ x: -0.2, y: 0.4 }, { x: 1.4, y: 2 }] },
      { mode: "erase", width: 20, points: [] },
    ])).toEqual([
      { mode: "add", width: 30, points: [{ x: 0, y: 0.4 }, { x: 1, y: 1 }] },
    ]);
  });

  it("maps editor blend modes to canvas composite modes", () => {
    expect(toCanvasBlendMode("normal")).toBe("source-over");
    expect(toCanvasBlendMode("soft-light")).toBe("soft-light");
  });

  it("expands a preset into replaceable non-destructive layers", () => {
    const document = createInitialEditorDocument("miku.jpg", 1200, 800);
    const first = applyPreset(document, "natural-studio");
    const second = applyPreset(first, "retro-film");

    expect(first.layers.map((layer) => layer.id)).toEqual([
      "original",
      "light-base",
      "preset-natural-studio-natural-studio-light",
      "preset-natural-studio-natural-studio-skin",
      "preset-natural-studio-natural-studio-finish",
    ]);
    expect(second.layers.filter((layer) => layer.id.startsWith("preset-natural-studio"))).toHaveLength(0);
    expect(second.layers.filter((layer) => layer.id.startsWith("preset-retro-film"))).toHaveLength(3);
    expect(second.layers.find((layer) => layer.id.includes("retro-film-light"))?.adjustments.exposure).toBe(-4);
  });
});
