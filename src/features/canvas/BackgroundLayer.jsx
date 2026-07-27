import React, { useEffect, useMemo, useRef, useState } from "react";
import { previewSize } from "../import/decodeImage.js";
import {
  applyEffectStack,
  legacyFiltersToEffectStack,
} from "../filters/effectStack.js";
import { publicAsset } from "../../publicAsset.js";

const EMPTY_EFFECT_STACK = Object.freeze([]);

function sourceHolesForCanvas(sourceHoles, dimensions) {
  if (!Array.isArray(sourceHoles)) return [];
  return sourceHoles.flatMap((hole) => {
    const x = Number(hole?.x);
    const y = Number(hole?.y);
    const width = Number(hole?.width);
    const height = Number(hole?.height);
    const fill = hole?.fill;
    if (
      ![x, y, width, height].every(Number.isFinite) ||
      width <= 0 ||
      height <= 0 ||
      !["transparent", "black", "white"].includes(fill)
    ) {
      return [];
    }
    return [{
      x: Math.max(0, x * dimensions.width),
      y: Math.max(0, y * dimensions.height),
      width: Math.max(0, Math.min(dimensions.width, (x + width) * dimensions.width) - Math.max(0, x * dimensions.width)),
      height: Math.max(0, Math.min(dimensions.height, (y + height) * dimensions.height) - Math.max(0, y * dimensions.height)),
      fill,
    }];
  });
}

function paintSourceHoles(context, sourceHoles, dimensions) {
  for (const hole of sourceHolesForCanvas(sourceHoles, dimensions)) {
    if (!hole.width || !hole.height) continue;
    if (hole.fill === "transparent") {
      context.clearRect(hole.x, hole.y, hole.width, hole.height);
      continue;
    }
    context.fillStyle = hole.fill === "black" ? "#000" : "#fff";
    context.fillRect(hole.x, hole.y, hole.width, hole.height);
  }
}

function imageResource(image) {
  // The renderer only borrows decoded resources; import/project code owns disposal.
  if (!image) return null;
  if (image.demo) {
    return { kind: "url", source: publicAsset("cosplay-reference.png") };
  }

  if (typeof image === "string") {
    return { kind: "url", source: image };
  }

  const wrapped =
    image.source ?? image.element ?? image.bitmap ?? image.image;
  const source = wrapped ?? image;

  if (typeof source === "string") {
    return { kind: "url", source };
  }

  if (wrapped == null && typeof image.url === "string") {
    return { kind: "url", source: image.url };
  }

  return { kind: "drawable", source };
}

function imageRenderIdentity(image) {
  if (!image || typeof image !== "object") return image;
  if (image.demo) return "demo";
  const wrapped = image.source ?? image.element ?? image.bitmap ?? image.image;
  if (wrapped !== undefined && wrapped !== null) return wrapped;
  if (typeof image.url === "string") return image.url;
  return image;
}

function isBlobLike(value) {
  return (
    value instanceof Blob ||
    (value &&
      typeof value === "object" &&
      Number.isFinite(value.size) &&
      typeof value.type === "string" &&
      typeof value.slice === "function")
  );
}

function directOriginalResource(value) {
  if (typeof value === "string") {
    return { kind: "url", source: value, owned: false };
  }
  if (!value || isBlobLike(value)) return null;

  if (typeof value.url === "string") {
    return { kind: "url", source: value.url, owned: false };
  }

  const wrapped = value.source ?? value.element ?? value.bitmap ?? value.image;
  if (wrapped && wrapped !== value) return directOriginalResource(wrapped);

  if (typeof value === "object" || typeof value === "function") {
    return { kind: "drawable", source: value, owned: false };
  }
  return null;
}

function disposeOriginalResource(resource) {
  if (!resource?.owned) return;
  resource.dispose?.();
}

