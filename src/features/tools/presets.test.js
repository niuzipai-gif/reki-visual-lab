import { describe, expect, test } from "vitest";
import { PRESETS } from "./presets.js";
import { applyPixelFilters } from "../filters/filterPipeline.js";

const EXPECTED_IDS = [
  "neural-nodes",
  "archive-scan",
  "sacred-orbit",
  "mechanical-label",
  "anomaly-signal",
  "visual-measure",
];

describe("Reki presets", () => {
  test("exposes the six approved presets in their exact order", () => {
    expect(PRESETS.map(({ id }) => id)).toEqual(EXPECTED_IDS);
    expect(
      PRESETS.every(
        ({ id, name, filters, createLayers }) =>
          id &&
          name &&
          Object.keys(filters).length > 0 &&
          typeof createLayers === "function",
      ),
    ).toBe(true);
  });

  test.each(EXPECTED_IDS)(
    "%s deterministically creates normalized annotation layers of multiple types",
    (id) => {
      const preset = PRESETS.find((candidate) => candidate.id === id);
      const landmarks = [
        { x: 0.18, y: 0.24 },
        { x: 0.42, y: 0.3 },
        { x: 0.7, y: 0.64 },
      ];

      const first = preset.createLayers({ seed: 27, landmarks });
      const second = preset.createLayers({ seed: 27, landmarks });

      expect(first).toEqual(second);
      expect(first.length).toBeGreaterThan(0);
      expect(new Set(first.map(({ type }) => type)).size).toBeGreaterThanOrEqual(
        2,
      );
      expect(
        first.every(
          (layer) =>
            layer.id &&
            layer.name &&
            Array.isArray(layer.points) &&
            layer.points.every(
              ({ x, y }) => x >= 0 && x <= 1 && y >= 0 && y <= 1,
            ) &&
            layer.style &&
            typeof layer.visible === "boolean" &&
            typeof layer.locked === "boolean",
        ),
      ).toBe(true);
    },
  );

  test("changes generated geometry when the local LCG seed changes", () => {
    const preset = PRESETS[0];

    expect(preset.createLayers({ seed: 1 })).not.toEqual(
      preset.createLayers({ seed: 2 }),
    );
  });

  test("gives the anomaly preset a meaningful RGB neighbor offset", () => {
    const anomaly = PRESETS.find(({ id }) => id === "anomaly-signal");
    expect(anomaly.filters).toMatchObject({ grain: 0.24, rgbOffset: 3 });
    expect(anomaly.filters).not.toHaveProperty("chromaShift");

    const input = new ImageData(
      new Uint8ClampedArray([
        10, 20, 30, 255,
        40, 50, 60, 255,
        70, 80, 90, 255,
        100, 110, 120, 255,
      ]),
      4,
      1,
    );
    const output = applyPixelFilters(input, {
      rgbOffset: anomaly.filters.rgbOffset,
    });
    expect(Array.from(output.data)).not.toEqual(Array.from(input.data));
    expect(Array.from(output.data.slice(0, 4))).toEqual([10, 20, 120, 255]);
  });
});
