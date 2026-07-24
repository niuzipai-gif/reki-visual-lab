export const DEFAULT_STYLE = Object.freeze({
  lineColor: "#e5484d",
  textColor: "#fff7ed",
  anchorColor: "#ff6b6b",
  lineWidth: 2,
  fontSize: 14,
  anchorSize: 5,
  dash: Object.freeze([]),
  opacity: 1,
  curveTension: 0,
});

export function createProject({ width = 1080, height = 1350 } = {}) {
  return {
    id: crypto.randomUUID(),
    version: 2,
    name: "未命名项目",
    updatedAt: Date.now(),
    canvas: { width, height, backgroundVisible: true },
    image: null,
    filters: {},
    effectStack: [],
    layers: [],
  };
}

/**
 * Upgrade persisted projects into the versioned non-destructive effect model.
 * A migrated flat filter object is consumed so effects can never remain hidden
 * behind a second rendering path.
 */
export function normalizeProject(project) {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    return createProject();
  }

  const legacyFilters =
    project.filters && typeof project.filters === "object" && !Array.isArray(project.filters)
      ? project.filters
      : {};
  const suppliedStack = normalizeEffectStack(project.effectStack);
  const effectStack = suppliedStack.length
    ? suppliedStack
    : legacyFiltersToEffectStack(legacyFilters);

  return {
    ...project,
    version: 2,
    canvas: {
      width: 1080,
      height: 1350,
      backgroundVisible: true,
      ...(project.canvas && typeof project.canvas === "object" ? project.canvas : {}),
    },
    filters: {},
    effectStack,
    layers: Array.isArray(project.layers) ? project.layers : [],
  };
}

export function createAnnotation(type, points = [], overrides = {}) {
  return {
    id: crypto.randomUUID(),
    type,
    name: `${type}_${String(Date.now()).slice(-4)}`,
    points,
    visible: true,
    locked: false,
    label: "label_01",
    value: null,
    style: { ...DEFAULT_STYLE, dash: [...DEFAULT_STYLE.dash] },
    ...overrides,
  };
}
import {
  legacyFiltersToEffectStack,
  normalizeEffectStack,
} from "../features/filters/effectStack.js";
