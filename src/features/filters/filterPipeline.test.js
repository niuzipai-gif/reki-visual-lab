import { describe, expect, test } from "vitest";
import {
  DEFAULT_FILTER_SETTINGS,
  applyPixelFilters,
  hasActivePixelFilters,
} from "./filterPipeline.js";

function pixels(values, width, height = 1) {
  return new ImageData(new Uint8ClampedArray(values), width, height);
}

describe("applyPixelFilters", () => {
  test("applies threshold and duotone deterministically", () => {
    const input = pixels([120, 120, 120, 255], 1);
    const output = applyPixelFilters(input, {
      threshold: 128,
      duotone: { dark: [10, 20, 30], light: [240, 220, 170] },
    });

    expect(Array.from(output.data)).toEqual([10, 20, 30, 255]);
  });

  test("thresholds pixels by luminance", () => {
    const output = applyPixelFilters(
      pixels([127, 127, 127, 255, 129, 129, 129, 255], 2),
      { threshold: 128 },
    );

    expect(Array.from(output.data)).toEqual([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]);
  });

  test("uses a stable ordered 4x4 Bayer pattern for halftone", () => {
    const values = Array.from({ length: 16 }, () => [128, 128, 128, 255]).flat();
    const output = applyPixelFilters(pixels(values, 4, 4), {
      halftone: true,
    });
    const monochrome = [];
    for (let index = 0; index < output.data.length; index += 4) {
      monochrome.push(output.data[index]);
      expect(output.data[index + 1]).toBe(output.data[index]);
      expect(output.data[index + 2]).toBe(output.data[index]);
    }

    expect(monochrome).toEqual([
      255, 0, 255, 0,
      0, 255, 0, 255,
      255, 0, 255, 0,
      0, 255, 0, 255,
    ]);
  });

  test("adds deterministic seeded monochrome grain", () => {
    const input = pixels([100, 120, 140, 255, 100, 120, 140, 255], 2);
    const first = applyPixelFilters(input, { grain: 0.5, grainSeed: 77 });
    const second = applyPixelFilters(input, { grain: 0.5, grainSeed: 77 });
    const otherSeed = applyPixelFilters(input, { grain: 0.5, grainSeed: 78 });

    expect(Array.from(first.data)).toEqual(Array.from(second.data));
    expect(Array.from(first.data)).not.toEqual(Array.from(otherSeed.data));
    expect(first.data[0] - 100).toBe(first.data[1] - 120);
    expect(first.data[1] - 120).toBe(first.data[2] - 140);
  });

  test("maps black and white to duotone endpoints", () => {
    const output = applyPixelFilters(
      pixels([0, 0, 0, 255, 255, 255, 255, 255], 2),
      { duotone: { dark: [10, 20, 30], light: [240, 220, 170] } },
    );

    expect(Array.from(output.data)).toEqual([
      10, 20, 30, 255,
      240, 220, 170, 255,
    ]);
  });

  test("offsets RGB channels using clamped neighboring source pixels", () => {
    const output = applyPixelFilters(
      pixels([
        10, 20, 30, 255,
        40, 50, 60, 255,
        70, 80, 90, 255,
      ], 3),
      { rgbOffset: 1 },
    );

    expect(Array.from(output.data)).toEqual([
      10, 20, 60, 255,
      10, 50, 90, 255,
      40, 80, 90, 255,
    ]);
  });

  test("darkens alternating horizontal scanlines", () => {
    const output = applyPixelFilters(
      pixels([
        100, 120, 140, 255,
        100, 120, 140, 255,
      ], 1, 2),
      { scanline: 0.5 },
    );

    expect(Array.from(output.data)).toEqual([
      100, 120, 140, 255,
      50, 60, 70, 255,
    ]);
  });

  test("preserves alpha, never mutates input, and combines transforms", () => {
    const input = pixels([
      80, 80, 80, 17,
      180, 180, 180, 231,
    ], 1, 2);
    const before = Array.from(input.data);
    const output = applyPixelFilters(input, {
      threshold: 128,
      halftone: true,
      grain: 0.2,
      grainSeed: 4,
      rgbOffset: 99,
      scanline: 0.25,
      duotone: { dark: [0, 20, 40], light: [255, 220, 180] },
    });

    expect(Array.from(input.data)).toEqual(before);
    expect(output).not.toBe(input);
    expect([output.data[3], output.data[7]]).toEqual([17, 231]);
  });

  test("clamps invalid settings and leaves pixels unchanged at defaults", () => {
    const input = pixels([12, 34, 56, 78], 1);

    expect(Array.from(applyPixelFilters(input, DEFAULT_FILTER_SETTINGS).data))
      .toEqual([12, 34, 56, 78]);
    expect(() =>
      applyPixelFilters(input, {
        threshold: Number.NaN,
        grain: -3,
        rgbOffset: Number.POSITIVE_INFINITY,
        scanline: 9,
        duotone: { dark: [-9, 999, Number.NaN], light: null },
      }),
    ).not.toThrow();
  });
});

describe("hasActivePixelFilters", () => {
  test("bypasses readback for defaults and legacy CSS-only settings", () => {
    expect(hasActivePixelFilters(DEFAULT_FILTER_SETTINGS)).toBe(false);
    expect(
      hasActivePixelFilters({
        brightness: 0.9,
        contrast: 1.2,
        saturation: 0.8,
        sharpness: 0.2,
      }),
    ).toBe(false);
    expect(
      hasActivePixelFilters({
        threshold: Number.NaN,
        halftone: false,
        grain: 0,
        rgbOffset: 0,
        scanline: 0,
        duotone: null,
      }),
    ).toBe(false);
  });

  test.each([
    [{ threshold: 0 }],
    [{ halftone: true }],
    [{ grain: 0.1 }],
    [{ rgbOffset: -1 }],
    [{ scanline: 0.1 }],
    [{ duotone: { dark: [0, 0, 0], light: [255, 255, 255] } }],
  ])("detects an active pixel transform in %j", (settings) => {
    expect(hasActivePixelFilters(settings)).toBe(true);
  });
});
