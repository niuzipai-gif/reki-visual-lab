import { describe, expect, test } from "vitest";
import {
  DEFAULT_STYLE,
  createAnnotation,
  createProject,
  normalizeProject,
} from "./project.js";

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
      layers: [],
    });
    expect(project.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(project.updatedAt).toEqual(expect.any(Number));
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
