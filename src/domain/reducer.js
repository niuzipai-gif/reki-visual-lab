import { createProject, normalizeProject } from "./project.js";
import {
  sanitizeEditorPatch,
  styleToEditorPatch,
} from "../features/ai/styleAdvisor.js";
import {
  createEffect,
  effectStackToLegacyFilters,
  legacyFilterPatchToEffects,
  legacyFiltersToEffectStack,
  normalizeEffectStack,
} from "../features/filters/effectStack.js";

export const MAX_HISTORY_ENTRIES = 100;

export function createEditorState(project = createProject()) {
  return {
    past: [],
    present: normalizeProject(project),
    future: [],
    selectedLayerId: null,
  };
}

function addEffects(stack, effects) {
  const ids = new Set(stack.map(({ id }) => id));
  const additions = [];
  for (const source of effects ?? []) {
    const effect = createEffect(source?.type, source);
    if (!effect || ids.has(effect.id)) continue;
    ids.add(effect.id);
    additions.push(effect);
  }
  return additions;
}

const LEGACY_EFFECT_TYPE_BY_FILTER_KEY = Object.freeze({
  brightness: "brightness",
  contrast: "contrast",
  saturation: "saturation",
  sharpness: "sharpness",
  threshold: "threshold",
  halftone: "halftone",
  grain: "grain",
  grainSeed: "grain",
  rgbOffset: "rgbOffset",
  chromaShift: "rgbOffset",
  scanline: "scanline",
  duotone: "duotone",
});
const LEGACY_EFFECT_TYPES = new Set(
  Object.values(LEGACY_EFFECT_TYPE_BY_FILTER_KEY),
);

function isLegacyEffect(effect) {
  return effect?.id === `legacy-${effect.type}`;
}

/**
 * Compatibility actions from the retired flat-filter panel may only touch the
 * cards they own. Custom/duplicate cards keep their identity, order, opacity,
 * and visibility until the new effect panel edits them explicitly.
 */
