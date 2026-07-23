import React from "react";
import { Grid3X3, HardDrive, ZoomIn } from "lucide-react";

export function StatusBar({ zoom, grid, canvas, onZoomChange, onToggleGrid }) {
  return (
    <footer className="status-bar" role="status">
      <label className="status-control">
        <ZoomIn size={14} />
        <span className="sr-only">画布缩放</span>
        <input aria-label="画布缩放" type="range" min="25" max="200" value={zoom} onChange={(event) => onZoomChange(Number(event.target.value))} />
        <b>{zoom}%</b>
      </label>
      <button type="button" className="status-control" onClick={onToggleGrid} aria-pressed={grid}>
        <Grid3X3 size={14} />网格{grid ? "开启" : "关闭"}
      </button>
      <span>{canvas.width} × {canvas.height}</span>
      <strong><HardDrive size={14} />照片仅在本机处理</strong>
    </footer>
  );
}
