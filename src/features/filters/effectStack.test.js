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
});
