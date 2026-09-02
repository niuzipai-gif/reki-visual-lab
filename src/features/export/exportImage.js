import { denormalizePoint, makeCurvePoints } from "../../domain/geometry.js";
import { DEFAULT_STYLE } from "../../domain/project.js";
import { MAX_DECODED_PIXELS } from "../import/decodeImage.js";
import {
  legacyFiltersToEffectStack,
} from "../filters/effectStack.js";
import {
  resolveAnimation,
  resolveDrawClip,
  sanitizeAnimation,
} from "../motion/animationRuntime.js";
import { composeProjectFrameToContext } from "../fragments/fragmentComposite.js";
import { publicAsset } from "../../publicAsset.js";

const MAX_SCALE = 4;
const DEFAULT_DEVICE_MEMORY = 4;
const BYTES_PER_PIXEL = 4;

function exportError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function normalizedScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(MAX_SCALE, numeric));
}

export function createExportPlan(size, scale = 1, transparentOverlay = false) {
  if (!finitePositive(size?.width) || !finitePositive(size?.height)) {
    throw exportError("EXPORT_SIZE", "无法计算导出尺寸");
  }
  const safeScale = normalizedScale(scale);
  const width = Math.round(size.width * safeScale);
  const height = Math.round(size.height * safeScale);
  const estimatedBytes = width * height * BYTES_PER_PIXEL;
  if (!width || !height || !Number.isSafeInteger(estimatedBytes)) {
    throw exportError("EXPORT_MEMORY", "导出尺寸过大，请降低倍率或缩小画布");
  }
  return {
    width,
    height,
    includeBackground: !transparentOverlay,
    estimatedBytes,
  };
}

export function isSafeExport(plan, deviceMemory, filterHeavy = false) {
  const reported = Number(
    deviceMemory ?? globalThis.navigator?.deviceMemory ?? DEFAULT_DEVICE_MEMORY,
  );
  const memory = finitePositive(reported) ? reported : DEFAULT_DEVICE_MEMORY;
  const allowance = Math.max(128, memory * 128) * 1024 * 1024;
  const peakMultiplier = filterHeavy ? 5 : 3.5;
  return (
    finitePositive(plan?.estimatedBytes) &&
    plan.estimatedBytes * peakMultiplier < allowance
  );
}

function sourceDrawable(source) {
  if (!source) return null;
  if (typeof source === "string") return null;
  return source.source ?? source.element ?? source.bitmap ?? source.image ?? source;
}

function createCanvas(width, height) {
  if (typeof globalThis.OffscreenCanvas === "function") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof globalThis.document?.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw exportError("EXPORT_CANVAS", "当前浏览器不支持导出画布");
}

function getContext(canvas) {
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("2D context unavailable");
    return context;
  } catch (error) {
    throw exportError("EXPORT_CANVAS", "无法创建导出画布", error);
  }
}

function setLineStyle(context, style, scale) {
  context.strokeStyle = style.lineColor;
  context.fillStyle = style.textColor;
  context.lineWidth = Math.max(0.5, Number(style.lineWidth) || 1) * scale;
  context.globalAlpha = Math.max(0, Math.min(1, Number(style.opacity) || 0));
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash?.((style.dash ?? []).map((value) => Number(value) * scale));
}

function drawPath(context, points, closed = false) {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  if (closed) context.closePath();
  context.stroke();
}

function drawAnchor(context, point, style, scale) {
  context.beginPath();
  context.fillStyle = style.anchorColor;
  context.arc(
    point.x,
    point.y,
    Math.max(1, Number(style.anchorSize) || 1) * scale,
    0,
    Math.PI * 2,
  );
  context.fill();
}

function pointBounds(points) {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(1, Math.max(...xs) - x),
    height: Math.max(1, Math.max(...ys) - y),
  };
}

function drawLabel(context, text, x, y, style, scale) {
  context.fillStyle = style.textColor;
  context.font = `${Math.max(1, Number(style.fontSize) || 1) * scale}px ui-monospace, monospace`;
  context.textBaseline = "middle";
  context.fillText(String(text ?? ""), x, y);
}

function clampOpacity(value, fallback = DEFAULT_STYLE.opacity) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

