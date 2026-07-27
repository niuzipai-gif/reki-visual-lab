import { describe, expect, test } from "vitest";
import { createAnnotation, createProject } from "./project.js";
import {
  MAX_HISTORY_ENTRIES,
  createEditorState,
  editorReducer,
} from "./reducer.js";

function addLayer(state, layer) {
  return editorReducer(state, { type: "layer/add", layer });
}

describe("editor history", () => {
  test("supports add, undo, redo, and immutable layer movement", () => {
    const first = createAnnotation("box", [], { name: "first" });
    const second = createAnnotation("path", [], { name: "second" });
    const start = createEditorState();
    const withFirst = addLayer(start, first);
    const withBoth = addLayer(withFirst, second);
    const moved = editorReducer(withBoth, {
      type: "layer/move",
      id: first.id,
      toIndex: 1,
    });
    const undone = editorReducer(moved, { type: "history/undo" });
    const redone = editorReducer(undone, { type: "history/redo" });

    expect(start.present.layers).toEqual([]);
    expect(withFirst.present.layers).toEqual([first]);
    expect(moved.present.layers).toEqual([second, first]);
    expect(undone.present.layers).toEqual([first, second]);
    expect(redone.present.layers).toEqual([second, first]);
    expect(redone.past).toHaveLength(3);
    expect(redone.future).toEqual([]);
  });

  test("returns the same state when undo or redo has no matching history", () => {
    const start = createEditorState();

    expect(editorReducer(start, { type: "history/undo" })).toBe(start);
    expect(editorReducer(start, { type: "history/redo" })).toBe(start);
  });

  test("clears redo history after a new content commit", () => {
    const first = createAnnotation("box");
    const second = createAnnotation("path");
    const withBoth = addLayer(addLayer(createEditorState(), first), second);
    const undone = editorReducer(withBoth, { type: "history/undo" });
    const changed = editorReducer(undone, {
      type: "canvas/update",
      patch: { width: 900 },
    });

    expect(undone.future).toHaveLength(1);
    expect(changed.future).toEqual([]);
    expect(changed.present.canvas.width).toBe(900);
  });

  test("applies every preset layer and filter as one undoable commit", () => {
    const first = createAnnotation("box", [], {
      id: "preset-box",
      presetId: "archive-scan",
    });
    const second = createAnnotation("leader", [], {
      id: "preset-leader",
      presetId: "archive-scan",
    });
    const start = createEditorState(createProject());
    const applied = editorReducer(start, {
      type: "preset/apply",
      layers: [first, second],
      filters: { contrast: 1.18, grain: 0.12 },
      selectedLayerId: first.id,
    });
    const undone = editorReducer(applied, { type: "history/undo" });
    const redone = editorReducer(undone, { type: "history/redo" });

    expect(applied.present.layers).toEqual([first, second]);
    expect(applied.present.filters).toEqual({});
    expect(applied.present.effectStack.map(({ type }) => type)).toEqual([
      "contrast",
      "grain",
    ]);
    expect(applied.present.effectStack[1]).toEqual(
      expect.objectContaining({ type: "grain", settings: { amount: 0.12, seed: 1 } }),
    );
    expect(applied.selectedLayerId).toBe(first.id);
    expect(applied.past).toHaveLength(1);
    expect(undone.present.layers).toEqual([]);
    expect(undone.present.filters).toEqual({});
    expect(undone.selectedLayerId).toBeNull();
    expect(redone.present.layers).toEqual([first, second]);
    expect(redone.selectedLayerId).toBeNull();
  });

  test("applies an AI style atomically, marks generated layers, and selects the first", () => {
    const start = createEditorState();
    const recommendation = {
      id: "style-test",
      filters: { contrast: 1.16, grain: 0.12 },
      layers: [
        createAnnotation("path", [{ x: 0.1, y: 0.2 }], { id: "style-path" }),
        createAnnotation("label", [{ x: 0.2, y: 0.3 }], { id: "style-label" }),
      ],
    };

    const applied = editorReducer(start, {
      type: "style/apply",
      recommendation,
    });
    const undone = editorReducer(applied, { type: "history/undo" });

    expect(applied.present.filters).toEqual({});
    expect(applied.present.effectStack.map(({ type }) => type)).toEqual([
      "contrast",
      "grain",
    ]);
    expect(applied.present.effectStack[1]).toEqual(
      expect.objectContaining({ type: "grain", settings: { amount: 0.12, seed: 1 } }),
    );
    expect(applied.present.layers).toHaveLength(2);
    expect(applied.present.layers.every(({ source }) => source === "ai-style")).toBe(true);
    expect(applied.selectedLayerId).toBe("style-path");
    expect(applied.past).toHaveLength(1);
    expect(undone.present).toEqual(start.present);
  });

  test("rejects an unvalidated style patch without changing editor state", () => {
    const start = createEditorState();
    const action = {
      type: "style/apply",
      patch: {
        filters: { contrast: 99, executable: "alert(1)" },
        layers: [
          {
            id: "unsafe",
            type: "script",
            points: [{ x: 0.2, y: 0.3 }],
            style: { lineColor: "javascript:alert(1)" },
          },
        ],
      },
    };

    expect(editorReducer(start, action)).toBe(start);
    expect(
      editorReducer(start, {
        type: "style/apply",
        recommendation: {
          id: "safe-rec",
          name: "Safe",
          filters: { contrast: 1.1 },
          annotationType: "path",
          density: 60,
          labelMode: "single",
        },
        filters: { contrast: 99, hacked: true },
      }),
    ).toBe(start);
  });

  test("clones accepted style patches before committing them", () => {
    const layer = createAnnotation("path", [{ x: 0.1, y: 0.2 }], { id: "safe" });
    const patch = { filters: { grain: 0.1 }, layers: [layer] };
    const applied = editorReducer(createEditorState(), {
      type: "style/apply",
      patch,
    });

    patch.filters.grain = 0.8;
    patch.layers[0].points[0].x = 0.9;
    expect(applied.present.effectStack[0].settings.amount).toBe(0.1);
    expect(applied.present.layers[0].points[0].x).toBe(0.1);
  });

  test("clones supplied recommendation layers before committing them", () => {
    const layer = createAnnotation("path", [{ x: 0.1, y: 0.2 }], { id: "recommendation-layer" });
    const recommendation = { filters: { grain: 0.1 }, layers: [layer] };
    const applied = editorReducer(createEditorState(), {
      type: "style/apply",
      recommendation,
    });

    recommendation.filters.grain = 0.8;
    recommendation.layers[0].points[0].x = 0.9;
    expect(applied.present.effectStack[0].settings.amount).toBe(0.1);
    expect(applied.present.layers[0].points[0].x).toBe(0.1);
  });

  test("treats a null filter override as absent", () => {
    const layer = createAnnotation("path", [{ x: 0.1, y: 0.2 }], { id: "null-filter" });
    const applied = editorReducer(createEditorState(), {
      type: "style/apply",
      recommendation: { filters: { grain: 0.1 }, layers: [layer] },
      filters: null,
    });

    expect(applied.present.filters).toEqual({});
    expect(applied.present.effectStack).toEqual([
      expect.objectContaining({ type: "grain", settings: { amount: 0.1, seed: 1 } }),
    ]);
    expect(applied.present.layers[0].source).toBe("ai-style");
  });
});

