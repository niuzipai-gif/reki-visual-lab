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
    expect(applied.present.filters).toEqual({
      contrast: 1.18,
      grain: 0.12,
    });
    expect(applied.selectedLayerId).toBe(first.id);
    expect(applied.past).toHaveLength(1);
    expect(undone.present.layers).toEqual([]);
    expect(undone.present.filters).toEqual({});
    expect(undone.selectedLayerId).toBeNull();
    expect(redone.present.layers).toEqual([first, second]);
    expect(redone.selectedLayerId).toBeNull();
  });
});

describe("layer actions", () => {
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
    expect(refiltered.present.filters).toEqual({
      contrast: 1.2,
      grain: 0.15,
    });
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

    expect(reset.present.filters).toEqual(defaults);
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
