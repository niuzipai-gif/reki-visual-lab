import { createAnnotation, DEFAULT_STYLE } from "../../domain/project.js";
import { DEFAULT_ANIMATION } from "../motion/animationRuntime.js";

export const MARKER_TYPES = Object.freeze([
  "box",
  "stackBox",
  "path",
  "leader",
  "nodeCloud",
  "randomNodes",
  "orbit",
  "label",
]);

export const SOURCE_FILL_TYPES = Object.freeze([
  "transparent",
  "black",
  "white",
  "preserve",
]);

const MARKER_TYPE_SET = new Set(MARKER_TYPES);
const SOURCE_FILL_SET = new Set(SOURCE_FILL_TYPES);
const MIN_SOURCE_SIZE = 0.01;
const STACK_OFFSET = 12;

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function canvasDimension(canvas, key) {
  return Math.max(1, finite(canvas?.[key], 1));
}

function normalizedPoint(point) {
  const x = finite(point?.x);
  const y = finite(point?.y);
  if (x === null || y === null) return null;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
  };
}

function markerPoints(marker) {
  if (!Array.isArray(marker?.points)) return [];
  const points = marker.points.map(normalizedPoint);
  return points.some((point) => point === null) ? [] : points;
}

function boundsForPoints(points) {
  if (!points.length) return null;
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function clampRect(rect) {
  const source = rect && typeof rect === "object" ? rect : null;
  const x = finite(source?.x);
  const y = finite(source?.y);
  const width = finite(source?.width);
  const height = finite(source?.height);
  if (
    x === null ||
    y === null ||
    width === null ||
    height === null ||
    width < 0 ||
    height < 0
  ) {
    return null;
  }

  const safeWidth = Math.min(1, Math.max(MIN_SOURCE_SIZE, width));
  const safeHeight = Math.min(1, Math.max(MIN_SOURCE_SIZE, height));
  const centeredX = x - Math.max(0, safeWidth - width) / 2;
  const centeredY = y - Math.max(0, safeHeight - height) / 2;
  const round = (value) => Math.round(value * 1_000_000) / 1_000_000;
  return {
    x: round(Math.max(0, Math.min(1 - safeWidth, centeredX))),
    y: round(Math.max(0, Math.min(1 - safeHeight, centeredY))),
    width: round(safeWidth),
    height: round(safeHeight),
  };
}

function styleFor(marker) {
  const supplied = marker?.style;
  return {
    ...DEFAULT_STYLE,
    ...(supplied && typeof supplied === "object" && !Array.isArray(supplied)
      ? supplied
      : {}),
  };
}

function labelBounds(marker, points, canvas) {
  const point = points[0];
  if (!point) return null;
  const style = styleFor(marker);
  const offset = marker?.labelOffset;
  const width = canvasDimension(canvas, "width");
  const height = canvasDimension(canvas, "height");
  const fontSize = Math.max(1, finite(style.fontSize, DEFAULT_STYLE.fontSize));
  const label = String(marker?.label ?? "");
  return {
    x: point.x + finite(offset?.x, 0) / width,
    y: point.y + finite(offset?.y, 0) / height,
    width: Math.max(fontSize / width, label.length * fontSize * 0.6 / width),
    height: fontSize / height,
  };
}

function orbitBounds(marker, points, canvas) {
  const center = points[0];
  if (!center) return null;
  const style = styleFor(marker);
  const fallbackEdge = {
    x: center.x + Math.max(1, finite(style.anchorSize, DEFAULT_STYLE.anchorSize)) * 6 /
      canvasDimension(canvas, "width"),
    y: center.y,
  };
  const edge = points[1] ?? fallbackEdge;
  const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
  return {
    x: center.x - radius,
    y: center.y - radius,
    width: radius * 2,
    height: radius * 2,
  };
}

/** True when a layer can point to a visible original-image rectangle. */
export function isSpatialMarker(marker) {
  return MARKER_TYPE_SET.has(marker?.type);
}

export function isSourceFill(value) {
  return SOURCE_FILL_SET.has(value);
}

/**
 * Return the normalized original-image rectangle visibly occupied by a marker.
 * Degenerate point markers are expanded to a small safe crop area.
 */
export function markerSourceRect(marker, canvas) {
  if (!isSpatialMarker(marker)) return null;
  const points = markerPoints(marker);
  if (!points.length) return null;

  let bounds;
  if (marker.type === "label") {
    bounds = labelBounds(marker, points, canvas);
  } else if (marker.type === "orbit") {
    bounds = orbitBounds(marker, points, canvas);
  } else {
    bounds = boundsForPoints(points);
    if (marker.type === "stackBox" && bounds) {
      bounds = {
        x: bounds.x,
        y: bounds.y - STACK_OFFSET / canvasDimension(canvas, "height"),
        width: bounds.width + STACK_OFFSET / canvasDimension(canvas, "width"),
        height: bounds.height + STACK_OFFSET / canvasDimension(canvas, "height"),
      };
    }
  }
  return clampRect(bounds);
}

export function normalizeSourceRect(rect) {
  if (!rect || typeof rect !== "object" || Array.isArray(rect)) return null;
  const source = {
    x: finite(rect.x),
    y: finite(rect.y),
    width: finite(rect.width),
    height: finite(rect.height),
  };
  if (
    source.x === null ||
    source.y === null ||
    source.width === null ||
    source.height === null ||
    source.x < 0 ||
    source.y < 0 ||
    source.width < MIN_SOURCE_SIZE ||
    source.height < MIN_SOURCE_SIZE ||
    source.x + source.width > 1 ||
    source.y + source.height > 1
  ) {
    return null;
  }
  return clampRect(source);
}

/** Create a non-destructive local layer which references a source marker. */
export function createExtractedFragment({ marker, canvas, sourceFill = "preserve" } = {}) {
  if (!isSpatialMarker(marker) || !isSourceFill(sourceFill)) return null;
  const sourceRect = markerSourceRect(marker, canvas);
  if (!sourceRect) return null;
  return createAnnotation("extractedFragment", [], {
    name: `fragment_${String(Date.now()).slice(-4)}`,
    sourceMarkerId: marker.id,
    sourceRect: { ...sourceRect },
    linkedToMarker: true,
    sourceFill,
    transform: { ...sourceRect },
    effects: [],
    animation: { ...DEFAULT_ANIMATION },
  });
}
