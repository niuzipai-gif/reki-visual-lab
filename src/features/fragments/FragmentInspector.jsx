import React from "react";

const SOURCE_FILL_OPTIONS = [
  ["preserve", "保留原图"],
  ["transparent", "透明"],
  ["black", "黑底"],
  ["white", "白底"],
];

/** Inspector controls for a rectangular original-pixel reference layer. */
export function FragmentInspector({ layer, onPatch, onRelink }) {
  if (!layer || layer.type !== "extractedFragment") return null;
  const opacity = Number.isFinite(Number(layer.opacity))
    ? Math.max(0, Math.min(1, Number(layer.opacity)))
    : 1;

  return (
    <div className="inspector-form fragment-inspector">
      <header>
        <div>
          <small>EXTRACTED ORIGINAL</small>
          <h2>{layer.name}</h2>
        </div>
        <span className="type-badge">片段</span>
      </header>
      <p className="fragment-inspector-copy">
        这是来自标记可见范围的矩形原图像素；不会抠图，也不会移动原标记。
      </p>
      <fieldset>
        <legend>原位置</legend>
        <label className="control-field">
          <span>原位置填充</span>
          <select
            aria-label="原位置填充"
            value={layer.sourceFill ?? "preserve"}
            onChange={(event) => onPatch?.({ sourceFill: event.target.value })}
          >
            {SOURCE_FILL_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </fieldset>
      <fieldset>
        <legend>片段状态</legend>
        <label className="control-field">
          <span>片段透明度 {Math.round(opacity * 100)}%</span>
          <input
            aria-label="片段透明度"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(event) => onPatch?.({ opacity: Number(event.target.value) })}
          />
        </label>
        <p className="fragment-inspector-meta">
          {layer.linkedToMarker === false
            ? "已独立移动或缩放，可继续添加效果和动态。"
            : "当前与来源标记范围联动；移动或缩放后会自动独立。"}
        </p>
        {layer.linkedToMarker === false ? (
          <button
            type="button"
            className="fragment-relink-button"
            onClick={() => onRelink?.()}
          >
            重新关联标记
          </button>
        ) : null}
      </fieldset>
    </div>
  );
}