/** Draw one normalized project annotation with the same geometry contract as Konva. */
export function drawAnnotationToContext(context, layer, canvasSize, scale = 1) {
  if (!layer || layer.visible === false) return;
  const style = { ...DEFAULT_STYLE, ...(layer.style ?? {}) };
  const points = (layer.points ?? []).map((point) => {
    const denormalized = denormalizePoint(point, canvasSize);
    return { x: denormalized.x * scale, y: denormalized.y * scale };
  });
  if (!points.length && layer.type !== "label") return;

  context.save();
  setLineStyle(context, style, scale);
  const tension = Number(style.curveTension) || 0;
  const curvePoints = makeCurvePoints(points, tension);
  const labelPoint = layer.labelPosition === "start" ? points[0] : points.at(-1);
  const labelOffset = layer.labelOffset ?? { x: 0, y: 0 };
  const offset = {
    x: Number(labelOffset.x) || 0,
    y: Number(labelOffset.y) || 0,
  };
  switch (layer.type) {
    case "box":
    case "stackBox": {
      if (points.length >= 2) {
        const bounds = pointBounds(points.slice(0, 2));
        const offsets = layer.type === "stackBox" ? [12, 6, 0] : [0];
        offsets.forEach((delta) => {
          context.strokeRect(
            bounds.x + delta * scale,
            bounds.y - delta * scale,
            bounds.width,
            bounds.height,
          );
        });
      }
      break;
    }
    case "path":
      if (curvePoints.length >= 2) drawPath(context, curvePoints);
      break;
    case "leader":
      if (curvePoints.length >= 2) {
        drawPath(context, curvePoints);
        drawAnchor(context, points[0], style, scale);
      }
      break;
    case "nodeCloud":
      if (curvePoints.length >= 2) drawPath(context, curvePoints, true);
      points.forEach((point) => drawAnchor(context, point, style, scale));
      break;
    case "randomNodes":
      points.forEach((point) => drawAnchor(context, point, style, scale));
      break;
    case "orbit": {
      if (points.length) {
        const center = points[0];
        const edge = points[1] ?? {
          x: center.x + (Number(style.anchorSize) || 1) * 6 * scale,
          y: center.y,
        };
        const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
        context.beginPath();
        context.arc(center.x, center.y, radius, 0, Math.PI * 2);
        context.stroke();
        context.globalAlpha *= 0.65;
        context.lineWidth = Math.max(0.5, (Number(style.lineWidth) || 1) * scale / 2);
        context.beginPath();
        context.arc(center.x, center.y, radius * 0.65, 0, Math.PI * 2);
        context.stroke();
        context.globalAlpha /= 0.65;
        points.slice(0, 2).forEach((point) => drawAnchor(context, point, style, scale));
      }
      break;
    }
    case "label":
      if (points.length && layer.showLabel !== false) {
        drawLabel(context, layer.label, points[0].x + offset.x * scale, points[0].y + offset.y * scale, style, scale);
      }
      break;
    default:
      break;
  }
  if (layer.type !== "label" && layer.showLabel !== false && labelPoint) {
    drawLabel(
      context,
      layer.label,
      labelPoint.x + 8 * scale + offset.x * scale,
      labelPoint.y + offset.y * scale,
      style,
      scale,
    );
  }
  context.restore();
}

function animationBounds(layer, points, style, scale) {
  const bounds = pointBounds(points);
  if (layer.type === "stackBox") {
    const offset = 12 * scale;
    return {
      x: bounds.x,
      y: bounds.y - offset,
      width: bounds.width + offset,
      height: bounds.height + offset,
    };
  }
  if (layer.type === "orbit" && points.length) {
    const center = points[0];
    const edge = points[1] ?? {
      x: center.x + (Number(style.anchorSize) || 1) * 6 * scale,
      y: center.y,
    };
    const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
    return {
      x: center.x - radius,
      y: center.y - radius,
      width: radius * 2,
      height: radius * 2,
    };
  }
  if (layer.type === "label" && points.length) {
    const fontSize = Math.max(1, Number(style.fontSize) || 1) * scale;
    return {
      x: points[0].x,
      y: points[0].y,
      width: Math.max(fontSize, String(layer.label ?? "").length * fontSize * 0.6),
      height: fontSize,
    };
  }
  return bounds;
}

