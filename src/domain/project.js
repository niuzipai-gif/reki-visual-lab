import {
  legacyFiltersToEffectStack,
  normalizeEffectStack,
} from "../features/filters/effectStack.js";
import { DEFAULT_ANIMATION, sanitizeAnimation } from "../features/motion/animationRuntime.js";

const SOURCE_FILL_TYPES = new Set(["transparent", "black", "white", "preserve"]);

function normalizeFragmentRect(rect) {
  if (!rect || typeof rect !== "object" || Array.isArray(rect)) return null;
  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    x < 0 ||
    y < 0 ||
    width < 0.01 ||
    height < 0.01 ||
    x + width > 1 ||
    y + height > 1
  ) {
    return null;
  }
  return { x, y, width, height };
}

function normalizeFragmentOpacity(value) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return 1;
  return Math.max(0, Math.min(1, opacity));
}

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

export const DEFAULT_MOTION = Object.freeze({
  durationMs: 4000,
});

export function sanitizeMotion(motion) {
  const duration = Number(motion?.durationMs);
  return {
    durationMs: Number.isFinite(duration)
      ? Math.max(1000, Math.min(10000, Math.round(duration)))
      : DEFAULT_MOTION.durationMs,
  };
}

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
    motion: { ...DEFAULT_MOTION },
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
  const hasExplicitStack = Array.isArray(project.effectStack);
  const suppliedStack = normalizeEffectStack(project.effectStack);
  const effectStack = hasExplicitStack
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
    motion: sanitizeMotion(project.motion),
    layers: Array.isArray(project.layers)
      ? project.layers.map((layer) => normalizeLayer(layer))
      : [],
  };
}

function normalizeLayer(layer) {
  const normalized = {
    ...layer,
    animation: sanitizeAnimation(layer?.animation),
  };
  if (layer?.type !== "extractedFragment") return normalized;

  const sourceRect = normalizeFragmentRect(layer.sourceRect);
  const transform = normalizeFragmentRect(layer.transform);
  return {
    ...normalized,
    sourceMarkerId:
      typeof layer.sourceMarkerId === "string" ? layer.sourceMarkerId : "",
    sourceRect: sourceRect ?? { x: 0, y: 0, width: 0.01, height: 0.01 },
    transform: transform ?? sourceRect ?? { x: 0, y: 0, width: 0.01, height: 0.01 },
    linkedToMarker: layer.linkedToMarker !== false,
    sourceFill: SOURCE_FILL_TYPES.has(layer.sourceFill) ? layer.sourceFill : "preserve",
    opacity: normalizeFragmentOpacity(layer.opacity),
    effects: normalizeEffectStack(layer.effects ?? []),
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
    animation: { ...DEFAULT_ANIMATION },
    ...overrides,
  };
}
