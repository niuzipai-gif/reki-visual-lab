import React from "react";
import {
  BoxSelect,
  CircleDotDashed,
  Filter,
  Focus,
  Frame,
  MousePointer2,
  Orbit,
  Sparkles,
  Type,
  Waypoints,
} from "lucide-react";
import { TOOL_DEFINITIONS } from "./toolDefinitions.js";

const ICONS = {
  select: MousePointer2,
  "point-box": BoxSelect,
  "stack-box": Frame,
  "node-path": Waypoints,
  leader: Focus,
  "global-nodes": CircleDotDashed,
  "random-nodes": Sparkles,
  orbit: Orbit,
  label: Type,
  filter: Filter,
};

export function ToolRail({ activeTool, onSelectTool, onAiScan }) {
  return (
    <aside className="tool-rail glass-panel">
      <span className="rail-label">TOOLS</span>
      <div role="toolbar" aria-label="标注工具">
        <button type="button" onClick={onAiScan} aria-label="AI 扫描"><Sparkles size={19} /><span>AI 扫描</span></button>
        {TOOL_DEFINITIONS.map((tool) => {
          const Icon = ICONS[tool.id];
          return (
            <button key={tool.id} type="button" onClick={() => onSelectTool(tool.id)} aria-label={tool.label} aria-pressed={activeTool === tool.id}>
              <Icon size={19} /><span>{tool.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
