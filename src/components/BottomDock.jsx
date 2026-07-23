import React from "react";
import {
  Download,
  Layers3,
  Palette,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
} from "lucide-react";

const ITEMS = [
  ["tools", "打开工具面板", SlidersHorizontal],
  ["presets", "打开预设面板", WandSparkles],
  ["ai", "打开 AI 扫描面板", Sparkles],
  ["layers", "打开图层面板", Layers3],
  ["style", "打开样式面板", Palette],
];

export function BottomDock({ activeSheet, onOpen, onExport }) {
  return (
    <nav className="bottom-dock glass-panel" aria-label="移动端工作台">
      {ITEMS.map(([id, label, Icon]) => (
        <button key={id} type="button" onClick={() => onOpen(id)} aria-label={label} aria-pressed={activeSheet === id}>
          <Icon size={20} /><span>{id === "ai" ? "AI" : { tools: "工具", presets: "预设", layers: "图层", style: "样式" }[id]}</span>
        </button>
      ))}
      <button type="button" onClick={onExport} aria-label="移动端导出">
        <Download size={20} /><span>导出</span>
      </button>
    </nav>
  );
}
