import React from "react";
import { createEffect, EFFECT_TYPES } from "./effectStack.js";
import { EffectStackPanel, effectDefaults } from "./EffectStackPanel.jsx";

const EFFECT_LABELS = Object.freeze({
  brightness: "亮度", contrast: "对比度", saturation: "饱和度", sharpness: "锐化",
  threshold: "阈值", halftone: "网点", grain: "颗粒", rgbOffset: "RGB 偏移",
  scanline: "扫描线", duotone: "双色调",
});

/** A non-destructive palette and editor for named effect cards. */
export function FilterPanel({ effects = [], onAction }) {
  const act = (action, ...args) => onAction?.(action, ...args);
  return <section className="filter-panel" aria-label="底图效果">
    <header><div><small>PIXEL FX</small><h2>底图效果</h2></div></header>
    <fieldset>
      <legend>添加效果</legend>
      <div className="effect-palette">
        {EFFECT_TYPES.map((type) => <button
          type="button"
          key={type}
          aria-label={`添加 ${EFFECT_LABELS[type]} 效果`}
          onClick={() => act("add", createEffect(type, { settings: effectDefaults(type) }))}
        >+ {EFFECT_LABELS[type]}</button>)}
      </div>
    </fieldset>
    <fieldset>
      <legend>效果层（顺序即渲染顺序）</legend>
      <EffectStackPanel effects={effects} onAction={act} />
    </fieldset>
    <button className="filter-reset" type="button" aria-label="重置底图效果" onClick={() => act("reset")}>清除全部效果</button>
  </section>;
}
