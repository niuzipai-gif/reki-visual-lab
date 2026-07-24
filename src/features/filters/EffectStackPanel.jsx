import React, { useState } from "react";
import { EFFECT_TYPES } from "./effectStack.js";

const DEFAULT_SETTINGS = Object.freeze({
  brightness: { amount: 1.08 },
  contrast: { amount: 1.12 },
  saturation: { amount: 0.85 },
  sharpness: { amount: 0.35, legacyContrast: false },
  threshold: { value: 128 },
  halftone: {},
  grain: { amount: 0.3, seed: 1 },
  rgbOffset: { offset: 4 },
  scanline: { amount: 0.35 },
  duotone: { dark: [18, 22, 24], light: [239, 190, 59] },
});

function clamp(value, minimum, maximum, fallback = minimum) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
}

function rgbToHex(rgb = []) {
  return `#${[0, 1, 2]
    .map((index) => clamp(rgb[index], 0, 255, 0).toString(16).padStart(2, "0"))
    .join("")}`;
}

function hexToRgb(hex) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function rangeFor(effect) {
  switch (effect.type) {
    case "brightness":
    case "contrast":
    case "saturation": return { key: "amount", label: "强度", min: 0, max: 2, step: 0.05, fallback: 1 };
    case "sharpness": return { key: "amount", label: "强度", min: 0, max: 2, step: 0.05, fallback: 0 };
    case "threshold": return { key: "value", label: "阈值", min: 0, max: 255, step: 1, fallback: 128 };
    case "grain":
    case "scanline": return { key: "amount", label: "强度", min: 0, max: 1, step: 0.05, fallback: 0 };
    case "rgbOffset": return { key: "offset", label: "偏移", min: -12, max: 12, step: 1, fallback: 0 };
    default: return null;
  }
}

function EffectSettings({ effect, onAction }) {
  const range = rangeFor(effect);
  const updateSettings = (patch) => onAction?.("update", effect.id, {
    settings: { ...effect.settings, ...patch },
  });
  if (range) {
    const value = effect.settings?.[range.key] ?? range.fallback;
    return (
      <label className="control-field">
        {range.label}
        <input
          type="range"
          aria-label={`${effect.name} ${range.label}`}
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          onChange={(event) => updateSettings({ [range.key]: Number(event.target.value) })}
        />
      </label>
    );
  }
  if (effect.type === "duotone") {
    return <div className="color-grid">
      <label className="control-field">暗部
        <input type="color" aria-label={`${effect.name} 暗部颜色`} value={rgbToHex(effect.settings?.dark)} onChange={(event) => updateSettings({ dark: hexToRgb(event.target.value) })} />
      </label>
      <label className="control-field">亮部
        <input type="color" aria-label={`${effect.name} 亮部颜色`} value={rgbToHex(effect.settings?.light)} onChange={(event) => updateSettings({ light: hexToRgb(event.target.value) })} />
      </label>
    </div>;
  }
  return <p className="effect-settings-note">此效果没有额外参数。</p>;
}

export function EffectStackPanel({ effects = [], onAction }) {
  const [openId, setOpenId] = useState(null);
  if (!effects.length) return <p className="effect-stack-empty">还没有效果层。从上方添加后可随时关闭、调节或删除。</p>;
  return (
    <ol className="effect-stack" aria-label="效果层列表">
      {effects.map((effect, index) => {
        const isOpen = openId === effect.id;
        const label = effect.name || effect.type;
        return <li className="effect-card" key={effect.id}>
          <div className="effect-card-row">
            <button type="button" className="effect-eye" aria-label={`${effect.visible ? "隐藏" : "显示"} ${label}`} onClick={() => onAction?.("update", effect.id, { visible: !effect.visible })}>{effect.visible ? "◉" : "○"}</button>
            <strong>{label}</strong>
            <button type="button" aria-label={`展开 ${label} 设置`} aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : effect.id)}>设置</button>
          </div>
          <label className="control-field effect-opacity">不透明度
            <input type="range" aria-label={`${label} 不透明度`} min="0" max="1" step="0.05" value={effect.opacity} onChange={(event) => onAction?.("update", effect.id, { opacity: Number(event.target.value) })} />
          </label>
          {isOpen ? <div className="effect-settings"><EffectSettings effect={effect} onAction={onAction} /></div> : null}
          <div className="effect-card-actions">
            <button type="button" aria-label={`上移 ${label}`} disabled={index === 0} onClick={() => onAction?.("move", effect.id, index - 1)}>上移</button>
            <button type="button" aria-label={`下移 ${label}`} disabled={index === effects.length - 1} onClick={() => onAction?.("move", effect.id, index + 1)}>下移</button>
            <button type="button" aria-label={`删除 ${label}`} onClick={() => onAction?.("remove", effect.id)}>删除</button>
          </div>
        </li>;
      })}
    </ol>
  );
}

export function effectDefaults(type) {
  return EFFECT_TYPES.includes(type) ? structuredClone(DEFAULT_SETTINGS[type]) : {};
}
