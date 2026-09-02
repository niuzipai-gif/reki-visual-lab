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
const SAFE_MARGIN_PX = 2;

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

function unionBounds(bounds) {
  const valid = bounds.filter(Boolean);
  if (!valid.length) return null;
  const left = Math.min(...valid.map(({ x }) => x));
  const top = Math.min(...valid.map(({ y }) => y));
  const right = Math.max(...valid.map(({ x, width }) => x + width));
  const bottom = Math.max(...valid.map(({ y, height }) => y + height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function expandBounds(bounds, xPadding = 0, yPadding = xPadding) {
  if (!bounds) return null;
  return {
    x: bounds.x - xPadding,
    y: bounds.y - yPadding,
    width: bounds.width + xPadding * 2,
    height: bounds.height + yPadding * 2,
  };
}

function pointBounds(point, radiusX = 0, radiusY = radiusX) {
  if (!point) return null;
  return {
    x: point.x - radiusX,
    y: point.y - radiusY,
    width: radiusX * 2,
    height: radiusY * 2,
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

function textBounds(point, label, offset, style, canvas) {
  if (!point) return null;
  const width = canvasDimension(canvas, "width");
  const height = canvasDimension(canvas, "height");
  const fontSize = Math.max(1, finite(style.fontSize, DEFAULT_STYLE.fontSize));
  return {
    x: point.x + finite(offset?.x, 0) / width,
    y: point.y + finite(offset?.y, 0) / height,
    width: Math.max(fontSize / width, String(label ?? "").length * fontSize * 0.6 / width),
    height: fontSize / height,
  };
}

function markerTextBounds(marker, points, style, canvas) {
  if (marker?.showLabel === false || !points.length) return null;
  const offset = marker?.labelOffset ?? { x: 0, y: 0 };
  if (marker.type === "label") {
    return textBounds(points[0], marker.label, offset, style, canvas);
  }
  const point = marker?.labelPosition === "start" ? points[0] : points.at(-1);
  const fontSize = Math.max(1, finite(style.fontSize, DEFAULT_STYLE.fontSize));
  return textBounds(
    point,
    marker?.label,
    {
      x: finite(offset?.x, 0) + 8,
      y: finite(offset?.y, 0) - fontSize / 2,
    },
    style,
    canvas,
  );
}

function orbitBounds(marker, points, canvas) {
  const center = points[0];
  if (!center) return null;
  const style = styleFor(marker);
  const width = canvasDimension(canvas, "width");
  const height = canvasDimension(canvas, "height");
  const fallbackEdge = {
    x: center.x + Math.max(1, finite(style.anchorSize, DEFAULT_STYLE.anchorSize)) * 6 /
      width,
    y: center.y,
  };
  const edge = points[1] ?? fallbackEdge;
  const radius = Math.hypot(
    (edge.x - center.x) * width,
    (edge.y - center.y) * height,
  );
  return {
    x: center.x - radius / width,
    y: center.y - radius / height,
    width: radius * 2 / width,
    height: radius * 2 / height,
  };
}

function shapeBounds(marker, points, style, canvas) {
  const pointBox = boundsForPoints(points);
  const width = canvasDimension(canvas, "width");
  const height = canvasDimension(canvas, "height");
  const strokeX = Math.max(0, finite(style.lineWidth, DEFAULT_STYLE.lineWidth)) / 2 / width;
  const strokeY = Math.max(0, finite(style.lineWidth, DEFAULT_STYLE.lineWidth)) / 2 / height;
  const anchorX = Math.max(0, finite(style.anchorSize, DEFAULT_STYLE.anchorSize)) / width;
  const anchorY = Math.max(0, finite(style.anchorSize, DEFAULT_STYLE.anchorSize)) / height;
  const bounds = [];

  switch (marker.type) {
    case "stackBox":
      if (pointBox) {
        bounds.push(expandBounds({
          x: pointBox.x,
          y: pointBox.y - STACK_OFFSET / height,
          width: pointBox.width + STACK_OFFSET / width,
          height: pointBox.height + STACK_OFFSET / height,
        }, strokeX, strokeY));
      }
      break;
    case "orbit": {
      const orbit = orbitBounds(marker, points, canvas);
      if (orbit) bounds.push(expandBounds(orbit, strokeX, strokeY));
      bounds.push(...points.slice(0, 2).map((point) => pointBounds(point, anchorX, anchorY)));
      break;
    }
    case "leader":
      if (pointBox) bounds.push(expandBounds(pointBox, strokeX, strokeY));
      bounds.push(pointBounds(points[0], anchorX, anchorY));
      break;
    case "nodeCloud":
      if (pointBox) bounds.push(expandBounds(pointBox, strokeX, strokeY));
      bounds.push(...points.map((point) => pointBounds(point, anchorX, anchorY)));
      break;
    case "randomNodes":
      bounds.push(...points.map((point) => pointBounds(point, anchorX, anchorY)));
      break;
    case "box":
    case "path":
      if (pointBox) bounds.push(expandBounds(pointBox, strokeX, strokeY));
      break;
    case "label":
      break;
    default:
      break;
  }
  return unionBounds(bounds) ?? pointBox;
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

  const style = styleFor(marker);
  const text = markerTextBounds(marker, points, style, canvas);
  const bounds = unionBounds([
    shapeBounds(marker, points, style, canvas),
    text,
  ]) ?? boundsForPoints(points);
  return clampRect(expandBounds(
    bounds,
    SAFE_MARGIN_PX / canvasDimension(canvas, "width"),
    SAFE_MARGIN_PX / canvasDimension(canvas, "height"),
  ));
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
    opacity: 1,
    transform: { ...sourceRect },
    effects: [],
    animation: { ...DEFAULT_ANIMATION },
  });
}