describe("layer actions", () => {
  test("creates a marker fragment as one undoable selected layer", () => {
    const marker = createAnnotation("box", [
      { x: 0.2, y: 0.2 },
      { x: 0.7, y: 0.75 },
    ], { id: "marker" });
    const start = addLayer(createEditorState(), marker);
    const extracted = editorReducer(start, {
      type: "fragment/create",
      markerId: marker.id,
      sourceFill: "black",
    });
    const undone = editorReducer(extracted, { type: "history/undo" });

    expect(extracted.present.layers).toHaveLength(2);
    expect(extracted.present.layers[1]).toMatchObject({
      type: "extractedFragment",
      sourceMarkerId: marker.id,
      sourceFill: "black",
      linkedToMarker: true,
      effects: [],
    });
    expect(extracted.selectedLayerId).toBe(extracted.present.layers[1].id);
    expect(extracted.past).toHaveLength(start.past.length + 1);
    expect(undone.present.layers).toEqual([marker]);
  });

  test("updates a linked fragment when its source marker bounds change", () => {
    const marker = createAnnotation("box", [
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.5 },
    ], { id: "marker" });
    const withMarker = addLayer(createEditorState(), marker);
    const withFragment = editorReducer(withMarker, {
      type: "fragment/create",
      markerId: marker.id,
    });
    const fragment = withFragment.present.layers[1];
    const updated = editorReducer(withFragment, {
      type: "layer/update",
      id: marker.id,
      patch: { points: [{ x: 0.35, y: 0.3 }, { x: 0.8, y: 0.75 }] },
    });

    expect(updated.present.layers[1].sourceRect).not.toEqual(fragment.sourceRect);
    expect(updated.present.layers[1].transform).toEqual(updated.present.layers[1].sourceRect);
    expect(updated.present.layers[1].linkedToMarker).toBe(true);
  });

  test("unlinks a fragment on direct transform changes and validates source fill", () => {
    const marker = createAnnotation("box", [
      { x: 0.2, y: 0.2 },
      { x: 0.5, y: 0.5 },
    ], { id: "marker" });
    const withFragment = editorReducer(
      addLayer(createEditorState(), marker),
      { type: "fragment/create", markerId: marker.id },
    );
    const fragment = withFragment.present.layers[1];
    const moved = editorReducer(withFragment, {
      type: "fragment/update",
      id: fragment.id,
      patch: { transform: { ...fragment.transform, x: 0.7 } },
    });
    const invalidFill = editorReducer(moved, {
      type: "fragment/sourceFill",
      id: fragment.id,
      sourceFill: "gradient",
    });
    const whiteFill = editorReducer(moved, {
      type: "fragment/sourceFill",
      id: fragment.id,
      sourceFill: "white",
    });

    expect(moved.present.layers[1]).toMatchObject({ linkedToMarker: false, transform: { x: 0.7 } });
    expect(invalidFill).toBe(moved);
    expect(whiteFill.present.layers[1].sourceFill).toBe("white");
  });
  test("updates the persisted global motion duration as one undoable commit", () => {
    const start = createEditorState(createProject());
    const updated = editorReducer(start, {
      type: "motion/update",
      patch: { durationMs: 5200 },
    });

    expect(updated.present.motion).toEqual({ durationMs: 5200 });
    expect(updated.past).toHaveLength(1);
    expect(editorReducer(updated, { type: "history/undo" }).present.motion)
      .toEqual({ durationMs: 4000 });
  });

  test("updates a layer animation as one sanitized undoable commit", () => {
    const layer = createAnnotation("path", [], { id: "animated-layer" });
    const start = addLayer(createEditorState(), layer);
    const animated = editorReducer(start, {
      type: "layer/animation",
      id: layer.id,
      animation: { type: "orbit", durationMs: 20, delayMs: 12, loop: false, amplitude: 4 },
    });
    const undone = editorReducer(animated, { type: "history/undo" });

    expect(animated.present.layers[0].animation).toEqual({
      type: "orbit",
      durationMs: 200,
      delayMs: 12,
      loop: false,
      amplitude: 1,
      direction: "normal",
    });
    expect(animated.past).toHaveLength(start.past.length + 1);
    expect(undone.present.layers[0].animation).toEqual(layer.animation);
  });

  test("ignores animation changes for missing layers and equivalent configs", () => {
    const layer = createAnnotation("box", [], { id: "static-layer" });
    const state = addLayer(createEditorState(), layer);

    expect(editorReducer(state, {
      type: "layer/animation",
      id: "missing",
      animation: { type: "fade" },
    })).toBe(state);
    expect(editorReducer(state, {
      type: "layer/animation",
      id: layer.id,
      animation: layer.animation,
    })).toBe(state);
  });

  test("updates and removes a layer through history commits", () => {
    const layer = createAnnotation("label", [], { name: "before" });
    const added = addLayer(createEditorState(), layer);
    const updated = editorReducer(added, {
      type: "layer/update",
      id: layer.id,
      patch: { id: "replacement-id", name: "after", value: 42 },
    });
    const removed = editorReducer(updated, {
      type: "layer/remove",
      id: layer.id,
    });

    expect(updated.present.layers[0]).toEqual({
      ...layer,
      name: "after",
      value: 42,
    });
    expect(added.present.layers[0]).toBe(layer);
    expect(removed.present.layers).toEqual([]);
    expect(removed.past).toHaveLength(3);
  });

  test("rejects an added layer whose id is already present", () => {
    const layer = createAnnotation("box");
    const state = addLayer(createEditorState(), layer);
    const duplicateId = createAnnotation("path", [], { id: layer.id });

    expect(addLayer(state, duplicateId)).toBe(state);
  });

  test("clamps movement targets and ignores a missing layer", () => {
    const first = createAnnotation("box", [], { name: "first" });
    const second = createAnnotation("box", [], { name: "second" });
    const third = createAnnotation("box", [], { name: "third" });
    const start = [first, second, third].reduce(addLayer, createEditorState());

    const toStart = editorReducer(start, {
      type: "layer/move",
      id: third.id,
      toIndex: -10,
    });
    const toEnd = editorReducer(toStart, {
      type: "layer/move",
      id: third.id,
      toIndex: 99,
    });

    expect(toStart.present.layers).toEqual([third, first, second]);
    expect(toEnd.present.layers).toEqual([first, second, third]);
    expect(
      editorReducer(toEnd, {
        type: "layer/move",
        id: "missing",
        toIndex: 0,
      }),
    ).toBe(toEnd);
  });

  test("duplicates a deep copy with a new identity and ignores a missing layer", () => {
    const layer = createAnnotation("path", [{ x: 0.1, y: 0.2 }], {
      name: "route",
    });
    const start = addLayer(createEditorState(), layer);
    const duplicated = editorReducer(start, {
      type: "layer/duplicate",
      id: layer.id,
    });
    const copy = duplicated.present.layers[1];

    expect(duplicated.present.layers).toHaveLength(2);
    expect(copy).toEqual({
      ...layer,
      id: expect.any(String),
      name: "route_copy",
    });
    expect(copy.id).not.toBe(layer.id);
    expect(copy.points).not.toBe(layer.points);
    expect(copy.style).not.toBe(layer.style);
    expect(
      editorReducer(duplicated, {
        type: "layer/duplicate",
        id: "missing",
      }),
    ).toBe(duplicated);
  });

  test("toggles visibility and lock status as separate commits", () => {
    const layer = createAnnotation("box");
    const start = addLayer(createEditorState(), layer);
    const hidden = editorReducer(start, {
      type: "layer/toggle",
      id: layer.id,
    });
    const locked = editorReducer(hidden, {
      type: "layer/lock",
      id: layer.id,
    });

    expect(hidden.present.layers[0]).toMatchObject({
      visible: false,
      locked: false,
    });
    expect(locked.present.layers[0]).toMatchObject({
      visible: false,
      locked: true,
    });
    expect(start.present.layers[0]).toMatchObject({
      visible: true,
      locked: false,
    });
    expect(locked.past).toHaveLength(3);
  });

  test("updates many layers atomically and one undo restores them all", () => {
    const first = createAnnotation("box", [], {
      id: "first",
      label: "before-first",
    });
    const second = createAnnotation("box", [], {
      id: "second",
      label: "before-second",
    });
    const start = [first, second].reduce(addLayer, createEditorState());
    const updated = editorReducer(start, {
      type: "layers/updateMany",
      updates: [
        { id: first.id, patch: { label: "batch" } },
        { id: second.id, patch: { label: "batch" } },
      ],
    });
    const undone = editorReducer(updated, { type: "history/undo" });

    expect(updated.present.layers.map(({ label }) => label)).toEqual([
      "batch",
      "batch",
    ]);
    expect(updated.past).toHaveLength(start.past.length + 1);
    expect(undone.present.layers.map(({ label }) => label)).toEqual([
      "before-first",
      "before-second",
    ]);
  });

  test("adds an AI scan atomically and one undo removes every generated layer", () => {
    const manual = createAnnotation("box", [], { id: "manual" });
    const first = createAnnotation("nodeCloud", [], {
      id: "ai-nodes",
      source: "ai",
    });
    const second = createAnnotation("path", [], {
      id: "ai-path",
      source: "ai",
    });
    const start = addLayer(createEditorState(), manual);
    const added = editorReducer(start, {
      type: "layers/addMany",
      layers: [first, second],
      selectedLayerId: first.id,
    });
    const undone = editorReducer(added, { type: "history/undo" });

    expect(added.present.layers).toEqual([manual, first, second]);
    expect(added.selectedLayerId).toBe(first.id);
    expect(added.past).toHaveLength(start.past.length + 1);
    expect(undone.present.layers).toEqual([manual]);
  });

  test("clears only AI layers atomically and one undo restores the scan", () => {
    const manual = createAnnotation("box", [], { id: "manual" });
    const first = createAnnotation("nodeCloud", [], {
      id: "ai-nodes",
      source: "ai",
    });
    const second = createAnnotation("path", [], {
      id: "ai-path",
      source: "ai",
    });
    const start = [manual, first, second].reduce(
      addLayer,
      createEditorState(),
    );
    const cleared = editorReducer(start, {
      type: "layers/removeBySource",
      source: "ai",
    });
    const undone = editorReducer(cleared, { type: "history/undo" });

    expect(cleared.present.layers).toEqual([manual]);
    expect(cleared.past).toHaveLength(start.past.length + 1);
    expect(undone.present.layers).toEqual([manual, first, second]);
    expect(
      editorReducer(cleared, {
        type: "layers/removeBySource",
        source: "ai",
      }),
    ).toBe(cleared);
  });

  test("clears every layer as one undoable commit and resets selection", () => {
    const first = createAnnotation("box", [], { id: "clear-first" });
    const second = createAnnotation("path", [], { id: "clear-second" });
    const start = {
      ...addLayer(addLayer(createEditorState(), first), second),
      selectedLayerId: second.id,
    };

    const cleared = editorReducer(start, { type: "layers/clear" });
    const undone = editorReducer(cleared, { type: "history/undo" });

    expect(cleared.present.layers).toEqual([]);
    expect(cleared.selectedLayerId).toBeNull();
    expect(cleared.past).toHaveLength(start.past.length + 1);
    expect(undone.present.layers).toEqual([first, second]);
    expect(undone.selectedLayerId).toBeNull();
  });

  test("does not create history when clearing an already empty stack", () => {
    const start = createEditorState();

    expect(editorReducer(start, { type: "layers/clear" })).toBe(start);
  });

  test("ignores structurally unchanged nested layer patches", () => {
    const annotation = createAnnotation("path", [], {
      id: "stable-style",
    });
    const state = addLayer(createEditorState(), annotation);

    const next = editorReducer(state, {
      type: "layer/update",
      id: annotation.id,
      patch: { style: structuredClone(annotation.style) },
    });

    expect(next).toBe(state);
  });

  test.each([
    [
      "update",
      { type: "layer/update", id: "missing", patch: { name: "changed" } },
    ],
    ["remove", { type: "layer/remove", id: "missing" }],
    ["toggle", { type: "layer/toggle", id: "missing" }],
    ["lock", { type: "layer/lock", id: "missing" }],
  ])("returns the same state when layer/%s targets a missing id", (_name, action) => {
    const layer = createAnnotation("box");
    const state = addLayer(createEditorState(), layer);

    const next = editorReducer(state, action);

    expect(next).toBe(state);
    expect(next.past).toHaveLength(1);
  });

  test.each([
    ["same effective move", (layer) => ({ type: "layer/move", id: layer.id, toIndex: 99 })],
    ["empty layer update", (layer) => ({ type: "layer/update", id: layer.id, patch: {} })],
    [
      "unchanged layer update",
      (layer) => ({
        type: "layer/update",
        id: layer.id,
        patch: { id: "ignored-id", name: layer.name },
      }),
    ],
    ["empty canvas update", () => ({ type: "canvas/update", patch: {} })],
    [
      "unchanged canvas update",
      () => ({ type: "canvas/update", patch: { width: 1080 } }),
    ],
    ["empty filters update", () => ({ type: "filters/update", patch: {} })],
    [
      "unchanged filters update",
      () => ({ type: "filters/update", patch: { contrast: 1.2 } }),
    ],
  ])("%s preserves the exact state and redo history", (_name, createAction) => {
    const layer = createAnnotation("box", [], { name: "stable" });
    const withLayer = addLayer(createEditorState(), layer);
    const withFilter = editorReducer(withLayer, {
      type: "filters/update",
      patch: { contrast: 1.2 },
    });
    const changed = editorReducer(withFilter, {
      type: "canvas/update",
      patch: { width: 900 },
    });
    const state = editorReducer(changed, { type: "history/undo" });

    expect(state.future).toHaveLength(1);
    expect(editorReducer(state, createAction(layer))).toBe(state);
    expect(state.future).toHaveLength(1);
  });
});

