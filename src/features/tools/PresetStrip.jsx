import React from "react";
import { PRESETS } from "./presets.js";

export function PresetStrip({ activePreset, onApply }) {
  return (
    <section className="preset-strip" aria-label="快速预设">
      <span className="strip-label">PRESETS</span>
      <div className="preset-scroll">
        {PRESETS.map((preset) => (
          <button key={preset.id} type="button" aria-pressed={activePreset === preset.id} onClick={() => onApply(preset)}>
            <b>{preset.name}</b><small>{preset.id.replaceAll("-", " ").toUpperCase()}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
