import { describe, expect, test } from "vitest";
import { STYLE_PRESETS, createStyleLayers } from "./stylePresets.js";

describe("AI style presets", () => {
  test("contains the three approved deterministic presets", () => {
    expect(STYLE_PRESETS.map(({ id }) => id)).toEqual([
      "redline-archive",
      "silver-mist-portrait",
      "mechanical-nodes",
    ]);
    expect(STYLE_PRESETS).toHaveLength(3);
  });

  test("creates normalized annotation layers without random identity drift", () => {
    const preset = STYLE_PRESETS[0];
    const first = createStyleLayers(preset, { seed: 11 });
    const second = createStyleLayers(preset, { seed: 11 });

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every(({ points }) => points.every(({ x, y }) => x >= 0 && x <= 1 && y >= 0 && y <= 1))).toBe(true);
    expect(new Set(first.map(({ type }) => type)).size).toBeGreaterThan(0);
  });
});
