import React, { useEffect, useMemo, useRef, useState } from "react";
import { GlassPanel } from "../../components/GlassPanel.jsx";
import {
  createExportPlan,
  decodeOriginalSource,
  isSafeExport,
  renderProjectToBlob,
} from "./exportImage.js";
import { hasActivePixelFilters } from "../filters/filterPipeline.js";

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
  anchor.download = `${project?.name || "reki-artwork"}.${format === "jpg" ? "jpg" : "png"}`;
  anchor.click();
  setTimeout(() => globalThis.URL.revokeObjectURL(url), 0);
}

export function ExportDialog({ project, onClose, onExported, onBusyChange, closeButtonRef }) {
  const [format, setFormat] = useState("png");
  const [transparentOverlay, setTransparentOverlay] = useState(false);
  const [scale, setScale] = useState(1);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      onBusyChange?.(false);
    };
  }, [onBusyChange]);
  const plan = useMemo(
    () => createExportPlan(project?.canvas, scale, transparentOverlay),
    [project?.canvas, scale, transparentOverlay],
  );
  const filterHeavy = plan.includeBackground && hasActivePixelFilters(project?.filters);
  const safe = isSafeExport(plan, undefined, filterHeavy);
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
    try {
      if (!transparentOverlay) decoded = await decodeOriginalSource(project?.image);
      if (!isActive()) return;
      const blob = await renderProjectToBlob({
        project,
        sourceBitmap: decoded ?? project?.image,
        scale,
        format,
        quality: format === "jpg" ? 0.92 : undefined,
        transparentOverlay,
      });
      if (!isActive()) return;
      downloadBlob(blob, project, format);
      onExported?.(blob, { format, scale, transparentOverlay, plan });
      if (isActive()) setStatus("success");
    } catch (caught) {
      if (isActive()) {
        setStatus("error");
        setError(
          caught?.code === "EXPORT_MEMORY"
            ? "导出尺寸过大，请降低倍率或缩小画布。"
            : caught?.message || "导出失败，请重试。",
        );
      }
    } finally {
      decoded?.dispose?.();
      if (isActive()) onBusyChange?.(false);
    }
  };

  const close = () => {
    if (status === "exporting") return;
    generationRef.current += 1;
    onClose?.();
  };

  return (
    <div className="export-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (status !== "exporting" && event.target === event.currentTarget) close(); }}>
      <GlassPanel role="dialog" aria-modal="true" aria-label="导出设置" className="export-dialog">
        <header className="export-dialog-header">
          <div>
            <small>OUTPUT / LOCAL ONLY</small>
            <h2 id="reki-export-title">导出图片</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="icon-button" aria-label="关闭导出设置" disabled={status === "exporting"} onClick={close}>×</button>
        </header>

        <fieldset>
          <legend>文件格式</legend>
          <div className="export-option-grid">
            <label className="export-option"><input type="radio" name="export-format" value="png" checked={format === "png"} disabled={status === "exporting"} onChange={() => setFormat("png")} /> PNG <small>无损透明</small></label>
            <label className="export-option"><input type="radio" name="export-format" value="jpg" checked={format === "jpg"} disabled={transparentOverlay || status === "exporting"} onChange={() => setFormat("jpg")} /> JPG <small>更小文件</small></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>导出内容</legend>
          <label className="export-select-row"><span>图层</span><select aria-label="导出内容" disabled={status === "exporting"} value={transparentOverlay ? "overlay" : "complete"} onChange={(event) => { const nextOverlay = event.target.value === "overlay"; setTransparentOverlay(nextOverlay); if (nextOverlay) setFormat("png"); }}><option value="complete">完整图片（底图 + 标注）</option><option value="overlay">透明效果层（仅标注）</option></select></label>
        </fieldset>

        <fieldset>
          <legend>输出倍率</legend>
          <div className="export-scale-grid">
            {SCALE_OPTIONS.map((value) => (
              <label key={value} className="export-scale-option">
                <input type="radio" name="export-scale" value={value} checked={scale === value} disabled={!scaleAvailability[value] || status === "exporting"} onChange={() => setScale(value)} />
                <span>{value}×</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="export-dimensions" aria-live="polite">
          <span>输出尺寸</span><strong>{plan.width} × {plan.height}px</strong><small>预计占用 {formatBytes(plan.estimatedBytes)}</small>
        </div>
        {!safe ? <p className="export-warning" role="alert">当前设备内存不足，建议选择较低倍率。</p> : scaleAvailability[4] === false ? <p className="export-warning" role="status">4× 超出建议内存上限，已自动保护。</p> : null}
        {status === "exporting" ? <p className="export-feedback" role="status">正在生成高清图片…</p> : null}
        {status === "success" ? <p className="export-feedback success" role="status">导出完成，文件已保存。</p> : null}
        {error ? <p className="export-feedback error" role="alert">{error}</p> : null}

        <footer className="export-dialog-actions">
          <button type="button" className="secondary-button" disabled={status === "exporting"} onClick={close}>取消</button>
          <button type="button" className="primary-button" disabled={!safe || status === "exporting"} onClick={handleExport}>{status === "exporting" ? "生成中…" : "导出图片"}</button>
        </footer>
      </GlassPanel>
    </div>
  );
}

export default ExportDialog;
