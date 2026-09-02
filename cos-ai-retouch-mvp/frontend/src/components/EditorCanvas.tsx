import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { EditorDocument, EditorMaskStroke } from "../domain/editor";
import { applyAdjustments, rasterizeMask, toCanvasBlendMode } from "../editor/operations";
import type { EditorTool } from "./EditorControls";

interface EditorCanvasProps {
  sourceUrl: string;
  document: EditorDocument;
  selectedLayerId: string;
  tool: EditorTool;
  brushWidth: number;
  onMaskStroke: (stroke: EditorMaskStroke) => void;
}

type Point = EditorMaskStroke["points"][number];

function drawStroke(context: CanvasRenderingContext2D, stroke: EditorMaskStroke, width: number, height: number, preview = false) {
  if (!stroke.points.length) return;
  context.save();
  context.strokeStyle = stroke.mode === "erase" ? "rgba(255, 253, 250, .8)" : "rgba(181, 107, 142, .64)";
  context.fillStyle = context.strokeStyle;
  context.lineWidth = Math.max(2, (stroke.width / 1000) * Math.max(width, height));
  context.lineCap = "round";
  context.lineJoin = "round";
  context.globalAlpha = preview ? 0.7 : 1;
  context.beginPath();
  const first = stroke.points[0];
  context.moveTo(first.x * width, first.y * height);
  for (const point of stroke.points.slice(1)) context.lineTo(point.x * width, point.y * height);
  context.stroke();
  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(first.x * width, first.y * height, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>): Point | null {
  const rect = event.currentTarget.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

function getContext(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!canvas) return null;
  try {
    return canvas.getContext("2d");
  } catch {
    return null;
  }
}

export default function EditorCanvas({ sourceUrl, document, selectedLayerId, tool, brushWidth, onMaskStroke }: EditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const activeStrokeRef = useRef<EditorMaskStroke | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const [imageRevision, setImageRevision] = useState(0);
  const [draftStroke, setDraftStroke] = useState<EditorMaskStroke | null>(null);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setImageRevision((revision) => revision + 1);
    };
    image.onerror = () => {
      imageRef.current = null;
      setImageRevision((revision) => revision + 1);
    };
    image.src = sourceUrl;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [sourceUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    const context = getContext(canvas);
    if (!canvas || !context || !image || !image.naturalWidth || !image.naturalHeight) return;
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const layer of document.layers) {
      if (!layer.visible || layer.kind === "image" || layer.kind === "group") continue;
      const layerCanvas = window.document.createElement("canvas");
      layerCanvas.width = width;
      layerCanvas.height = height;
      const layerContext = getContext(layerCanvas);
      if (!layerContext) continue;
      layerContext.drawImage(image, 0, 0, width, height);
      const sourcePixels = layerContext.getImageData(0, 0, width, height);
      const adjusted = applyAdjustments(sourcePixels, layer.adjustments);
      if (layer.scope === "local" && layer.maskStrokes.length > 0) {
        const mask = rasterizeMask(layer.maskStrokes, width, height);
        for (let index = 0; index < adjusted.data.length; index += 4) adjusted.data[index + 3] = mask[index / 4];
      }
      layerContext.putImageData(adjusted, 0, 0);
      context.save();
      context.globalAlpha = Math.min(1, Math.max(0, layer.opacity));
      context.globalCompositeOperation = toCanvasBlendMode(layer.blendMode);
      context.drawImage(layerCanvas, 0, 0);
      context.restore();
    }

    const selectedLayer = document.layers.find((layer) => layer.id === selectedLayerId);
    if (selectedLayer && selectedLayer.maskStrokes.length > 0) {
      for (const stroke of selectedLayer.maskStrokes) drawStroke(context, stroke, width, height);
    }
    if (draftStroke) drawStroke(context, draftStroke, width, height, true);
  }, [document, imageRevision, selectedLayerId, draftStroke]);

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (tool === "select" || activeStrokeRef.current) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const stroke: EditorMaskStroke = { mode: tool === "mask-erase" ? "erase" : "add", width: brushWidth, points: [point] };
    activeStrokeRef.current = stroke;
    activePointerRef.current = event.pointerId;
    setDraftStroke(stroke);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const stroke = activeStrokeRef.current;
    if (!stroke || activePointerRef.current !== event.pointerId) return;
    const point = pointFromEvent(event);
    if (!point) return;
    const next = { ...stroke, points: [...stroke.points, point] };
    activeStrokeRef.current = next;
    setDraftStroke(next);
  }

  function finishStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    const stroke = activeStrokeRef.current;
    if (!stroke || activePointerRef.current !== event.pointerId) return;
    activeStrokeRef.current = null;
    activePointerRef.current = null;
    setDraftStroke(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onMaskStroke(stroke);
  }

  function cancelStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    activeStrokeRef.current = null;
    activePointerRef.current = null;
    setDraftStroke(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  return (
    <section className="editor-canvas-panel" aria-labelledby="editor-canvas-title">
      <div className="editor-canvas-heading">
        <div>
          <p className="eyebrow">LIVE PREVIEW</p>
          <h2 id="editor-canvas-title">照片画布</h2>
        </div>
        <div className="editor-canvas-meta"><span>原图保护中</span><span>100%</span></div>
      </div>
      <div className="editor-canvas-frame">
        <canvas
          ref={canvasRef}
          aria-label="COS 照片编辑画布"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={cancelStroke}
          style={{ display: "block", width: "100%", height: "auto", touchAction: tool === "select" ? "none" : "none", cursor: tool === "select" ? "grab" : "crosshair" }}
        />
        {!imageRef.current && <div className="editor-canvas-empty">正在准备照片画布…</div>}
        <div className="editor-canvas-corner" aria-hidden="true">AURA / COS RETOUCH</div>
      </div>
      <p className="editor-canvas-note">选中局部图层后使用画笔；所有笔触会保存到该图层蒙版，不会破坏原图。</p>
    </section>
  );
}
