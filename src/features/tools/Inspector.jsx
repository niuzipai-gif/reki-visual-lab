import React, { useEffect, useId, useState } from "react";
import { Paintbrush, Trash2 } from "lucide-react";
import { isSpatialMarker } from "../fragments/fragmentDomain.js";
import { FragmentInspector } from "../fragments/FragmentInspector.jsx";

const LABEL_TYPES = new Set([
  "label",
  "leader",
  "box",
  "stackBox",
  "path",
  "nodeCloud",
  "randomNodes",
  "orbit",
]);
const POSITIONED_LABEL_TYPES = new Set(
  [...LABEL_TYPES].filter((type) => type !== "label"),
);
const PATH_TYPES = new Set(["path", "leader", "nodeCloud"]);
const BOX_TYPES = new Set(["box", "stackBox"]);
const ASPECT_RATIOS = {
  "1:1": 1,
  "4:5": 4 / 5,
  "3:4": 3 / 4,
  "16:9": 16 / 9,
};

function clampNormalized(value) {
  return Math.max(0, Math.min(1, value));
}

function boxDimension(layer, axis) {
  return Math.abs((layer.points?.[1]?.[axis] ?? 0) - (layer.points?.[0]?.[axis] ?? 0));
}

function resizeBox(layer, axis, value) {
  const [origin, current = origin] = layer.points;
  const direction = Math.sign(current[axis] - origin[axis]) || 1;
  return [
    origin,
    {
      ...current,
      [axis]: clampNormalized(origin[axis] + direction * Number(value)),
    },
  ];
}

function Field({ label, children, className = "" }) {
  return <label className={`control-field ${className}`.trim()}><span>{label}</span>{children}</label>;
}

