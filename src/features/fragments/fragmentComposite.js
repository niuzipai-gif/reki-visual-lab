import { applyEffectStack, normalizeEffectStack } from "../filters/effectStack.js";
import { resolveAnimation, resolveDrawClip } from "../motion/animationRuntime.js";

const MIN_RECT = 0.01;
export const FRAGMENT_PREVIEW_CACHE_MAX_ENTRIES = 24;
export const FRAGMENT_PREVIEW_CACHE_MAX_BYTES = 16 * 1024 * 1024;

let FRAGMENT_PREVIEW_CACHE = new WeakMap();

function number(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function bounded(value, minimum, maximum, fallback = minimum) {
  return Math.max(minimum, Math.min(maximum, number(value, fallback)));
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
  throw new Error("当前浏览器不支持片段画布");
}

function contextFor(canvas) {
  const context = canvas?.getContext?.("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法创建片段画布");
  return context;
}

/** Borrow a decoded image-like resource without taking ownership of it. */
export function fragmentDrawable(source) {
  if (!source || typeof source === "string") return null;
  return source.source ?? source.element ?? source.bitmap ?? source.image ?? source;
}

function dimensionsFor(source, canvasSize) {
  const drawable = fragmentDrawable(source);
  const width = number(
    drawable?.naturalWidth ?? drawable?.videoWidth ?? drawable?.width,
    number(canvasSize?.width, 1),
  );
  const height = number(
    drawable?.naturalHeight ?? drawable?.videoHeight ?? drawable?.height,
    number(canvasSize?.height, 1),
  );
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

export function fragmentRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  const width = bounded(rect.width, MIN_RECT, 1, MIN_RECT);
  const height = bounded(rect.height, MIN_RECT, 1, MIN_RECT);
  return {
    x: bounded(rect.x, 0, 1 - width, 0),
    y: bounded(rect.y, 0, 1 - height, 0),
    width,
    height,
  };
}

function layerOpacity(layer) {
  return bounded(layer?.opacity, 0, 1, 1);
}

function destinationBounds(layer, canvasSize, scale) {
  const transform = fragmentRect(layer?.transform ?? layer?.sourceRect);
  if (!transform) return null;
  const width = Math.max(1, number(canvasSize?.width, 1)) * scale;
  const height = Math.max(1, number(canvasSize?.height, 1)) * scale;
  return {
    x: transform.x * width,
    y: transform.y * height,
    width: transform.width * width,
    height: transform.height * height,
  };
}

/** Visible fragments that change the original location use a base-image hole. */
export function sourceHolesForLayers(layers = []) {
  return layers.flatMap((layer) => {
    if (
      layer?.type !== "extractedFragment" ||
      layer.visible === false ||
      !["transparent", "black", "white"].includes(layer.sourceFill)
    ) {
      return [];
    }
    const rect = fragmentRect(layer.sourceRect);
    return rect ? [{ ...rect, fill: layer.sourceFill }] : [];
  });
}

/** Paint holes after base-image effects, so black/white/transparent remain exact. */
export function drawSourceHolesToContext(context, layers, canvasSize, scale = 1) {
  const width = Math.max(1, number(canvasSize?.width, 1)) * scale;
  const height = Math.max(1, number(canvasSize?.height, 1)) * scale;
  for (const hole of sourceHolesForLayers(layers)) {
    const x = hole.x * width;
    const y = hole.y * height;
    const holeWidth = hole.width * width;
    const holeHeight = hole.height * height;
    if (hole.fill === "transparent") {
      context.clearRect(x, y, holeWidth, holeHeight);
    } else {
      context.fillStyle = hole.fill === "black" ? "#000" : "#fff";
      context.fillRect(x, y, holeWidth, holeHeight);
    }
  }
}

function applyLocalEffects(context, width, height, effects) {
  const stack = normalizeEffectStack(effects);
  if (!stack.length) return;
  const pixels = context.getImageData(0, 0, width, height);
  context.putImageData(applyEffectStack(pixels, stack), 0, 0);
}

function effectSignature(effects) {
  return JSON.stringify(normalizeEffectStack(effects));
}

function previewByteSize(canvas) {
  const width = Math.max(1, number(canvas?.width, 1));
  const height = Math.max(1, number(canvas?.height, 1));
  return width * height * 4;
}

function cachedPreview(drawable, signature) {
  const sourceCache = FRAGMENT_PREVIEW_CACHE.get(drawable);
  const entry = sourceCache?.entries.get(signature);
  if (!entry) return null;
  sourceCache.entries.delete(signature);
  sourceCache.entries.set(signature, entry);
  return entry.canvas;
}

function cachePreview(drawable, signature, canvas) {
  const sourceCache = FRAGMENT_PREVIEW_CACHE.get(drawable) ?? {
    entries: new Map(),
    byteSize: 0,
  };
  const byteSize = previewByteSize(canvas);
  sourceCache.entries.set(signature, { canvas, byteSize });
  sourceCache.byteSize += byteSize;

  while (
    sourceCache.entries.size > FRAGMENT_PREVIEW_CACHE_MAX_ENTRIES ||
    sourceCache.byteSize > FRAGMENT_PREVIEW_CACHE_MAX_BYTES
  ) {
    const [oldestKey, oldest] = sourceCache.entries.entries().next().value;
    sourceCache.entries.delete(oldestKey);
    sourceCache.byteSize -= oldest.byteSize;
  }
  FRAGMENT_PREVIEW_CACHE.set(drawable, sourceCache);
}

export function resetFragmentPreviewCache() {
  FRAGMENT_PREVIEW_CACHE = new WeakMap();
}

export function fragmentPreviewCacheMetrics(source) {
  const drawable = fragmentDrawable(source);
  const sourceCache = drawable ? FRAGMENT_PREVIEW_CACHE.get(drawable) : null;
  return {
    entryCount: sourceCache?.entries.size ?? 0,
    byteSize: sourceCache?.byteSize ?? 0,
  };
}

function fragmentImage({ source, sourceRect, canvasSize, canvasFactory }) {
  const drawable = fragmentDrawable(source);
  if (!drawable || !sourceRect) return null;
  const dimensions = dimensionsFor(drawable, canvasSize);
  const width = Math.max(1, Math.round(sourceRect.width * dimensions.width));
  const height = Math.max(1, Math.round(sourceRect.height * dimensions.height));
  const canvas = (canvasFactory ?? createCanvas)(width, height);
  const context = contextFor(canvas);
  context.clearRect(0, 0, width, height);
  context.drawImage(
    drawable,
    sourceRect.x * dimensions.width,
    sourceRect.y * dimensions.height,
    sourceRect.width * dimensions.width,
    sourceRect.height * dimensions.height,
    0,
    0,
    width,
    height,
  );
  return { canvas, context, width, height };
}

/**
 * Return a cached, locally-effected crop for the live Konva preview and frame
 * renderer. A transform-only drag never changes this key, so no pixels are
 * recomputed while the user moves/resizes a fragment.
 */
export function createFragmentPreview({ source, layer, canvasSize, canvasFactory } = {}) {
  const drawable = fragmentDrawable(source);
  const sourceRect = fragmentRect(layer?.sourceRect);
  const effects = normalizeEffectStack(layer?.effects ?? []);
  if (!drawable || !sourceRect || !effects.length) return null;
  const signature = `${sourceRect.x}:${sourceRect.y}:${sourceRect.width}:${sourceRect.height}:${effectSignature(effects)}`;
  const canCache = !canvasFactory && (typeof drawable === "object" || typeof drawable === "function");
  const cached = canCache ? cachedPreview(drawable, signature) : null;
  if (cached) return cached;
  const crop = fragmentImage({ source: drawable, sourceRect, canvasSize, canvasFactory });
  if (!crop) return null;
  applyLocalEffects(crop.context, crop.width, crop.height, effects);
  if (canCache) {
    cachePreview(drawable, signature, crop.canvas);
  }
  return crop.canvas;
}

function drawFragmentAt(context, drawable, prepared, layer, canvasSize, scale, timeMs, offset = 0, alphaMultiplier = 1) {
  const sourceRect = fragmentRect(layer?.sourceRect);
  const bounds = destinationBounds(layer, canvasSize, scale);
  if (!sourceRect || !bounds || !drawable) return;
  const motion = resolveAnimation(layer?.animation, timeMs);
  const sourceSize = dimensionsFor(drawable, canvasSize);

  const canvasWidth = Math.max(1, number(canvasSize?.width, 1)) * scale;
  const canvasHeight = Math.max(1, number(canvasSize?.height, 1)) * scale;
  const originX = bounds.x + bounds.width / 2;
  const originY = bounds.y + bounds.height / 2;
  const clip = resolveDrawClip(bounds, motion.drawProgress);

  context.save();
  context.translate(
    originX + motion.translateX * canvasWidth + offset * scale,
    originY + motion.translateY * canvasHeight,
  );
  context.rotate((motion.rotation * Math.PI) / 180);
  context.scale(motion.scale, motion.scale);
  context.translate(-originX, -originY);
  context.globalAlpha *= layerOpacity(layer) * motion.opacity * alphaMultiplier;
  if (clip) {
    context.beginPath();
    context.rect(clip.x, clip.y, clip.width, clip.height);
    context.clip();
  }
  if (prepared) {
    context.drawImage(prepared, bounds.x, bounds.y, bounds.width, bounds.height);
  } else {
    context.drawImage(
      drawable,
      sourceRect.x * sourceSize.width,
      sourceRect.y * sourceSize.height,
      sourceRect.width * sourceSize.width,
      sourceRect.height * sourceSize.height,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
    );
  }
  context.restore();
}

/**
 * Draw one extracted original-pixel layer. Its local effect stack is applied
 * only to an offscreen cropped copy, so it can never mutate the base image.
 */
export function drawFragmentToContext(context, {
  layer,
  source,
  canvasSize,
  scale = 1,
  timeMs = 0,
  canvasFactory,
} = {}) {
  if (!layer || layer.type !== "extractedFragment" || layer.visible === false) return;
  const drawable = fragmentDrawable(source);
  if (!drawable) return;
  const motion = resolveAnimation(layer.animation, timeMs);
  const prepared = createFragmentPreview({ source: drawable, layer, canvasSize, canvasFactory });
  if (layer.animation?.type === "glitch") {
    drawFragmentAt(context, drawable, prepared, layer, canvasSize, scale, timeMs, -4, 0.52 * motion.flash);
    drawFragmentAt(context, drawable, prepared, layer, canvasSize, scale, timeMs, 4, 0.52 * motion.flash);
  }
  drawFragmentAt(context, drawable, prepared, layer, canvasSize, scale, timeMs);
}

/** Apply a stack without exposing canvas reads to the surrounding renderer. */
export function applyEffectsToContext(context, width, height, effects = []) {
  const stack = normalizeEffectStack(effects);
  if (!stack.length) return;
  const pixels = context.getImageData(0, 0, width, height);
  context.putImageData(applyEffectStack(pixels, stack), 0, 0);
}

/**
 * Shared static/video frame composition: base image + base effects + holes,
 * then fragments/annotations in declared layer order.
 */
export function composeProjectFrameToContext(context, {
  project,
  sourceBitmap,
  scale = 1,
  timeMs = 0,
  includeBackground = true,
  baseEffects = [],
  drawAnnotation,
  canvasFactory,
} = {}) {
  const canvasSize = project?.canvas;
  const width = Math.max(1, number(canvasSize?.width, 1)) * scale;
  const height = Math.max(1, number(canvasSize?.height, 1)) * scale;
  const source = fragmentDrawable(sourceBitmap);
  context.clearRect(0, 0, width, height);
  if (includeBackground) {
    if (!source) throw new Error("完整图片导出需要原始照片");
    context.drawImage(source, 0, 0, width, height);
    context.filter = "none";
    applyEffectsToContext(context, width, height, baseEffects);
    drawSourceHolesToContext(context, project?.layers ?? [], canvasSize, scale);
  }
  for (const layer of project?.layers ?? []) {
    if (layer?.type === "extractedFragment") {
      drawFragmentToContext(context, { layer, source, canvasSize, scale, timeMs, canvasFactory });
    } else {
      drawAnnotation?.(context, layer, canvasSize, scale, timeMs);
    }
  }
}