function scaledLayerPoints(layer, canvasSize, scale) {
  return (layer.points ?? []).map((point) => {
    const denormalized = denormalizePoint(point, canvasSize);
    return { x: denormalized.x * scale, y: denormalized.y * scale };
  });
}

function drawMotionGeometry(context, layer, canvasSize, scale, bounds, motion, style, xOffset = 0) {
  const originX = bounds.x + bounds.width / 2;
  const originY = bounds.y + bounds.height / 2;
  context.save();
  context.translate(
    originX + motion.translateX * canvasSize.width * scale + xOffset * scale,
    originY + motion.translateY * canvasSize.height * scale,
  );
  context.rotate((motion.rotation * Math.PI) / 180);
  context.scale(motion.scale, motion.scale);
  context.translate(-originX, -originY);

  const clip = resolveDrawClip(bounds, motion.drawProgress);
  if (clip) {
    context.beginPath();
    context.rect(clip.x, clip.y, clip.width, clip.height);
    context.clip();
  }

  drawAnnotationToContext(
    context,
    { ...layer, style },
    canvasSize,
    scale,
  );
  context.restore();
}

/**
 * Canvas equivalent of AnnotationNode's animated Konva groups. It keeps the
 * preview and exporter on the same animation frame contract while retaining
 * the existing static geometry painter for each annotation type.
 */
export function drawAnimatedAnnotationToContext(
  context,
  layer,
  canvasSize,
  scale = 1,
  timeMs = 0,
) {
  if (!layer || layer.visible === false) return;
  const animation = sanitizeAnimation(layer.animation);
  if (animation.type === "none") {
    drawAnnotationToContext(context, layer, canvasSize, scale);
    return;
  }

  const style = { ...DEFAULT_STYLE, ...(layer.style ?? {}) };
  const points = scaledLayerPoints(layer, canvasSize, scale);
  if (!points.length && layer.type !== "label") return;
  const bounds = animationBounds(layer, points, style, scale);
  const motion = resolveAnimation(animation, timeMs);
  const baseOpacity = clampOpacity(style.opacity);
  const primaryStyle = { ...style, opacity: baseOpacity * motion.opacity };

  if (animation.type === "glitch") {
    const ghostOpacity = baseOpacity * 0.52 * motion.opacity * motion.flash;
    drawMotionGeometry(
      context,
      layer,
      canvasSize,
      scale,
      bounds,
      motion,
      { ...style, lineColor: "#e5484d", textColor: "#e5484d", anchorColor: "#e5484d", opacity: ghostOpacity },
      -4,
    );
    drawMotionGeometry(
      context,
      layer,
      canvasSize,
      scale,
      bounds,
      motion,
      { ...style, lineColor: "#3177ff", textColor: "#3177ff", anchorColor: "#3177ff", opacity: ghostOpacity },
      4,
    );
  }
  drawMotionGeometry(context, layer, canvasSize, scale, bounds, motion, primaryStyle);
}

async function canvasBlob(canvas, format, quality) {
  const type = format === "jpg" || format === "jpeg" ? "image/jpeg" : "image/png";
  const safeQuality = Number.isFinite(quality) ? Math.max(0, Math.min(1, quality)) : 0.92;
  if (typeof canvas.convertToBlob === "function") {
    try {
      const blob = await canvas.convertToBlob({ type, quality: safeQuality });
      if (!blob) throw new Error("empty blob");
      return blob;
    } catch (error) {
      throw exportError("EXPORT_CANVAS", "无法生成图片文件", error);
    }
  }
  if (typeof canvas.toBlob !== "function") {
    throw exportError("EXPORT_CANVAS", "当前浏览器不支持生成图片文件");
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(exportError("EXPORT_CANVAS", "无法生成图片文件"))),
      type,
      safeQuality,
    );
  });
}

