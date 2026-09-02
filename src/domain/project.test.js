import { describe, expect, test } from "vitest";
import {
  DEFAULT_STYLE,
  createAnnotation,
  createProject,
  normalizeProject,
} from "./project.js";
import { DEFAULT_ANIMATION } from "../features/motion/animationRuntime.js";

describe("project factories", () => {
  test("creates a versioned local project with the requested canvas size", () => {
    const project = createProject({ width: 1080, height: 1350 });

    expect(project).toMatchObject({
      version: 2,
      name: "未命名项目",
      canvas: { width: 1080, height: 1350, backgroundVisible: true },
      image: null,
      filters: {},
      effectStack: [],
      motion: { durationMs: 4000 },
      layers: [],
    });
    expect(project.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(project.updatedAt).toEqual(expect.any(Number));
  });

  test("persists a bounded four-second global motion duration", () => {
    const normalized = normalizeProject({
      ...createProject(),
      motion: { durationMs: 99999 },
    });

    expect(normalized.motion).toEqual({ durationMs: 10000 });
    expect(normalizeProject({ ...createProject(), motion: { durationMs: 0 } }).motion)
      .toEqual({ durationMs: 1000 });
    expect(normalizeProject({ ...createProject(), motion: null }).motion)
      .toEqual({ durationMs: 4000 });
  });

  test("migrates flat legacy filters into effect cards without mutating the saved project", () => {
    const legacy = {
      ...createProject(),
      version: 1,
      filters: { grain: 0.2, rgbOffset: 2 },
      effectStack: undefined,
    };

    const normalized = normalizeProject(legacy);

    expect(normalized.version).toBe(2);
    expect(normalized.filters).toEqual({});
    expect(normalized.effectStack).toEqual([
      expect.objectContaining({ type: "grain", settings: { amount: 0.2, seed: 1 } }),
      expect.objectContaining({ type: "rgbOffset", settings: { offset: 2 } }),
    ]);
    expect(legacy.filters).toEqual({ grain: 0.2, rgbOffset: 2 });
  });

  test("treats an explicit empty effect stack as authoritative over stale flat filters", () => {
    const normalized = normalizeProject({
      ...createProject(),
      version: 1,
      filters: { grain: 0.4 },
      effectStack: [],
    });

    expect(normalized.effectStack).toEqual([]);
    expect(normalized.filters).toEqual({});
  });

  test("uses the editor canvas defaults when dimensions are omitted", () => {
    expect(createProject().canvas).toEqual({
      width: 1080,
      height: 1350,
      backgroundVisible: true,
    });
  });

  test("creates normalized path annotations with independent default styles", () => {
    const points = [
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.5 },
    ];
    const item = createAnnotation("path", points);
    const another = createAnnotation("path");

    expect(item).toMatchObject({
      type: "path",
      points,
      visible: true,
      locked: false,
      label: "label_01",
      value: null,
      style: {
        lineColor: "#e5484d",
        textColor: "#fff7ed",
        anchorColor: "#ff6b6b",
        lineWidth: 2,
        fontSize: 14,
        anchorSize: 5,
        dash: [],
        opacity: 1,
        curveTension: 0,
      },
      animation: DEFAULT_ANIMATION,
    });
    expect(item.points).toHaveLength(2);
    expect(item.name).toMatch(/^path_\d{4}$/);
    expect(item.id).not.toBe(another.id);
    expect(item.style).not.toBe(another.style);
    expect(item.style.dash).not.toBe(another.style.dash);

    item.style.dash.push(4, 2);
    const anotherDash = [...another.style.dash];
    const defaultDash = [...DEFAULT_STYLE.dash];
    item.style.dash.length = 0;

    expect(anotherDash).toEqual([]);
    expect(defaultDash).toEqual([]);
  });

  test("sanitizes persisted layer animation config without mutating the saved project", () => {
    const legacy = {
      ...createProject(),
      layers: [
        createAnnotation("box", [], {
          animation: { type: "glitch", durationMs: 20, delayMs: 999999, amplitude: 3 },
        }),
      ],
    };

    const normalized = normalizeProject(legacy);

    expect(normalized.layers[0].animation).toEqual({
      type: "glitch",
      durationMs: 200,
      delayMs: 6000,
      loop: true,
      amplitude: 1,
      direction: "normal",
    });
    expect(normalized.layers[0]).not.toBe(legacy.layers[0]);
    expect(legacy.layers[0].animation.durationMs).toBe(20);
  });

  test("normalizes persisted extracted fragments without adding default effects", () => {
    const saved = {
      ...createProject(),
      layers: [
        createAnnotation("extractedFragment", [], {
          id: "fragment-1",
          sourceMarkerId: "marker-1",
          sourceRect: { x: 0.2, y: 0.2, width: 0.3, height: 0.2 },
          transform: { x: 0.24, y: 0.25, width: 0.3, height: 0.2 },
          linkedToMarker: false,
          sourceFill: "white",
          effects: [],
        }),
      ],
    };

    const normalized = normalizeProject(saved);

    expect(normalized.layers[0]).toMatchObject({
      type: "extractedFragment",
      sourceMarkerId: "marker-1",
      sourceFill: "white",
      linkedToMarker: false,
      opacity: 1,
      effects: [],
    });
    expect(normalized.layers[0]).not.toBe(saved.layers[0]);
  });

  test("keeps the exported defaults frozen and applies annotation overrides last", () => {
    const annotation = createAnnotation("box", [], {
      name: "portrait",
      visible: false,
      label: "face",
      style: { ...DEFAULT_STYLE, lineColor: "#123456" },
    });

    expect(Object.isFrozen(DEFAULT_STYLE)).toBe(true);
    expect(Object.isFrozen(DEFAULT_STYLE.dash)).toBe(true);
    expect(DEFAULT_STYLE).toEqual({
      lineColor: "#e5484d",
      textColor: "#fff7ed",
      anchorColor: "#ff6b6b",
      lineWidth: 2,
      fontSize: 14,
      anchorSize: 5,
      dash: [],
      opacity: 1,
      curveTension: 0,
    });
    expect(annotation).toMatchObject({
      type: "box",
      name: "portrait",
      visible: false,
      label: "face",
    });
    expect(annotation.style.lineColor).toBe("#123456");
  });
});
