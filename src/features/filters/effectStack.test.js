import { describe, expect, test } from "vitest";
import {
  applyEffectStack,
  legacyFiltersToEffectStack,
} from "./effectStack.js";

function image(values, width = values.length / 4, height = 1) {
  return new ImageData(new Uint8ClampedArray(values), width, height);
}

describe("effect stack", () => {
  test("migrates active legacy filters into named visible effects in render order", () => {
    const effects = legacyFiltersToEffectStack({
      threshold: 128,
      grain: 0.25,
      grainSeed: 7,
      rgbOffset: 3,
      scanline: 0.4,
      duotone: { dark: [10, 20, 30], light: [240, 220, 170] },
    });

    expect(effects).toEqual([
      expect.objectContaining({
        id: "legacy-threshold",
        type: "threshold",
        name: "阈值",
        visible: true,
        opacity: 1,
        settings: { value: 128 },
      }),
      expect.objectContaining({
        id: "legacy-grain",
        type: "grain",
        settings: { amount: 0.25, seed: 7 },
      }),
      expect.objectContaining({
        id: "legacy-rgbOffset",
        type: "rgbOffset",
        settings: { offset: 3 },
      }),
      expect.objectContaining({
        id: "legacy-scanline",
        type: "scanline",
        settings: { amount: 0.4 },
      }),
      expect.objectContaining({
        id: "legacy-duotone",
        type: "duotone",
        settings: { dark: [10, 20, 30], light: [240, 220, 170] },
      }),
    ]);
  });

  test("blends each visible effect by opacity without mutating input pixels", () => {
    const source = image([40, 40, 40, 255]);
    const output = applyEffectStack(source, [
      {
        id: "threshold",
        type: "threshold",
        name: "阈值",
        visible: true,
        opacity: 0.5,
        settings: { value: 128 },
      },
    ]);

    expect(Array.from(source.data)).toEqual([40, 40, 40, 255]);
    expect(Array.from(output.data)).toEqual([20, 20, 20, 255]);
  });

  test("skips invisible effects and respects stack order", () => {
    const source = image([100, 100, 100, 255]);
    const output = applyEffectStack(source, [
      {
        id: "invisible",
        type: "threshold",
        name: "阈值",
        visible: false,
        opacity: 1,
        settings: { value: 128 },
      },
      {
        id: "visible",
        type: "threshold",
        name: "阈值",
        visible: true,
        opacity: 1,
        settings: { value: 80 },
      },
    ]);

    expect(Array.from(output.data)).toEqual([255, 255, 255, 255]);
  });

  test("keeps CSS-only legacy style filters as visible cards", () => {
    const effects = legacyFiltersToEffectStack({
      brightness: 1.08,
      contrast: 1.2,
      saturation: 0.8,
      sharpness: 0.3,
    });

    expect(effects).toEqual([
      expect.objectContaining({ type: "brightness", settings: { amount: 1.08 } }),
      expect.objectContaining({ type: "contrast", settings: { amount: 1.2 } }),
      expect.objectContaining({ type: "sharpness", settings: { amount: 0.3, legacyContrast: true } }),
      expect.objectContaining({ type: "saturation", settings: { amount: 0.8 } }),
    ]);
  });

  test("maps legacy sharpness to the former additive contrast formula", () => {
    const output = applyEffectStack(image([100, 150, 200, 255]), legacyFiltersToEffectStack({
      contrast: 1.2,
      sharpness: 0.5,
    }));
    const legacyContrast = 1.2 + 0.5 * 0.15;
    const expected = [100, 150, 200].map((value) =>
      Math.round(Math.max(0, Math.min(255, 128 + (value - 128) * legacyContrast))),
    );

    expect(Array.from(output.data)).toEqual([...expected, 255]);
  });
});