export async function renderProjectFrameToBlob({
  project,
  sourceBitmap,
  scale = 1,
  format = "png",
  quality = 0.92,
  transparentOverlay = false,
  timeMs = 0,
}) {
  const plan = createExportPlan(project?.canvas, scale, transparentOverlay);
  const effectStack = Array.isArray(project?.effectStack)
    ? project.effectStack
    : legacyFiltersToEffectStack(project?.filters);
  const fragmentHasEffects = (project?.layers ?? []).some(
    (layer) => layer?.type === "extractedFragment" && Array.isArray(layer.effects) && layer.effects.length > 0,
  );
  if (!isSafeExport(plan, undefined, plan.includeBackground && (effectStack.length > 0 || fragmentHasEffects))) {
    throw exportError("EXPORT_MEMORY", "导出尺寸过大，请降低倍率或缩小画布");
  }
  const canvas = createCanvas(plan.width, plan.height);
  const context = getContext(canvas);
  try {
    try {
      if (plan.includeBackground && !sourceDrawable(sourceBitmap)) {
        throw exportError("EXPORT_SOURCE", "完整图片导出需要原始照片");
      }
      composeProjectFrameToContext(context, {
        project,
        sourceBitmap,
        scale,
        timeMs,
        includeBackground: plan.includeBackground,
        baseEffects: effectStack,
        drawAnnotation: drawAnimatedAnnotationToContext,
      });
    } catch (error) {
      if (error?.code?.startsWith?.("EXPORT_")) throw error;
      throw exportError("EXPORT_CANVAS", "无法绘制导出内容", error);
    }
    return await canvasBlob(canvas, format, quality);
  } finally {
    // Release the backing store after the Blob is detached from the canvas.
    try {
      canvas.width = 0;
      canvas.height = 0;
    } catch {
      // Some test doubles and old browsers expose read-only OffscreenCanvas sizes.
    }
  }
}

/** Static export is the deterministic first frame of the shared renderer. */
export function renderProjectToBlob(options) {
  return renderProjectFrameToBlob({ ...options, timeMs: 0 });
}

/** Decode the original file only for an export, leaving the working preview untouched. */
export async function decodeOriginalSource(image) {
  const file = image?.originalFile;
  if (file && typeof globalThis.createImageBitmap === "function") {
    try {
      const bitmap = await globalThis.createImageBitmap(file, { imageOrientation: "from-image" });
      if (bitmap.width * bitmap.height > MAX_DECODED_PIXELS) {
        bitmap.close?.();
        const error = new Error("图片像素不能超过 4000 万");
        error.code = "IMAGE_PIXEL_LIMIT";
        throw error;
      }
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close?.(),
      };
    } catch (error) {
      if (error?.code === "IMAGE_PIXEL_LIMIT") throw error;
      // Fall through to object URL + Image for browsers with partial bitmap support.
    }
  }
  if (file && typeof globalThis.URL?.createObjectURL === "function" && typeof globalThis.Image === "function") {
    const url = globalThis.URL.createObjectURL(file);
    try {
      const decoded = await new Promise((resolve, reject) => {
        const candidate = new Image();
        candidate.onload = () => resolve(candidate);
        candidate.onerror = () => reject(new Error("无法读取原始照片"));
        candidate.src = url;
      });
      const width = decoded.naturalWidth || decoded.width;
      const height = decoded.naturalHeight || decoded.height;
      if (width * height > MAX_DECODED_PIXELS) {
        globalThis.URL.revokeObjectURL(url);
        const error = new Error("图片像素不能超过 4000 万");
        error.code = "IMAGE_PIXEL_LIMIT";
        throw error;
      }
      return {
        source: decoded,
        width,
        height,
        dispose: () => globalThis.URL.revokeObjectURL(url),
      };
    } catch (error) {
      globalThis.URL.revokeObjectURL(url);
      if (error?.code === "IMAGE_PIXEL_LIMIT") throw error;
      throw exportError("EXPORT_SOURCE", "无法读取原始照片", error);
    }
  }
  if (image?.demo && typeof globalThis.Image === "function") {
    try {
      const decoded = await new Promise((resolve, reject) => {
        const candidate = new Image();
        candidate.onload = () => resolve(candidate);
        candidate.onerror = () => reject(new Error("无法读取演示底图"));
        candidate.src = publicAsset("cosplay-reference.png");
      });
      return { source: decoded, dispose: () => {} };
    } catch (error) {
      throw exportError("EXPORT_SOURCE", "无法读取演示底图", error);
    }
  }
  const source = sourceDrawable(image);
  if (source) return { source, dispose: () => {} };
  throw exportError("EXPORT_SOURCE", "完整图片导出需要原始照片");
}
