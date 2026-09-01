import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { MaskStroke, Region } from "../domain/task";

export type { MaskStroke } from "../domain/task";

export interface MaskCanvasProps {
  originalImageUrl: string | null;
  regions: Region[];
  strokes: MaskStroke[];
  onChange: (strokes: MaskStroke[]) => void;
  disabled?: boolean;
}

type Point = MaskStroke["points"][number];
type CanvasSize = { width: number; height: number };

const DEFAULT_ASPECT_RATIO = 4 / 3;
const DEFAULT_BRUSH_WIDTH = 24;

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function canvasContext(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!canvas) return null;
  try {
    return canvas.getContext("2d");
  } catch {
    return null;
  }
}

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: MaskStroke,
  size: CanvasSize,
): void {
  if (stroke.points.length === 0) return;

  context.save();
  context.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
  context.strokeStyle = stroke.mode === "erase" ? "rgba(255, 255, 255, 0.9)" : "rgba(215, 107, 69, 0.75)";
  context.fillStyle = context.strokeStyle;
  context.lineWidth = Math.max(1, stroke.width);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();

  const first = stroke.points[0];
  const firstX = first.x * size.width;
  const firstY = first.y * size.height;
  context.moveTo(firstX, firstY);
  for (const point of stroke.points.slice(1)) {
    context.lineTo(point.x * size.width, point.y * size.height);
  }
  context.stroke();

  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(firstX, firstY, Math.max(0.5, stroke.width / 2), 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

export default function MaskCanvas({
  originalImageUrl,
  regions,
  strokes,
  onChange,
  disabled = false,
}: MaskCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const regionCanvasRef = useRef<HTMLCanvasElement>(null);
  const userCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const activeStrokeRef = useRef<MaskStroke | null>(null);
  const [imageAspectRatio, setImageAspectRatio] = useState(DEFAULT_ASPECT_RATIO);
  const [imageRevision, setImageRevision] = useState(0);
  const [size, setSize] = useState<CanvasSize>({ width: 1, height: 1 });
  const [mode, setMode] = useState<MaskStroke["mode"]>("add");
  const [brushWidth, setBrushWidth] = useState(DEFAULT_BRUSH_WIDTH);
  const [draftStroke, setDraftStroke] = useState<MaskStroke | null>(null);

  useEffect(() => {
    if (!originalImageUrl) {
      imageRef.current = null;
      setImageRevision((revision) => revision + 1);
      return;
    }

    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setImageAspectRatio(image.naturalWidth / image.naturalHeight);
      }
      setImageRevision((revision) => revision + 1);
    };
    image.onerror = () => {
      imageRef.current = null;
      setImageRevision((revision) => revision + 1);
    };
    image.src = originalImageUrl;

    if (image.complete && image.naturalWidth > 0) {
      image.onload(new Event("load"));
    }

    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [originalImageUrl]);

  const measure = useCallback((entry?: ResizeObserverEntry) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = entry?.contentRect || container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || container.clientWidth || 640));
    const height = Math.max(
      1,
      Math.round(rect.height || container.clientHeight || width / imageAspectRatio),
    );
    setSize((current) => current.width === width && current.height === height ? current : { width, height });
  }, [imageAspectRatio]);

  useEffect(() => {
    measure();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => measure(entries[0]));
    observer?.observe(containerRef.current as Element);
    const handleWindowResize = () => measure();
    window.addEventListener("resize", handleWindowResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [measure]);

  useEffect(() => {
    for (const canvas of [imageCanvasRef.current, regionCanvasRef.current, userCanvasRef.current]) {
      if (!canvas) continue;
      canvas.width = size.width;
      canvas.height = size.height;
    }

    const imageContext = canvasContext(imageCanvasRef.current);
    imageContext?.clearRect(0, 0, size.width, size.height);
    if (imageContext && imageRef.current) {
      imageContext.drawImage(imageRef.current, 0, 0, size.width, size.height);
    }

    const regionContext = canvasContext(regionCanvasRef.current);
    regionContext?.clearRect(0, 0, size.width, size.height);
    if (regionContext) {
      regionContext.save();
      regionContext.fillStyle = "rgba(215, 107, 69, 0.2)";
      regionContext.strokeStyle = "rgba(168, 79, 50, 0.85)";
      regionContext.lineWidth = 2;
      for (const region of regions) {
        const x = region.x * size.width;
        const y = region.y * size.height;
        const width = region.width * size.width;
        const height = region.height * size.height;
        regionContext.fillRect(x, y, width, height);
        regionContext.strokeRect(x, y, width, height);
      }
      regionContext.restore();
    }

    const userContext = canvasContext(userCanvasRef.current);
    userContext?.clearRect(0, 0, size.width, size.height);
    if (userContext) {
      for (const stroke of [...strokes, ...(draftStroke ? [draftStroke] : [])]) {
        drawStroke(userContext, stroke, size);
      }
    }
  }, [draftStroke, imageRevision, regions, size, strokes]);

  function pointFromPointer(event: ReactPointerEvent<HTMLCanvasElement>): Point | null {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = rect.width || size.width;
    const height = rect.height || size.height;
    const nativeEvent = event.nativeEvent as MouseEvent;
    const clientX = Number.isFinite(event.clientX) ? event.clientX : nativeEvent.clientX;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : nativeEvent.clientY;
    if (!width || !height) return null;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    return {
      x: clamp((clientX - rect.left) / width),
      y: clamp((clientY - rect.top) / height),
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled || activeStrokeRef.current) return;
    const point = pointFromPointer(event);
    if (!point) return;
    const stroke: MaskStroke = { mode, width: brushWidth, points: [point] };
    activePointerRef.current = event.pointerId;
    activeStrokeRef.current = stroke;
    setDraftStroke(stroke);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const stroke = activeStrokeRef.current;
    if (!stroke || activePointerRef.current !== event.pointerId) return;
    const point = pointFromPointer(event);
    if (!point) return;
    const nextStroke: MaskStroke = { ...stroke, points: [...stroke.points, point] };
    activeStrokeRef.current = nextStroke;
    setDraftStroke(nextStroke);
  }

  function finishPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    const stroke = activeStrokeRef.current;
    if (!stroke || activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    activeStrokeRef.current = null;
    setDraftStroke(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onChange([...strokes, stroke]);
  }

  function cancelPointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    activeStrokeRef.current = null;
    setDraftStroke(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function undoLastStroke() {
    if (!strokes.length || disabled) return;
    onChange(strokes.slice(0, -1));
  }

  return (
    <div
      ref={containerRef}
      className="mask-canvas"
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: `${imageAspectRatio}`,
        overflow: "hidden",
        background: "#e9e4d9",
      }}
    >
      <img
        src={originalImageUrl || undefined}
        alt="原图分析预览"
        className="mask-canvas-accessible-image"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", opacity: 0, pointerEvents: "none" }}
      />
      <canvas
        ref={imageCanvasRef}
        data-testid="mask-canvas-image"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />
      <canvas
        ref={regionCanvasRef}
        data-testid="mask-canvas-regions"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      />
      <canvas
        ref={userCanvasRef}
        data-testid="mask-canvas-user"
        aria-label="局部蒙版画布"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={cancelPointer}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", cursor: disabled ? "not-allowed" : "crosshair" }}
      />
      <div className="mask-canvas-controls" style={{ position: "absolute", left: 12, right: 12, bottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="secondary-button" aria-pressed={mode === "add"} disabled={disabled} onClick={() => setMode("add")}>
          画出要处理的地方
        </button>
        <button type="button" className="secondary-button" aria-pressed={mode === "erase"} disabled={disabled} onClick={() => setMode("erase")}>
          擦掉多余区域
        </button>
        <button type="button" className="secondary-button" disabled={disabled || strokes.length === 0} onClick={undoLastStroke}>
          撤回上一笔
        </button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 10, background: "rgba(255, 253, 248, .92)", fontSize: ".78rem" }}>
          画笔大小
          <input
            type="range"
            min="4"
            max="80"
            step="1"
            value={brushWidth}
            aria-label="画笔大小"
            disabled={disabled}
            onChange={(event) => setBrushWidth(Number(event.target.value))}
          />
        </label>
      </div>
    </div>
  );
}
