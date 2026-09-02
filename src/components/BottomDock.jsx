import React from "react";
import {
  Download,
  Eye,
  EyeOff,
  Layers3,
  MousePointer2,
  Palette,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

const ITEMS = [
  ["tools", "打开工具面板", SlidersHorizontal],
  ["ai", "打开 AI 扫描面板", Sparkles],
  ["layers", "打开图层面板", Layers3],
  ["style", "打开样式面板", Palette],
];

export function BottomDock({
  activeSheet,
  activeTool = "select",
  canCompare = false,
  comparisonVisible = false,
  onOpen,
  onSelect = () => {},
  onExport,
  onToggleComparison,
}) {
  return (
    <nav className="bottom-dock glass-panel" aria-label="移动端工作台">
      <button
        type="button"
        onClick={onSelect}
        aria-label="移动端返回选择模式"
        aria-pressed={activeTool === "select"}
      >
        <MousePointer2 size={20} /><span>选择</span>
      </button>
      {ITEMS.map(([id, label, Icon]) => (
        <button key={id} type="button" onClick={() => onOpen(id)} aria-label={label} aria-pressed={activeSheet === id}>
          <Icon size={20} /><span>{id === "ai" ? "AI" : { tools: "工具", layers: "图层", style: "样式" }[id]}</span>
        </button>
      ))}
      {canCompare ? (
        <button
          type="button"
          onClick={onToggleComparison}
          aria-label={comparisonVisible ? "移动端关闭对比" : "移动端原图对比"}
          aria-pressed={comparisonVisible}
        >
          {comparisonVisible ? <EyeOff size={20} /> : <Eye size={20} />}
          <span>对比</span>
        </button>
      ) : null}
      <button type="button" onClick={onExport} aria-label="移动端导出">
        <Download size={20} /><span>导出</span>
      </button>
    </nav>
  );
}
