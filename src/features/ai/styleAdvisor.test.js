import { describe, expect, test } from "vitest";
import {
  analyzeImageFeatures,
  getOfflineRecommendations,
  styleToEditorPatch,
  validateStyleAdvice,
} from "./styleAdvisor.js";

describe("offline style advisor", () => {
  test("extracts bounded image features and subject hints without leaking pixels", () => {
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 128, 64, 255,
    ]);

    const features = analyzeImageFeatures({
      width: 2,
      height: 1,
      data: pixels,
      subjectHints: ["face", "costume", "face"],
    });

    expect(features).toMatchObject({ aspectRatio: 2 });
    expect(features.luminance).toBeGreaterThanOrEqual(0);
    expect(features.luminance).toBeLessThanOrEqual(1);
    expect(features.contrast).toBeGreaterThanOrEqual(0);
    expect(features.contrast).toBeLessThanOrEqual(1);
    expect(features.saturation).toBeGreaterThanOrEqual(0);
    expect(features.saturation).toBeLessThanOrEqual(1);
    expect(features.subjectHints).toEqual(["face", "costume"]);
    expect(features).not.toHaveProperty("data");
  });

  test("keeps subject hints primitive and bounded", () => {
    const cyclic = {};
    cyclic.self = cyclic;
    expect(analyzeImageFeatures({ width: 1, height: 1, subjectHints: ["face", { type: "hands" }, cyclic, 42, "face"] }).subjectHints).toEqual(["face", "hands"]);
  });

  test("returns a structured validation failure for malformed or unsafe advice", () => {
    expect(validateStyleAdvice("{not-json").ok).toBe(false);
    expect(
      validateStyleAdvice({
        recommendations: [
          {
            name: "bad",
            filters: { contrast: 99 },
            annotationType: "script",
          },
        ],
      }),
    ).toMatchObject({ ok: false });
  });

  test("returns three deterministic validated offline recommendations", () => {
    const first = getOfflineRecommendations({ luminance: 0.4 });
    const second = getOfflineRecommendations({ luminance: 0.4 });

    expect(first).toHaveLength(3);
    expect(first).toEqual(second);
    expect(first.every((item) => validateStyleAdvice({ recommendations: [item] }).ok)).toBe(true);
  });

  test("maps a recommendation into an immutable editor patch", () => {
    const recommendation = getOfflineRecommendations({})[0];
    const project = {
      filters: { contrast: 1 },
      layers: [],
    };
    const before = structuredClone(project);
    const patch = styleToEditorPatch(recommendation, { project, seed: 7 });

    expect(patch.filters).toEqual(recommendation.filters);
    expect(patch.layers.length).toBeGreaterThan(0);
    expect(patch.layers.every(({ id, type, points }) => id && type && Array.isArray(points))).toBe(true);
    expect(project).toEqual(before);
    expect(patch.layers).not.toBe(recommendation.layers);
  });

  test.each([
    ["box", "none"],
    ["leader", "single"],
    ["label", "none"],
    ["randomNodes", "per-layer"],
    ["stackBox", "single"],
    ["orbit", "single"],
    ["nodeCloud", "per-layer"],
  ])("honors %s annotation type and %s label mode", (annotationType, labelMode) => {
    const patch = styleToEditorPatch({
      id: `custom-${annotationType}`,
      name: "Custom",
      filters: { contrast: 1.1 },
      annotationType,
      density: 50,
      labelMode,
    });

    expect(patch.layers.length).toBeGreaterThan(0);
    expect(patch.layers[0].type).toBe(annotationType);
    const labels = patch.layers.filter(({ type }) => type === "label");
    if (labelMode === "none" && annotationType !== "label") expect(labels).toHaveLength(0);
    if (labelMode === "single" && annotationType !== "label") expect(labels).toHaveLength(1);
    if (labelMode === "per-layer" && annotationType !== "label") {
      expect(labels.length).toBe(patch.layers.filter(({ type }) => type !== "label").length);
    }
  });
});