export function Inspector({
  layer,
  onPatch,
  onBatchLabel,
  onApplyStyle,
  onDelete,
  onExtract,
  onRelink,
}) {
  const [batchLabelDraft, setBatchLabelDraft] = useState(
    layer?.label ?? "",
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedPanelId = `reki-inspector-advanced-${useId().replaceAll(":", "")}`;

  useEffect(() => {
    setBatchLabelDraft(layer?.label ?? "");
  }, [layer?.id, layer?.label]);

  if (!layer) {
    return (
      <section className="inspector-empty" aria-live="polite">
        <Paintbrush size={22} />
        <b>选择一个图层</b>
        <span>样式与对象参数会显示在这里。</span>
      </section>
    );
  }

  if (layer.type === "extractedFragment") {
    return <FragmentInspector layer={layer} onPatch={onPatch} onRelink={onRelink} />;
  }

  const style = layer.style;
  const patchStyle = (patch) => onPatch({ style: { ...style, ...patch } });
  const showLabels = layer.showLabel !== false;
  const dashLength = style.dash[0] ?? 8;
  const dashGap = style.dash[1] ?? 6;
  const labelOffset = layer.labelOffset ?? { x: 0, y: 0 };

  return (
    <div className="inspector-form">
      <header><div><small>SELECTED OBJECT</small><h2>{layer.name}</h2></div><span className="type-badge">{layer.type}</span></header>
      {isSpatialMarker(layer) ? (
        <button
          type="button"
          className="extract-fragment-button"
          onClick={() => onExtract?.()}
        >
          提取框内原图
        </button>
      ) : null}
      <button
        type="button"
        className="advanced-settings-button"
        aria-expanded={advancedOpen}
        aria-controls={advancedPanelId}
        onClick={() => setAdvancedOpen((open) => !open)}
      >
        高级设置
      </button>
      <div id={advancedPanelId} aria-hidden={!advancedOpen}>
      {advancedOpen ? <>
      <fieldset>
        <legend>颜色</legend>
        <div className="color-grid">
          <Field label="线条颜色"><input aria-label="线条颜色" type="color" value={style.lineColor} onChange={(event) => patchStyle({ lineColor: event.target.value })} /></Field>
          <Field label="文字颜色"><input aria-label="文字颜色" type="color" value={style.textColor} onChange={(event) => patchStyle({ textColor: event.target.value })} /></Field>
          <Field label="锚点颜色"><input aria-label="锚点颜色" type="color" value={style.anchorColor} onChange={(event) => patchStyle({ anchorColor: event.target.value })} /></Field>
        </div>
      </fieldset>
      <fieldset>
        <legend>外观</legend>
        <Field label={`线条粗细 ${style.lineWidth}px`}><input aria-label="线条粗细" type="range" min="1" max="12" step="1" value={style.lineWidth} onChange={(event) => patchStyle({ lineWidth: Number(event.target.value) })} /></Field>
        <Field label={`文字大小 ${style.fontSize}px`}><input aria-label="文字大小" type="range" min="8" max="64" value={style.fontSize} onChange={(event) => patchStyle({ fontSize: Number(event.target.value) })} /></Field>
        <Field label={`锚点大小 ${style.anchorSize}px`}><input aria-label="锚点大小" type="range" min="2" max="20" value={style.anchorSize} onChange={(event) => patchStyle({ anchorSize: Number(event.target.value) })} /></Field>
        <Field label="虚线">
          <select aria-label="虚线" value={style.dash.length ? "dashed" : "solid"} onChange={(event) => patchStyle({ dash: event.target.value === "dashed" ? [dashLength, dashGap] : [] })}>
            <option value="solid">实线</option><option value="dashed">虚线</option>
          </select>
        </Field>
        <div className="range-grid">
          <Field label="虚线长度"><input aria-label="虚线长度" type="number" min="1" max="64" value={dashLength} onChange={(event) => patchStyle({ dash: [Number(event.target.value), dashGap] })} /></Field>
          <Field label="虚线间隔"><input aria-label="虚线间隔" type="number" min="1" max="64" value={dashGap} onChange={(event) => patchStyle({ dash: [dashLength, Number(event.target.value)] })} /></Field>
        </div>
        <Field label={`透明度 ${Math.round(style.opacity * 100)}%`}><input aria-label="透明度" type="range" min="0.1" max="1" step="0.05" value={style.opacity} onChange={(event) => patchStyle({ opacity: Number(event.target.value) })} /></Field>
        {PATH_TYPES.has(layer.type) ? (
          <Field label={`曲线张力 ${style.curveTension.toFixed(2)}`}><input aria-label="曲线张力" type="range" min="0" max="1" step="0.05" value={style.curveTension} onChange={(event) => patchStyle({ curveTension: Number(event.target.value) })} /></Field>
        ) : null}
      </fieldset>
      {BOX_TYPES.has(layer.type) ? (
        <fieldset>
          <legend>检测框</legend>
          <div className="range-grid">
            <Field label="框宽"><input aria-label="框宽" type="number" min="0.01" max="1" step="0.01" value={boxDimension(layer, "x")} onChange={(event) => onPatch({ points: resizeBox(layer, "x", event.target.value), aspectRatio: "free" })} /></Field>
            <Field label="框高"><input aria-label="框高" type="number" min="0.01" max="1" step="0.01" value={boxDimension(layer, "y")} onChange={(event) => onPatch({ points: resizeBox(layer, "y", event.target.value), aspectRatio: "free" })} /></Field>
          </div>
          <Field label="框宽高比">
            <select
              aria-label="框宽高比"
              value={layer.aspectRatio ?? "free"}
              onChange={(event) => {
                const aspectRatio = event.target.value;
                if (aspectRatio === "free") {
                  onPatch({ aspectRatio });
                  return;
                }
                const ratio = ASPECT_RATIOS[aspectRatio];
                onPatch({
                  aspectRatio,
                  points: resizeBox(
                    layer,
                    "y",
                    boxDimension(layer, "x") / ratio,
                  ),
                });
              }}
            >
              <option value="free">自由</option>
              {Object.keys(ASPECT_RATIOS).map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
            </select>
          </Field>
        </fieldset>
      ) : null}
      <fieldset>
        <legend>标签与数值</legend>
        <label className="switch-row"><span>显示标签</span><input aria-label="显示标签" type="checkbox" checked={showLabels} onChange={(event) => onPatch({ showLabel: event.target.checked })} /></label>
        <Field label="当前标签"><input aria-label="当前标签" type="text" value={layer.label ?? ""} onChange={(event) => onPatch({ label: event.target.value })} /></Field>
        {LABEL_TYPES.has(layer.type) ? (
          <>
            {POSITIONED_LABEL_TYPES.has(layer.type) ? (
              <Field label="标签位置">
                <select aria-label="标签位置" value={layer.labelPosition ?? "end"} onChange={(event) => onPatch({ labelPosition: event.target.value })}>
                  <option value="start">起点</option><option value="end">终点</option>
                </select>
              </Field>
            ) : null}
            <div className="range-grid">
              <Field label="标签偏移 X"><input aria-label="标签偏移 X" type="number" value={labelOffset.x} onChange={(event) => onPatch({ labelOffset: { ...labelOffset, x: Number(event.target.value) } })} /></Field>
              <Field label="标签偏移 Y"><input aria-label="标签偏移 Y" type="number" value={labelOffset.y} onChange={(event) => onPatch({ labelOffset: { ...labelOffset, y: Number(event.target.value) } })} /></Field>
            </div>
          </>
        ) : null}
        <Field label="数值格式">
          <select aria-label="数值格式" value={layer.valueFormat ?? "0.00"} onChange={(event) => onPatch({ valueFormat: event.target.value })}>
            <option value="0">整数</option><option value="0.0">一位小数</option><option value="0.00">两位小数</option><option value="percent">百分比</option>
          </select>
        </Field>
        <div className="range-grid">
          <Field label="数值下限"><input aria-label="数值下限" type="number" value={layer.valueMin ?? 0} onChange={(event) => onPatch({ valueMin: Number(event.target.value) })} /></Field>
          <Field label="数值上限"><input aria-label="数值上限" type="number" value={layer.valueMax ?? 100} onChange={(event) => onPatch({ valueMax: Number(event.target.value) })} /></Field>
        </div>
        <div className="batch-row">
          <input aria-label="批量标签内容" type="text" value={batchLabelDraft} onChange={(event) => setBatchLabelDraft(event.target.value)} />
          <button type="button" onClick={() => onBatchLabel(batchLabelDraft)}>批量修改标签</button>
        </div>
      </fieldset>
      <div className="inspector-actions">
        <button type="button" onClick={() => onApplyStyle("type")}>应用样式到同类</button>
        <button type="button" onClick={() => onApplyStyle("all")}>将当前样式应用到全部</button>
        <button type="button" className="danger-button" onClick={onDelete}><Trash2 size={15} />删除当前对象</button>
      </div>
      </> : null}
      </div>
    </div>
  );
}