async function decodeOriginalResource(value) {
  if (!isBlobLike(value)) return directOriginalResource(value);

  if (typeof globalThis.createImageBitmap === "function") {
    try {
      const bitmap = await globalThis.createImageBitmap(value, {
        imageOrientation: "from-image",
      });
      return {
        kind: "drawable",
        source: bitmap,
        owned: true,
        dispose: () => bitmap.close?.(),
      };
    } catch {
      // Fall through to an object URL when ImageBitmap decoding is unavailable.
    }
  }

  if (
    typeof URL?.createObjectURL !== "function" ||
    typeof globalThis.Image !== "function"
  ) {
    throw new Error("无法读取原图");
  }

  const url = URL.createObjectURL(value);
  try {
    const image = await new Promise((resolve, reject) => {
      const candidate = new Image();
      candidate.onload = () => resolve(candidate);
      candidate.onerror = () => reject(new Error("无法读取原图"));
      candidate.src = url;
    });
    return {
      kind: "drawable",
      source: image,
      owned: true,
      dispose: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export function BackgroundLayer({
  image,
  canvasSize,
  filters,
  effectStack,
  showOriginal = false,
  sourceHoles = EMPTY_EFFECT_STACK,
  onImageSourceReady,
}) {
  const canvasRef = useRef(null);
  const sourceCacheRef = useRef(null);
  const sourceGenerationRef = useRef(0);
  const scheduledFrameRef = useRef(null);
  const originalResourceRef = useRef(null);
  const renderIdentity = imageRenderIdentity(image);
  const resource = useMemo(() => imageResource(image), [renderIdentity]);
  const isDemo = image?.demo === true;
  const [urlSource, setUrlSource] = useState(null);
  const [originalResource, setOriginalResource] = useState(null);
  const [renderError, setRenderError] = useState(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const dimensions = previewSize(canvasSize.width, canvasSize.height);
  const explicitEffectStack = Array.isArray(effectStack);
  const effectStackInput = explicitEffectStack
    ? effectStack.length > 0
      ? effectStack
      : EMPTY_EFFECT_STACK
    : null;
  const legacyFilterInput = explicitEffectStack ? null : filters;
  const effectiveStack = useMemo(
    () => effectStackInput ?? legacyFiltersToEffectStack(legacyFilterInput),
    [effectStackInput, legacyFilterInput],
  );
  const activeResource = showOriginal ? originalResource : resource;
  const displayResource = activeResource ?? resource;

  function replaceOriginalResource(nextResource) {
    const previous = originalResourceRef.current;
    if (previous !== nextResource) disposeOriginalResource(previous);
    originalResourceRef.current = nextResource;
    setOriginalResource(nextResource);
  }

  useEffect(() => {
    sourceCacheRef.current = null;
    if (!showOriginal) setCanvasReady(false);
    setRenderError(null);
  }, [resource, showOriginal]);

  useEffect(() => {
    const generation = ++sourceGenerationRef.current;
    sourceCacheRef.current = null;
    const scheduled = scheduledFrameRef.current;
    if (scheduled) {
      scheduled.cancel(scheduled.handle);
      scheduledFrameRef.current = null;
    }

    let cancelled = false;
    replaceOriginalResource(null);
    if (!showOriginal) {
      return () => {
        cancelled = true;
      };
    }

    const originalFile = image?.originalFile;
    if (originalFile == null) {
      replaceOriginalResource(resource);
      return () => {
        cancelled = true;
      };
    }

    const direct = directOriginalResource(originalFile);
    if (direct) {
      replaceOriginalResource(direct);
      return () => {
        cancelled = true;
      };
    }

    void decodeOriginalResource(originalFile)
      .then((decoded) => {
        if (
          cancelled ||
          generation !== sourceGenerationRef.current
        ) {
          disposeOriginalResource(decoded);
          return;
        }
        replaceOriginalResource(decoded);
      })
      .catch(() => {
        if (!cancelled && generation === sourceGenerationRef.current) {
          setRenderError("原图不可用，请重新导入");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [image?.originalFile, resource, showOriginal]);

  useEffect(() => {
    return () => {
      const scheduled = scheduledFrameRef.current;
      if (scheduled) scheduled.cancel(scheduled.handle);
      disposeOriginalResource(originalResourceRef.current);
      originalResourceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (
      displayResource?.kind !== "url" ||
      urlSource?.url === displayResource.source
    ) {
      return;
    }
    setUrlSource(null);
  }, [displayResource, urlSource?.url]);

  useEffect(() => {
    const source =
      activeResource?.kind === "drawable"
        ? activeResource.source
        : activeResource?.kind === "url"
          ? urlSource?.url === activeResource.source
            ? urlSource.source
            : null
          : null;
    if (!source || !dimensions.width || !dimensions.height) return undefined;

    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let cancelled = false;
    const schedule =
      globalThis.requestAnimationFrame ??
      ((callback) => setTimeout(() => callback(Date.now()), 0));
    const cancel =
      globalThis.cancelAnimationFrame ??
      ((handle) => clearTimeout(handle));
    const generation = sourceGenerationRef.current;

    const handle = schedule(() => {
      scheduledFrameRef.current = null;
      if (cancelled || generation !== sourceGenerationRef.current) return;
      try {
        const context = canvas.getContext("2d", {
          willReadFrequently: true,
        });
        if (!context) return;
        const activeStack = showOriginal ? [] : effectiveStack;
        const active = activeStack.length > 0;
        const cached = sourceCacheRef.current;
        if (
          active &&
          cached?.source === source &&
          cached.showOriginal === showOriginal &&
          cached.width === dimensions.width &&
          cached.height === dimensions.height &&
          cached.pixels
        ) {
          context.putImageData(
            applyEffectStack(cached.pixels, activeStack),
            0,
            0,
          );
          paintSourceHoles(context, sourceHoles, dimensions);
          setCanvasReady(true);
          setRenderError(null);
          return;
        }

        context.clearRect(0, 0, dimensions.width, dimensions.height);
        context.drawImage(
          source,
          0,
          0,
          dimensions.width,
          dimensions.height,
        );
        if (generation !== sourceGenerationRef.current) return;
        let featureSample = null;
        if (!active && onImageSourceReady && typeof context.getImageData === "function") {
          try {
            const sampleWidth = Math.min(64, dimensions.width);
            const sampleHeight = Math.min(64, dimensions.height);
            featureSample = {
              imageData: context.getImageData(0, 0, sampleWidth, sampleHeight),
              width: Number(source.naturalWidth ?? source.videoWidth ?? source.width) || dimensions.width,
              height: Number(source.naturalHeight ?? source.videoHeight ?? source.height) || dimensions.height,
              subjectHints: [],
            };
          } catch {
            // A tainted or unavailable canvas still remains usable for landmark scanning.
          }
        }
        if (featureSample) onImageSourceReady?.(source, featureSample);
        else onImageSourceReady?.(source);
        setCanvasReady(true);
        sourceCacheRef.current = {
          source,
          showOriginal,
          width: dimensions.width,
          height: dimensions.height,
          pixels: null,
        };
        if (!active) {
          paintSourceHoles(context, sourceHoles, dimensions);
          setRenderError(null);
          return;
        }
        try {
          const pixels = context.getImageData(
            0,
            0,
            dimensions.width,
            dimensions.height,
          );
          sourceCacheRef.current.pixels = pixels;
          context.putImageData(applyEffectStack(pixels, activeStack), 0, 0);
          paintSourceHoles(context, sourceHoles, dimensions);
          setRenderError(null);
        } catch {
          // Drawing succeeded, so the canvas remains a safe unfiltered fallback.
          setRenderError("无法应用像素效果，已保留原图");
        }
      } catch {
        if (generation !== sourceGenerationRef.current) return;
        if (showOriginal) {
          setRenderError("原图不可用，请重新导入");
        } else {
          setCanvasReady(false);
          setRenderError("无法绘制底图，已保留原图");
        }
      }
    });
    scheduledFrameRef.current = { handle, cancel };

    return () => {
      cancelled = true;
      cancel(handle);
      if (scheduledFrameRef.current?.handle === handle) {
        scheduledFrameRef.current = null;
      }
    };
  }, [
    dimensions.height,
    dimensions.width,
    effectiveStack,
    showOriginal,
    activeResource,
    urlSource,
    onImageSourceReady,
    sourceHoles,
  ]);

  if (!isDemo && !resource) return null;

  return (
    <div
      data-testid="canvas-background"
      className={`canvas-background${isDemo && !showOriginal ? " demo-canvas" : ""}`}
      data-original={String(showOriginal)}
      style={{}}
    >
      {displayResource?.kind === "url" ? (
        <img
          data-testid="background-image-source"
          className={canvasReady ? "background-source hidden" : "background-source"}
          src={displayResource.source}
          alt=""
          draggable={false}
          onLoad={(event) =>
            setUrlSource({
              url: displayResource.source,
              source: event.currentTarget,
            })
          }
          onError={() =>
            setRenderError(
              showOriginal
                ? "原图不可用，请重新导入"
                : "无法加载底图，请重新选择照片",
            )
          }
        />
      ) : null}
      {resource ? (
        <canvas
          ref={canvasRef}
          data-testid="background-image"
          width={dimensions.width}
          height={dimensions.height}
          className={canvasReady ? "" : "hidden"}
          aria-hidden="true"
        />
      ) : null}
      {renderError ? (
        <span className="sr-only" role="status">
          {renderError}
        </span>
      ) : null}
    </div>
  );
}
