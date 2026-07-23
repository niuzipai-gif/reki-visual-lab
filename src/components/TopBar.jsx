import React from "react";
import {
  Download,
  Eye,
  EyeOff,
  Redo2,
  Undo2,
} from "lucide-react";

export function TopBar({
  canUndo,
  canRedo,
  backgroundVisible,
  canCompare = true,
  canvas,
  onUndo,
  onRedo,
  onToggleBackground,
  onExport,
}) {
  const divisor = canvas.width && canvas.height
    ? (a, b) => (b ? divisor(b, a % b) : a)
    : () => 1;
  const common = divisor(canvas.width, canvas.height);
  const ratio = `${canvas.width / common}:${canvas.height / common}`;

  return (
    <header className="top-bar">
      <div className="brand-lockup" aria-label="REKI 视觉标注实验室">
        <span className="brand-icon"><img src="/reki-mark.svg" alt="" /></span>
        <span><b>REKI</b><small>VISUAL ANNOTATION LAB</small></span>
      </div>
      <div className="top-history" aria-label="历史与对比">
        <button type="button" className="icon-button" onClick={onUndo} disabled={!canUndo} aria-label="撤销">
          <Undo2 size={17} />
        </button>
        <button type="button" className="icon-button" onClick={onRedo} disabled={!canRedo} aria-label="重做">
          <Redo2 size={17} />
        </button>
        <button type="button" className="comparison-button" onClick={onToggleBackground} disabled={!canCompare} aria-pressed={!backgroundVisible}>
          {backgroundVisible ? <Eye size={16} /> : <EyeOff size={16} />}
          <span>{backgroundVisible ? "原图对比" : "显示原图"}</span>
        </button>
      </div>
      <div className="canvas-meta" aria-label="画布尺寸">
        <b>{ratio}</b><span>{canvas.width} × {canvas.height}</span>
      </div>
      <button type="button" className="primary-button export-button" onClick={onExport}>
        <Download size={16} />导出图片
      </button>
    </header>
  );
}
