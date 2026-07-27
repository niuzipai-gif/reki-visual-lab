export const LAYER_TYPE_LABELS = Object.freeze({
  box: "点框",
  stackBox: "叠框",
  path: "节点路径",
  leader: "单侧引线",
  nodeCloud: "全局节点",
  randomNodes: "随机节点",
  orbit: "轨道圆环",
  label: "标签文字",
  extractedFragment: "提取片段",
});

export function layerTypeLabel(type) {
  return LAYER_TYPE_LABELS[type] ?? "未知图层";
}

export function layerTypeShortLabel(type) {
  return layerTypeLabel(type).slice(0, 2);
}
