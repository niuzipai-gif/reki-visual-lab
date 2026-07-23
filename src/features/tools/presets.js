import { createAnnotation } from "../../domain/project.js";

function seeded(seed) {
  let value = Number(seed) >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function point(random, x = random(), y = random()) {
  return {
    x: Math.max(0.06, Math.min(0.94, x)),
    y: Math.max(0.06, Math.min(0.94, y)),
  };
}

function layerFactory(presetId, seed, landmarks) {
  const random = seeded(seed);
  let index = 0;
  const landmark = (at) =>
    landmarks[at % landmarks.length] ?? point(random);

  return (type, points, overrides = {}) => {
    index += 1;
    return createAnnotation(type, points, {
      id: `${presetId}-${seed >>> 0}-${index}`,
      name: `${presetId}_${String(index).padStart(2, "0")}`,
      label: `${presetId.replaceAll("-", "_")}_${String(index).padStart(2, "0")}`,
      ...overrides,
    });
  };
}

function build(presetId, recipe) {
  return ({ seed = 1, landmarks = [] } = {}) => {
    const stableLandmarks = landmarks.length
      ? landmarks.map(({ x, y }) => ({ x, y }))
      : [];
    const random = seeded(seed);
    const create = layerFactory(presetId, seed, stableLandmarks);
    const landmark = (index) =>
      stableLandmarks[index % stableLandmarks.length] ?? point(random);
    return recipe({ create, landmark, random });
  };
}

export const PRESETS = Object.freeze([
  {
    id: "neural-nodes",
    name: "神经节点",
    filters: { contrast: 1.08, saturation: 0.76 },
    createLayers: build("neural-nodes", ({ create, landmark }) => [
      create("nodeCloud", [landmark(0), landmark(1), landmark(2)]),
      create("path", [landmark(0), landmark(1), landmark(2)], {
        style: {
          ...createAnnotation("path").style,
          curveTension: 0.42,
        },
      }),
      create("label", [landmark(1)], { label: "NEURAL_01" }),
    ]),
  },
  {
    id: "archive-scan",
    name: "档案扫描",
    filters: { contrast: 1.18, grain: 0.12 },
    createLayers: build("archive-scan", ({ create, random }) => [
      create("stackBox", [
        point(random, 0.14, 0.18),
        point(random, 0.72 + random() * 0.12, 0.78),
      ]),
      create("leader", [
        point(random, 0.54, 0.4),
        point(random, 0.82, 0.31),
      ], { label: "ARCHIVE_04" }),
    ]),
  },
  {
    id: "sacred-orbit",
    name: "圣像轨道",
    filters: { brightness: 0.92, saturation: 0.82 },
    createLayers: build("sacred-orbit", ({ create, random }) => [
      create("orbit", [
        point(random, 0.5, 0.46),
        point(random, 0.76 + random() * 0.08, 0.46),
      ]),
      create("randomNodes", [
        point(random, 0.3, 0.46),
        point(random, 0.5, 0.2),
        point(random, 0.72, 0.6),
      ]),
      create("label", [point(random, 0.57, 0.32)], { label: "ORBIT_03" }),
    ]),
  },
  {
    id: "mechanical-label",
    name: "机械标注",
    filters: { contrast: 1.12, sharpness: 0.18 },
    createLayers: build("mechanical-label", ({ create, random }) => [
      create("box", [
        point(random, 0.22, 0.2),
        point(random, 0.68, 0.72),
      ]),
      create("leader", [
        point(random, 0.48, 0.35),
        point(random, 0.83, 0.26),
      ], { label: "MECH_08" }),
      create("label", [point(random, 0.22, 0.78)], { value: 2.55 }),
    ]),
  },
  {
    id: "anomaly-signal",
    name: "异常信号",
    filters: { grain: 0.24, rgbOffset: 3 },
    createLayers: build("anomaly-signal", ({ create, random }) => [
      create("path", [
        point(random, 0.12, 0.6),
        point(random, 0.36, 0.34),
        point(random, 0.74, 0.66),
      ], { style: { ...createAnnotation("path").style, dash: [8, 6] } }),
      create("randomNodes", [
        point(random),
        point(random),
        point(random),
        point(random),
      ]),
    ]),
  },
  {
    id: "visual-measure",
    name: "视觉测量",
    filters: { contrast: 1.04, brightness: 1.03 },
    createLayers: build("visual-measure", ({ create, random }) => [
      create("leader", [
        point(random, 0.24, 0.72),
        point(random, 0.72, 0.72),
      ], { label: "72.40 CM", value: 72.4 }),
      create("box", [
        point(random, 0.28, 0.16),
        point(random, 0.7, 0.78),
      ]),
      create("label", [point(random, 0.72, 0.74)], { label: "RATIO 4:5" }),
    ]),
  },
]);
