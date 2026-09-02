import { describe, expect, test } from "vitest";
import { PRESETS } from "./presets.js";

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
          Object.keys(filters).length === 0 &&
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

  test("keeps every preset effect-free until a user adds an effect card", () => {
    expect(PRESETS.map(({ filters }) => filters)).toEqual([
      {}, {}, {}, {}, {}, {},
    ]);
  });
});