describe("project-level actions", () => {
  test("adds, updates, moves, removes, and resets effect cards as undoable commits", () => {
    const start = createEditorState();
    const added = editorReducer(start, {
      type: "effects/add",
      effect: {
        id: "grain-card",
        type: "grain",
        name: "颗粒",
        visible: true,
        opacity: 1,
        settings: { amount: 0.2, seed: 3 },
      },
    });
    const updated = editorReducer(added, {
      type: "effects/update",
      id: "grain-card",
      patch: { visible: false, opacity: 0.35 },
    });
    const moved = editorReducer(updated, {
      type: "effects/move",
      id: "grain-card",
      toIndex: 0,
    });
    const removed = editorReducer(moved, {
      type: "effects/remove",
      id: "grain-card",
    });
    const reset = editorReducer(added, { type: "effects/reset" });

    expect(added.present.effectStack).toHaveLength(1);
    expect(updated.present.effectStack[0]).toMatchObject({
      visible: false,
      opacity: 0.35,
    });
    expect(moved).toBe(updated);
    expect(removed.present.effectStack).toEqual([]);
    expect(reset.present.effectStack).toEqual([]);
    expect(updated.past).toHaveLength(2);
    expect(editorReducer(updated, {
      type: "effects/update",
      id: "grain-card",
      patch: { opacity: 0.35 },
    })).toBe(updated);
  });

  test("converts preset and AI legacy pixel filters into explicit effect cards", () => {
    const preset = editorReducer(createEditorState(), {
      type: "preset/apply",
      filters: { grain: 0.18, rgbOffset: 2 },
    });
    const styled = editorReducer(createEditorState(), {
      type: "style/apply",
      recommendation: {
        filters: { grain: 0.22 },
        layers: [],
      },
    });

    expect(preset.present.filters).toEqual({});
    expect(preset.present.effectStack.map(({ type }) => type)).toEqual([
      "grain",
      "rgbOffset",
    ]);
    expect(styled.present.filters).toEqual({});
    expect(styled.present.effectStack).toEqual([
      expect.objectContaining({ type: "grain", settings: { amount: 0.22, seed: 1 } }),
    ]);
  });

  test("keeps CSS-only preset and AI filter patches as visible effect cards", () => {
    const preset = editorReducer(createEditorState(), {
      type: "preset/apply",
      filters: { contrast: 1.18, saturation: 0.82 },
    });
    const styled = editorReducer(createEditorState(), {
      type: "style/apply",
      recommendation: {
        filters: { brightness: 1.04, sharpness: 0.25 },
        layers: [],
      },
    });

    expect(preset.present.filters).toEqual({});
    expect(preset.present.effectStack.map(({ type }) => type)).toEqual([
      "contrast",
      "saturation",
    ]);
    expect(styled.present.filters).toEqual({});
    expect(styled.present.effectStack.map(({ type }) => type)).toEqual([
      "brightness",
      "sharpness",
    ]);
  });

  test("converts legacy filter update and reset actions into effect stack mutations", () => {
    const start = createEditorState();
    const updated = editorReducer(start, {
      type: "filters/update",
      patch: { grain: 0.2, contrast: 1.15 },
    });
    const reset = editorReducer(updated, {
      type: "filters/reset",
      filters: { scanline: 0.4 },
    });

    expect(updated.present.filters).toEqual({});
    expect(updated.present.effectStack.map(({ type }) => type)).toEqual([
      "contrast",
      "grain",
    ]);
    expect(reset.present.filters).toEqual({});
    expect(reset.present.effectStack).toEqual([
      expect.objectContaining({ type: "scanline", settings: { amount: 0.4 } }),
    ]);
  });

  test("updates only legacy compatibility cards without rebuilding ordered duplicate effects", () => {
    const state = createEditorState({
      ...createProject(),
      effectStack: [
        {
          id: "custom-grain",
          type: "grain",
          name: "自定义颗粒",
          visible: true,
          opacity: 1,
          settings: { amount: 0.8, seed: 9 },
        },
        {
          id: "legacy-grain",
          type: "grain",
          name: "兼容颗粒",
          visible: false,
          opacity: 0.35,
          settings: { amount: 0.1, seed: 3 },
        },
        {
          id: "custom-scanline",
          type: "scanline",
          name: "扫描线",
          visible: false,
          opacity: 0.6,
          settings: { amount: 0.4 },
        },
      ],
    });

    const updated = editorReducer(state, {
      type: "filters/update",
      patch: { grain: 0.25 },
    });

    expect(updated.present.effectStack.map(({ id }) => id)).toEqual([
      "custom-grain",
      "legacy-grain",
      "custom-scanline",
    ]);
    expect(updated.present.effectStack[0]).toEqual(state.present.effectStack[0]);
    expect(updated.present.effectStack[1]).toMatchObject({
      visible: false,
      opacity: 0.35,
      settings: { amount: 0.25, seed: 3 },
    });
    expect(updated.present.effectStack[2]).toEqual(state.present.effectStack[2]);
  });

  test("merges canvas and filter patches without discarding existing values", () => {
    const start = createEditorState();
    const resized = editorReducer(start, {
      type: "canvas/update",
      patch: { width: 720, backgroundVisible: false },
    });
    const filtered = editorReducer(resized, {
      type: "filters/update",
      patch: { contrast: 1.2 },
    });
    const refiltered = editorReducer(filtered, {
      type: "filters/update",
      patch: { grain: 0.15 },
    });

    expect(resized.present.canvas).toEqual({
      width: 720,
      height: 1350,
      backgroundVisible: false,
    });
    expect(refiltered.present.filters).toEqual({});
    expect(refiltered.present.effectStack.map(({ type }) => type)).toEqual([
      "contrast",
      "grain",
    ]);
    expect(start.present.canvas.width).toBe(1080);
    expect(start.present.filters).toEqual({});
  });

  test("loads a project into a fresh editor state", () => {
    const layer = createAnnotation("box");
    const edited = editorReducer(addLayer(createEditorState(), layer), {
      type: "selection/set",
      id: layer.id,
    });
    const loadedProject = createProject({ width: 640, height: 640 });
    const loaded = editorReducer(edited, {
      type: "project/load",
      project: loadedProject,
    });

    expect(loaded).toEqual({
      past: [],
      present: loadedProject,
      future: [],
      selectedLayerId: null,
    });
  });

  test("normalizes old flat filters when loading a saved project", () => {
    const loaded = editorReducer(createEditorState(), {
      type: "project/load",
      project: {
        ...createProject(),
        version: 1,
        filters: { threshold: 120 },
        effectStack: undefined,
      },
    });

    expect(loaded.present.version).toBe(2);
    expect(loaded.present.filters).toEqual({});
    expect(loaded.present.effectStack).toEqual([
      expect.objectContaining({ type: "threshold", settings: { value: 120 } }),
    ]);
  });

  test("changes valid selection without creating history or clearing redo", () => {
    const layer = createAnnotation("box");
    const added = addLayer(createEditorState(), layer);
    const changed = editorReducer(added, {
      type: "canvas/update",
      patch: { width: 900 },
    });
    const undone = editorReducer(changed, { type: "history/undo" });
    const selected = editorReducer(undone, {
      type: "selection/set",
      id: layer.id,
    });

    expect(selected.selectedLayerId).toBe(layer.id);
    expect(selected.past).toBe(undone.past);
    expect(selected.present).toBe(undone.present);
    expect(selected.future).toBe(undone.future);
    expect(selected.future).toHaveLength(1);
  });

  test("ignores unknown selections and allows selection to be cleared", () => {
    const layer = createAnnotation("box");
    const state = addLayer(createEditorState(), layer);

    expect(
      editorReducer(state, { type: "selection/set", id: "missing" }),
    ).toBe(state);

    const selected = editorReducer(state, {
      type: "selection/set",
      id: layer.id,
    });
    const cleared = editorReducer(selected, {
      type: "selection/set",
      id: null,
    });

    expect(selected.selectedLayerId).toBe(layer.id);
    expect(cleared.selectedLayerId).toBeNull();
    expect(cleared.past).toBe(selected.past);
  });

  test("clears stale selection after remove, undo, and redo", () => {
    const layer = createAnnotation("box");
    const added = addLayer(createEditorState(), layer);
    const selected = editorReducer(added, {
      type: "selection/set",
      id: layer.id,
    });

    const removed = editorReducer(selected, {
      type: "layer/remove",
      id: layer.id,
    });
    const undoneAdd = editorReducer(selected, { type: "history/undo" });
    const restored = editorReducer(removed, { type: "history/undo" });
    const reselected = editorReducer(restored, {
      type: "selection/set",
      id: layer.id,
    });
    const redoneRemove = editorReducer(reselected, { type: "history/redo" });

    expect(removed.selectedLayerId).toBeNull();
    expect(undoneAdd.selectedLayerId).toBeNull();
    expect(redoneRemove.selectedLayerId).toBeNull();
  });

  test("returns the current state for unknown actions", () => {
    const state = createEditorState();

    expect(editorReducer(state, { type: "unknown" })).toBe(state);
  });

  test("resets all filter values to the supplied defaults in one commit", () => {
    const start = createEditorState({
      ...createProject(),
      filters: {
        contrast: 1.2,
        threshold: 90,
        grain: 0.8,
        duotone: { dark: [0, 0, 0], light: [255, 255, 255] },
      },
      effectStack: undefined,
    });
    const defaults = {
      threshold: null,
      halftone: false,
      grain: 0,
      grainSeed: 1,
      rgbOffset: 0,
      scanline: 0,
      duotone: null,
    };

    const reset = editorReducer(start, {
      type: "filters/reset",
      filters: defaults,
    });

    expect(reset.present.filters).toEqual({});
    expect(reset.present.effectStack).toEqual([]);
    expect(reset.past).toHaveLength(1);
  });

  test("caps undo history while retaining the newest commits", () => {
    expect(MAX_HISTORY_ENTRIES).toBe(100);
    let state = createEditorState();

    for (let width = 1; width <= 105; width += 1) {
      state = editorReducer(state, {
        type: "canvas/update",
        patch: { width },
      });
    }

    expect(state.past).toHaveLength(100);
    for (let index = 0; index < 100; index += 1) {
      state = editorReducer(state, { type: "history/undo" });
    }
    expect(state.present.canvas.width).toBe(5);
    expect(state.past).toHaveLength(0);
  });
});