function patchLegacyEffects(effectStack, patch, { reset = false } = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return effectStack;
  }
  const affectedTypes = reset
    ? new Set(LEGACY_EFFECT_TYPES)
    : new Set(
    Object.keys(patch)
      .map((key) => LEGACY_EFFECT_TYPE_BY_FILTER_KEY[key])
      .filter(Boolean),
    );
  if (!affectedTypes.size) return effectStack;

  const compatibilityEffects = effectStack.filter(isLegacyEffect);
  const legacyFilters = reset
    ? {}
    : effectStackToLegacyFilters(compatibilityEffects);
  const replacements = legacyFiltersToEffectStack({ ...legacyFilters, ...patch });
  const byType = new Map(replacements.map((effect) => [effect.type, effect]));
  const presentTypes = new Set();
  const output = [];

  for (const effect of effectStack) {
    if (!isLegacyEffect(effect) || !affectedTypes.has(effect.type)) {
      output.push(effect);
      continue;
    }
    presentTypes.add(effect.type);
    const replacement = byType.get(effect.type);
    if (!replacement) continue;
    output.push({ ...effect, settings: replacement.settings });
  }
  for (const effect of replacements) {
    if (affectedTypes.has(effect.type) && !presentTypes.has(effect.type)) {
      output.push(effect);
    }
  }
  return output;
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
    past: [...state.past, state.present].slice(-MAX_HISTORY_ENTRIES),
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
      past: [...state.past, state.present].slice(-MAX_HISTORY_ENTRIES),
      present: state.future[0],
      future: state.future.slice(1),
      selectedLayerId: reconcileSelection(
        state.selectedLayerId,
        state.future[0],
      ),
    };
  }

  if (action.type === "layers/addMany") {
    const ids = new Set(state.present.layers.map(({ id }) => id));
    const layers = [];
    for (const layer of action.layers ?? []) {
      if (!layer?.id || ids.has(layer.id)) continue;
      ids.add(layer.id);
      layers.push(layer);
    }
    if (!layers.length) return state;

    return commit(
      state,
      {
        ...state.present,
        layers: [...state.present.layers, ...layers],
      },
      action.selectedLayerId ?? layers[0].id,
    );
  }

  if (action.type === "layers/removeBySource") {
    const layers = state.present.layers.filter(
      (layer) => layer.source !== action.source,
    );
    if (layers.length === state.present.layers.length) return state;
    return commit(state, { ...state.present, layers });
  }

  if (action.type === "layers/clear") {
    if (!state.present.layers.length) return state;
    return commit(
      state,
      { ...state.present, layers: [] },
      null,
    );
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
    const effectsToAdd = addEffects(
      state.present.effectStack ?? [],
      legacyFilterPatchToEffects(action.filters),
    );
    if (
      !layersToAdd.length &&
      !effectsToAdd.length
    ) {
      return state;
    }

    const nextPresent = {
      ...state.present,
      layers: [...state.present.layers, ...layersToAdd],
      effectStack: [...(state.present.effectStack ?? []), ...effectsToAdd],
    };
    return commit(state, nextPresent, action.selectedLayerId ?? null);
  }

  if (action.type === "style/apply") {
    const recommendation = action.recommendation ?? action.patch ?? {};
    const generatedPatch = Array.isArray(recommendation.layers)
      ? sanitizeEditorPatch({
          filters: recommendation.filters,
          layers: recommendation.layers,
        })
      : sanitizeEditorPatch(
          styleToEditorPatch(recommendation, {
            features: action.features,
            seed: action.seed,
          }),
        );
    if (!generatedPatch) return state;
    let appliedFilters = generatedPatch.filters;
    if (action.filters !== undefined && action.filters !== null) {
      const filterPatch = sanitizeEditorPatch({ filters: action.filters, layers: [] });
      if (!filterPatch) return state;
      appliedFilters = filterPatch.filters;
    }
    const generatedLayers = (generatedPatch.layers ?? []).map((layer) => ({
      ...structuredClone(layer),
      source: "ai-style",
    }));
    const existingIds = new Set(state.present.layers.map(({ id }) => id));
    const layersToAdd = generatedLayers.filter(({ id }) => {
      if (!id || existingIds.has(id)) return false;
      existingIds.add(id);
      return true;
    });
    const effectsToAdd = addEffects(
      state.present.effectStack ?? [],
      legacyFilterPatchToEffects(appliedFilters),
    );
    if (!layersToAdd.length && !effectsToAdd.length) {
      return state;
    }
    const nextPresent = {
      ...state.present,
      layers: [...state.present.layers, ...layersToAdd],
      effectStack: [...(state.present.effectStack ?? []), ...effectsToAdd],
    };
    return commit(
      state,
      nextPresent,
      action.selectedLayerId ?? layersToAdd[0]?.id ?? null,
    );
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

  if (action.type === "effects/add") {
    const effectsToAdd = addEffects(state.present.effectStack ?? [], [action.effect]);
    if (!effectsToAdd.length) return state;
    return commit(state, {
      ...state.present,
      effectStack: [...(state.present.effectStack ?? []), ...effectsToAdd],
    });
  }

  if (action.type === "effects/update") {
    const current = (state.present.effectStack ?? []).find(
      (effect) => effect.id === action.id,
    );
    if (!current) return state;
    const { id: _ignoredId, type: _ignoredType, ...patch } = action.patch ?? {};
    const next = createEffect(current.type, { ...current, ...patch, id: current.id });
    if (!next || valuesEqual(next, current)) return state;
    return commit(state, {
      ...state.present,
      effectStack: state.present.effectStack.map((effect) =>
        effect.id === action.id ? next : effect,
      ),
    });
  }

  if (action.type === "effects/remove") {
    const effectStack = (state.present.effectStack ?? []).filter(
      (effect) => effect.id !== action.id,
    );
    if (effectStack.length === (state.present.effectStack ?? []).length) return state;
    return commit(state, { ...state.present, effectStack });
  }

  if (action.type === "effects/move") {
    const effectStack = [...(state.present.effectStack ?? [])];
    const from = effectStack.findIndex((effect) => effect.id === action.id);
    if (from < 0) return state;
    const [effect] = effectStack.splice(from, 1);
    const to = Math.max(0, Math.min(Number(action.toIndex) || 0, effectStack.length));
    effectStack.splice(to, 0, effect);
    if (effectStack.every((item, index) => item === state.present.effectStack[index])) {
      return state;
    }
    return commit(state, { ...state.present, effectStack });
  }

  if (action.type === "effects/reset") {
    const effectStack = normalizeEffectStack(action.effects ?? []);
    if (valuesEqual(effectStack, state.present.effectStack ?? [])) return state;
    return commit(state, { ...state.present, effectStack });
  }

  if (action.type === "filters/update") {
    const patch = action.patch ?? {};
    const effectStack = patchLegacyEffects(state.present.effectStack ?? [], patch);
    if (valuesEqual(effectStack, state.present.effectStack ?? [])) {
      return state;
    }

    return commit(state, {
      ...state.present,
      filters: {},
      effectStack,
    });
  }

  if (action.type === "filters/reset") {
    const effectStack = patchLegacyEffects(
      state.present.effectStack ?? [],
      action.filters ?? {},
      { reset: true },
    );
    if (valuesEqual(effectStack, state.present.effectStack ?? [])) {
      return state;
    }

    return commit(state, {
      ...state.present,
      filters: {},
      effectStack,
    });
  }

  if (action.type === "project/load") {
    return createEditorState(normalizeProject(action.project));
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
