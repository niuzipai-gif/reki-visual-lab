import { describe, expect, test } from "vitest";
import { createAnnotation, DEFAULT_STYLE } from "../../domain/project.js";
import {
  MARKER_TYPES,
  createExtractedFragment,
  markerSourceRect,
} from "./fragmentDomain.js";

const canvas = { width: 1000, height: 1400 };

const markerPoints = {
  box: [{ x: 0.2, y: 0.2 }, { x: 0.7, y: 0.7 }],
  stackBox: [{ x: 0.2, y: 0.2 }, { x: 0.7, y: 0.7 }],
  path: [{ x: 0.2, y: 0.7 }, { x: 0.5, y: 0.25 }, { x: 0.8, y: 0.6 }],
  leader: [{ x: 0.2, y: 0.7 }, { x: 0.8, y: 0.25 }],
  nodeCloud: [{ x: 0.2, y: 0.25 }, { x: 0.5, y: 0.7 }, { x: 0.8, y: 0.4 }],
  randomNodes: [{ x: 0.25, y: 0.2 }, { x: 0.65, y: 0.72 }],
  orbit: [{ x: 0.5, y: 0.5 }, { x: 0.75, y: 0.5 }],
  label: [{ x: 0.3, y: 0.42 }],
};

describe("marker extraction domain", () => {
  test.each(MARKER_TYPES)("creates a source rectangle from %s", (type) => {
    const rect = markerSourceRect(
      createAnnotation(type, markerPoints[type], { id: `marker-${type}` }),
      canvas,
    );

    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1);
    expect(rect.y + rect.height).toBeLessThanOrEqual(1);
  });

  test("uses a safe rectangle for a point-only marker", () => {
    const rect = markerSourceRect(
      createAnnotation("randomNodes", [{ x: 0.5, y: 0.5 }]),
      canvas,
    );

    expect(rect.width).toBeGreaterThanOrEqual(0.01);
    expect(rect.height).toBeGreaterThanOrEqual(0.01);
  });

  test("includes the visible stacked and label geometry", () => {
    const stacked = markerSourceRect(
      createAnnotation("stackBox", markerPoints.stackBox),
      canvas,
    );
    const label = markerSourceRect(
      createAnnotation("label", markerPoints.label, {
        label: "EXTRACT_ME",
        labelOffset: { x: 30, y: 16 },
        style: { ...DEFAULT_STYLE, fontSize: 20 },
      }),
      canvas,
    );

    expect(stacked.y).toBeLessThan(0.2);
    expect(stacked.width).toBeGreaterThan(0.5);
    expect(label.x).toBeCloseTo(0.33, 3);
    expect(label.y).toBeCloseTo(0.431, 3);
    expect(label.width).toBeGreaterThanOrEqual(0.12);
  });

  test("creates an extracted fragment with an empty local effect stack", () => {
    const marker = createAnnotation("box", markerPoints.box, { id: "marker-box" });
    const fragment = createExtractedFragment({ marker, canvas });

    expect(fragment).toMatchObject({
      type: "extractedFragment",
      sourceMarkerId: marker.id,
      linkedToMarker: true,
      sourceFill: "preserve",
      effects: [],
    });
    expect(fragment.sourceRect).toEqual(markerSourceRect(marker, canvas));
    expect(fragment.transform).toEqual(fragment.sourceRect);
    expect(fragment.animation).toEqual({
      type: "none",
      durationMs: 900,
      delayMs: 0,
      loop: true,
      amplitude: 0.35,
      direction: "normal",
    });
  });

  test("rejects invalid markers and source-fill values", () => {
    expect(createExtractedFragment({ marker: createAnnotation("label"), canvas })).toBeNull();
    expect(createExtractedFragment({
      marker: createAnnotation("box", markerPoints.box),
      canvas,
      sourceFill: "gradient",
    })).toBeNull();
  });
});
