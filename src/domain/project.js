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
    version: 1,
    name: "未命名项目",
    updatedAt: Date.now(),
    canvas: { width, height, backgroundVisible: true },
    image: null,
    filters: {},
    layers: [],
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
