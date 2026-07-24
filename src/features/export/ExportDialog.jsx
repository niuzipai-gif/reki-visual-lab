import React, { useEffect, useMemo, useRef, useState } from "react";
import { GlassPanel } from "../../components/GlassPanel.jsx";
import {
  createExportPlan,
  decodeOriginalSource,
  isSafeExport,
  renderProjectToBlob,
} from "./exportImage.js";
import { hasActivePixelFilters } from "../filters/filterPipeline.js";
import { MOTION_PRESET, createMotionPlan, renderMotion } from "../motion/motionRenderer.js";

const SCALE_OPTIONS = [1, 2, 4];

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadBlob(blob, project, format) {
  if (typeof globalThis.URL?.createObjectURL !== "function" || typeof globalThis.document?.createElement !== "function") return;
  const url = globalThis.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${project?.name || "reki-artwork"}.${format}`;
  anchor.click();
  setTimeout(() => globalThis.URL.revokeObjectURL(url), 0);
}

const OUTPUT_TYPES = [
  ["image", "图片"],
  ["video", "动画视频"],
  ["gif", "GIF"],
  ["bundle", "实况素材包"],
];

const MOTION_BUTTONS = {
  video: "导出视频",
  gif: "导出 GIF",
  bundle: "导出实况素材包",
};

export function ExportDialog({ project, onClose, onExported, onBusyChange, closeButtonRef, motionRenderer = renderMotion }) {
  const [format, setFormat] = useState("png");
  const [outputType, setOutputType] = useState("image");
  const [transparentOverlay, setTransparentOverlay] = useState(false);
  const [scale, setScale] = useState(1);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const abortControllerRef = useRef(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      abortControllerRef.current?.abort();
      onBusyChange?.(false);
    };
  }, [onBusyChange]);
  const plan = useMemo(
    () => createExportPlan(project?.canvas, scale, transparentOverlay),
    [project?.canvas, scale, transparentOverlay],
  );
  const motionPlan = useMemo(() => outputType === "image" ? null : createMotionPlan(project?.canvas, {
    durationMs: project?.motion?.durationMs,
    maxEdge: outputType === "gif" ? MOTION_PRESET.gifMaxEdge : MOTION_PRESET.maxEdge,
  }), [outputType, project?.canvas, project?.motion?.durationMs]);
  const activePlan = outputType === "image"
    ? plan
    : {
        width: motionPlan.width,
        height: motionPlan.height,
        includeBackground: true,
        estimatedBytes: motionPlan.width * motionPlan.height * 4,
      };
  const filterHeavy = activePlan.includeBackground && hasActivePixelFilters(project?.filters);
  const safe = isSafeExport(activePlan, undefined, filterHeavy);
  const scaleAvailability = useMemo(
    () => Object.fromEntries(
      SCALE_OPTIONS.map((value) => [
        value,
        isSafeExport(
          createExportPlan(project?.canvas, value, transparentOverlay),
          undefined,
          !transparentOverlay && hasActivePixelFilters(project?.filters),
        ),
      ]),
    ),
    [project?.canvas, project?.filters, transparentOverlay],
  );

  const handleExport = async () => {
    if (!safe || status === "exporting") return;
    const generation = ++generationRef.current;
    const isActive = () => mountedRef.current && generationRef.current === generation;
    setError(null);
    setStatus("exporting");
    onBusyChange?.(true);
    let decoded;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      if (outputType !== "image" || !transparentOverlay) decoded = await decodeOriginalSource(project?.image);
      if (!isActive()) return;
      const result = outputType === "image"
        ? {
            blob: await renderProjectToBlob({
              project,
              sourceBitmap: decoded ?? project?.image,
              scale,
              format,
              quality: format === "jpg" ? 0.92 : undefined,
              transparentOverlay,
            }),
            extension: format,
          }
        : await motionRenderer({
            project,
            sourceBitmap: decoded?.source ?? decoded ?? project?.image,
            kind: outputType,
            signal: controller.signal,
            onProgress: (complete, total) => {
              if (isActive()) setStatus({ type: "exporting", complete, total });
            },
          });
      if (!isActive()) return;
      downloadBlob(result.blob, project, result.extension);
      onExported?.(result.blob, { format: result.extension, scale, transparentOverlay, plan, outputType });
      if (isActive()) setStatus("success");
    } catch (caught) {
      if (isActive()) {
        setStatus("error");
        setError(
          caught?.code === "EXPORT_MEMORY"
            ? "导出尺寸过大，请降低倍率或缩小画布。"
            : caught?.name === "AbortError"
              ? null
              : caught?.message || "导出失败，请重试。",
        );
      }
    } finally {
      decoded?.dispose?.();
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      if (isActive()) onBusyChange?.(false);
    }
  };

  const close = () => {
    if (status === "exporting") return;
    generationRef.current += 1;
    onClose?.();
  };

  const cancelExport = () => {
    abortControllerRef.current?.abort();
    generationRef.current += 1;
    setStatus("idle");
    setError(null);
    onBusyChange?.(false);
  };

  const isExporting = status === "exporting" || typeof status === "object";
  const exportLabel = outputType === "image" ? "导出图片" : MOTION_BUTTONS[outputType];

  return (
    <div className="export-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!isExporting && event.target === event.currentTarget) close(); }}>
      <GlassPanel role="dialog" aria-modal="true" aria-label="导出设置" className="export-dialog">
        <header className="export-dialog-header">
          <div>
            <small>OUTPUT / LOCAL ONLY</small>
            <h2 id="reki-export-title">导出图片</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="icon-button" aria-label="关闭导出设置" disabled={isExporting} onClick={close}>×</button>
        </header>

        <fieldset>
          <legend>输出类型</legend>
          <div className="export-option-grid export-output-grid">
            {OUTPUT_TYPES.map(([value, label]) => <label key={value} className="export-option"><input type="radio" name="export-output" value={value} checked={outputType === value} disabled={isExporting} onChange={() => { setOutputType(value); if (value !== "image") setTransparentOverlay(false); }} /> {label}</label>)}
          </div>
        </fieldset>

        {outputType === "image" ? <>
        <fieldset>
          <legend>文件格式</legend>
          <div className="export-option-grid">
            <label className="export-option"><input type="radio" name="export-format" value="png" checked={format === "png"} disabled={isExporting} onChange={() => setFormat("png")} /> PNG <small>无损透明</small></label>
            <label className="export-option"><input type="radio" name="export-format" value="jpg" checked={format === "jpg"} disabled={transparentOverlay || isExporting} onChange={() => setFormat("jpg")} /> JPG <small>更小文件</small></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>导出内容</legend>
          <label className="export-select-row"><span>图层</span><select aria-label="导出内容" disabled={isExporting} value={transparentOverlay ? "overlay" : "complete"} onChange={(event) => { const nextOverlay = event.target.value === "overlay"; setTransparentOverlay(nextOverlay); if (nextOverlay) setFormat("png"); }}><option value="complete">完整图片（底图 + 标注）</option><option value="overlay">透明效果层（仅标注）</option></select></label>
        </fieldset>

        <fieldset>
          <legend>输出倍率</legend>
          <div className="export-scale-grid">
            {SCALE_OPTIONS.map((value) => (
              <label key={value} className="export-scale-option">
                <input type="radio" name="export-scale" value={value} checked={scale === value} disabled={!scaleAvailability[value] || isExporting} onChange={() => setScale(value)} />
                <span>{value}×</span>
              </label>
            ))}
          </div>
        </fieldset></> : <section className="motion-export-info" aria-live="polite">
          <strong>{Math.round((project?.motion?.durationMs ?? MOTION_PRESET.durationMs) / 1000)} 秒 · {MOTION_PRESET.fps} FPS · 长边最多 {MOTION_PRESET.maxEdge}px</strong>
          <small>{outputType === "gif" ? "GIF 为了稳定导出，长边最多 640px。" : outputType === "bundle" ? "封面图 + 短视频，可导入美图秀秀转换" : "优先导出 MP4；浏览器不支持时会明确回退为 WebM。"}</small>
          <small>所有帧仅在本机浏览器渲染，不会上传原图。</small>
        </section>}

        <div className="export-dimensions" aria-live="polite">
          <span>输出尺寸</span><strong>{activePlan.width} × {activePlan.height}px</strong><small>预计占用 {formatBytes(activePlan.estimatedBytes)}</small>
        </div>
        {!safe ? <p className="export-warning" role="alert">当前设备内存不足，建议选择较低倍率或缩短时长。</p> : outputType === "image" && scaleAvailability[4] === false ? <p className="export-warning" role="status">4× 超出建议内存上限，已自动保护。</p> : null}
        {isExporting ? <p className="export-feedback" role="status">正在生成{outputType === "image" ? "高清图片" : "动态作品"}…{typeof status === "object" ? ` ${status.complete}/${status.total}` : ""}</p> : null}
        {status === "success" ? <p className="export-feedback success" role="status">导出完成，文件已保存。</p> : null}
        {error ? <p className="export-feedback error" role="alert">{error}</p> : null}

        <footer className="export-dialog-actions">
          {isExporting ? <button type="button" className="secondary-button" onClick={cancelExport}>取消导出</button> : <button type="button" className="secondary-button" onClick={close}>取消</button>}
          <button type="button" className="primary-button" disabled={(outputType === "image" && !safe) || isExporting} onClick={handleExport}>{isExporting ? "生成中…" : exportLabel}</button>
        </footer>
      </GlassPanel>
    </div>
  );
}

export default ExportDialog;
