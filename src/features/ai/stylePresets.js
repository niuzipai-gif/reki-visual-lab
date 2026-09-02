import { createAnnotation } from "../../domain/project.js";

const ALLOWED_ANNOTATION_TYPES = Object.freeze([
  "box",
  "leader",
  "label",
  "nodeCloud",
  "path",
  "orbit",
  "randomNodes",
  "stackBox",
]);
const ALLOWED_LABEL_MODES = Object.freeze(["none", "single", "per-layer"]);

export { ALLOWED_ANNOTATION_TYPES, ALLOWED_LABEL_MODES };

function seeded(seed = 1) {
  let value = Number(seed) >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function point(random, x = random(), y = random()) {
  return {
    x: Math.max(0.06, Math.min(0.94, Number(x) || 0)),
    y: Math.max(0.06, Math.min(0.94, Number(y) || 0)),
  };
}

function normalizeLandmarks(landmarks) {
  return Array.isArray(landmarks)
    ? landmarks
        .filter((item) => Number.isFinite(Number(item?.x)) && Number.isFinite(Number(item?.y)))
        .map(({ x, y }) => point(() => 0.5, x, y))
    : [];
}

function layerId(presetId, seed, index) {
  return `ai-style-${presetId}-${Number(seed) >>> 0}-${index}`;
}

function createLayerFactory(preset, seed) {
  const random = seeded(seed);
  let index = 0;

  return (type, points, overrides = {}) => {
    index += 1;
    return createAnnotation(type, points, {
      id: layerId(preset.id, seed, index),
      name: `${preset.id}_${String(index).padStart(2, "0")}`,
      label: `${preset.id.replaceAll("-", "_").toUpperCase()}_${String(index).padStart(2, "0")}`,
      ...overrides,
    });
  };
}

function createPresetLayers(preset, { seed = 1, landmarks = [] } = {}) {
  const create = createLayerFactory(preset, seed);
  const random = seeded(seed);
  const source = normalizeLandmarks(landmarks);
  const choose = (fallbackX, fallbackY, offset = 0) =>
    source[offset % source.length] ?? point(random, fallbackX, fallbackY);
  const type = ALLOWED_ANNOTATION_TYPES.includes(preset.annotationType)
    ? preset.annotationType
    : "path";
  let layers;

  if (preset.id === "silver-mist-portrait") {
    layers = [
      create("orbit", [choose(0.5, 0.46, 0), choose(0.78, 0.46, 1)]),
    ];
  } else if (preset.id === "mechanical-nodes") {
    layers = [
      create("nodeCloud", [
        choose(0.22, 0.28, 0),
        choose(0.5, 0.52, 1),
        choose(0.78, 0.68, 2),
      ]),
      create("box", [choose(0.2, 0.2, 1), choose(0.78, 0.8, 2)]),
    ];
  } else if (type === "label") {
    layers = [create("label", [choose(0.52, 0.42, 0)], { label: preset.name ?? "STYLE" })];
  } else {
    const geometry = {
      box: [choose(0.2, 0.2, 0), choose(0.78, 0.8, 1)],
      leader: [choose(0.2, 0.7, 0), choose(0.8, 0.3, 1)],
      randomNodes: [choose(0.2, 0.25, 0), choose(0.5, 0.5, 1), choose(0.8, 0.7, 2)],
      stackBox: [choose(0.16, 0.2, 0), choose(0.7, 0.76, 1)],
      orbit: [choose(0.5, 0.46, 0), choose(0.78, 0.46, 1)],
      nodeCloud: [choose(0.22, 0.28, 0), choose(0.5, 0.52, 1), choose(0.78, 0.68, 2)],
      path: [choose(0.14, 0.68, 0), choose(0.5, 0.34, 1), choose(0.84, 0.62, 2)],
    };
    layers = [create(type, geometry[type] ?? geometry.path)];
    if (type === "nodeCloud") {
      layers.push(create("box", [choose(0.2, 0.2, 1), choose(0.78, 0.8, 2)]));
    }
  }

  if (type === "label") return layers;
  const labels = layers.map((layer, index) =>
    create("label", [layer.points[0] ?? choose(0.5, 0.5, index)], {
      label: `${String(preset.name ?? "STYLE").slice(0, 28)}_${String(index + 1).padStart(2, "0")}`,
    }),
  );
  if (preset.labelMode === "none") return layers;
  if (preset.labelMode === "per-layer") return layers.flatMap((layer, index) => [layer, labels[index]]);
  return [...layers, labels[0]];
}

export const STYLE_PRESETS = Object.freeze([
  Object.freeze({
    id: "redline-archive",
    name: "红线档案",
    description: "以红色轨迹和档案式标记强调服装轮廓。",
    filters: Object.freeze({}),
    annotationType: "path",
    density: 68,
    labelMode: "single",
    risk: "细线可能在低对比背景中减弱。",
  }),
  Object.freeze({
    id: "silver-mist-portrait",
    name: "银雾肖像",
    description: "用柔和轨道与红色标签突出人物主体。",
    filters: Object.freeze({}),
    annotationType: "orbit",
    density: 52,
    labelMode: "single",
    risk: "过度去饱和会削弱彩色服装细节。",
  }),
  Object.freeze({
    id: "mechanical-nodes",
    name: "机械节点",
    description: "用节点和框线建立机械感构图。",
    filters: Object.freeze({}),
    annotationType: "nodeCloud",
    density: 76,
    labelMode: "single",
    risk: "节点过密会遮挡服装纹理，请按画面留白调整。",
  }),
]);

export function createStyleLayers(preset, options = {}) {
  if (!preset || typeof preset !== "object") return [];
  return createPresetLayers(preset, options);
}

export function findStylePreset(id) {
  return STYLE_PRESETS.find((preset) => preset.id === id) ?? null;
}
