import { createProject } from "./project.js";

export function createEditorState(project = createProject()) {
  return {
    past: [],
    present: project,
    future: [],
    selectedLayerId: null,
  };
}

function hasLayer(project, id) {
  return project.layers.some((layer) => layer.id === id);
}

function valuesEqual(first, second) {
  if (Object.is(first, second)) return true;
  if (
    first === null ||
    second === null ||
    typeof first !== "object" ||
    typeof second !== "object"
  ) {
    return false;
  }
  if (Array.isArray(first) !== Array.isArray(second)) return false;

  const firstKeys = Object.keys(first);
  const secondKeys = Object.keys(second);
  return (
    firstKeys.length === secondKeys.length &&
    firstKeys.every(
      (key) =>
        Object.hasOwn(second, key) &&
        valuesEqual(first[key], second[key]),
    )
  );
}

function hasEffectivePatch(target, patch) {
  return Object.entries(patch).some(
    ([key, value]) => !valuesEqual(target[key], value),
  );
}

function reconcileSelection(selectedLayerId, project) {
  return selectedLayerId !== null && hasLayer(project, selectedLayerId)
    ? selectedLayerId
    : null;
}

function commit(
  state,
  nextPresent,
  selectedLayerId = state.selectedLayerId,
) {
  return {
    ...state,
    past: [...state.past, state.present],
    present: nextPresent,
    future: [],
    selectedLayerId: reconcileSelection(selectedLayerId, nextPresent),
  };
}

export function editorReducer(state, action) {
  if (action.type === "history/undo" && state.past.length) {
    return {
      ...state,
      past: state.past.slice(0, -1),
      present: state.past.at(-1),
      future: [state.present, ...state.future],
      selectedLayerId: reconcileSelection(
        state.selectedLayerId,
        state.past.at(-1),
      ),
    };
  }

  if (action.type === "history/redo" && state.future.length) {
    return {
      ...state,
      past: [...state.past, state.present],
      present: state.future[0],
      future: state.future.slice(1),
      selectedLayerId: reconcileSelection(
        state.selectedLayerId,
        state.future[0],
      ),
    };
  }

  if (action.type === "layer/add") {
    if (hasLayer(state.present, action.layer.id)) {
      return state;
    }

    return commit(state, {
      ...state.present,
      layers: [...state.present.layers, action.layer],
    });
  }

  if (action.type === "layer/update") {
    const source = state.present.layers.find((layer) => layer.id === action.id);
    if (!source) {
      return state;
    }

    const { id: _ignoredId, ...patch } = action.patch ?? {};
    if (!hasEffectivePatch(source, patch)) {
      return state;
    }

    return commit(state, {
      ...state.present,
      layers: state.present.layers.map((layer) =>
        layer.id === action.id ? { ...layer, ...patch } : layer,
      ),
    });
  }

  if (action.type === "layers/updateMany") {
    const updates = new Map();
    for (const update of action.updates ?? []) {
      if (!hasLayer(state.present, update.id)) continue;
      const { id: _ignoredId, ...patch } = update.patch ?? {};
      updates.set(update.id, { ...(updates.get(update.id) ?? {}), ...patch });
    }

    let changed = false;
    const layers = state.present.layers.map((layer) => {
      const patch = updates.get(layer.id);
      if (!patch || !hasEffectivePatch(layer, patch)) return layer;
      changed = true;
      return { ...layer, ...patch };
    });
    if (!changed) return state;

    return commit(state, { ...state.present, layers });
  }

  if (action.type === "preset/apply") {
    const existingIds = new Set(state.present.layers.map(({ id }) => id));
    const layersToAdd = (action.layers ?? []).filter(
      ({ id }) => !existingIds.has(id),
    );
    const filters = {
      ...state.present.filters,
      ...(action.filters ?? {}),
    };
    if (
      !layersToAdd.length &&
      valuesEqual(filters, state.present.filters)
    ) {
      return state;
    }

    const nextPresent = {
      ...state.present,
      layers: [...state.present.layers, ...layersToAdd],
      filters,
    };
    return commit(state, nextPresent, action.selectedLayerId ?? null);
  }

  if (action.type === "layer/remove") {
    if (!state.present.layers.some((layer) => layer.id === action.id)) {
      return state;
    }

    return commit(state, {
      ...state.present,
      layers: state.present.layers.filter((layer) => layer.id !== action.id),
    });
  }

  if (action.type === "layer/move") {
    const layers = [...state.present.layers];
    const from = layers.findIndex((layer) => layer.id === action.id);
    if (from < 0) return state;

    const [layer] = layers.splice(from, 1);
    const to = Math.max(0, Math.min(action.toIndex, layers.length));
    layers.splice(to, 0, layer);

    if (layers.every((item, index) => item === state.present.layers[index])) {
      return state;
    }

    return commit(state, { ...state.present, layers });
  }

  if (action.type === "layer/duplicate") {
    const source = state.present.layers.find((layer) => layer.id === action.id);
    if (!source) return state;

    const copy = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      name: `${source.name}_copy`,
    };

    return commit(state, {
      ...state.present,
      layers: [...state.present.layers, copy],
    });
  }

  if (action.type === "layer/toggle" || action.type === "layer/lock") {
    if (!state.present.layers.some((layer) => layer.id === action.id)) {
      return state;
    }

    const key = action.type === "layer/toggle" ? "visible" : "locked";

    return commit(state, {
      ...state.present,
      layers: state.present.layers.map((layer) =>
        layer.id === action.id ? { ...layer, [key]: !layer[key] } : layer,
      ),
    });
  }

  if (action.type === "canvas/update") {
    const patch = action.patch ?? {};
    if (!hasEffectivePatch(state.present.canvas, patch)) {
      return state;
    }

    return commit(state, {
      ...state.present,
      canvas: { ...state.present.canvas, ...patch },
    });
  }

  if (action.type === "filters/update") {
    const patch = action.patch ?? {};
    if (!hasEffectivePatch(state.present.filters, patch)) {
      return state;
    }

    return commit(state, {
      ...state.present,
      filters: { ...state.present.filters, ...patch },
    });
  }

  if (action.type === "project/load") {
    return createEditorState(action.project);
  }

  if (action.type === "selection/set") {
    if (
      action.id === state.selectedLayerId ||
      (action.id !== null && !hasLayer(state.present, action.id))
    ) {
      return state;
    }

    return { ...state, selectedLayerId: action.id };
  }

  return state;
}
