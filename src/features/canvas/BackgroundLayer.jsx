import React, { useEffect, useMemo, useRef, useState } from "react";
import { previewSize } from "../import/decodeImage.js";
import {
  applyPixelFilters,
  hasActivePixelFilters,
} from "../filters/filterPipeline.js";

function previewFilter(filters = {}) {
  const values = [];
  if (filters.brightness !== undefined) {
    values.push(`brightness(${filters.brightness})`);
  }
  if (filters.contrast !== undefined || filters.sharpness !== undefined) {
    values.push(
      `contrast(${(filters.contrast ?? 1) + (filters.sharpness ?? 0) * 0.15})`,
    );
  }
  if (filters.saturation !== undefined) {
    values.push(`saturate(${filters.saturation})`);
  }
  return values.join(" ");
}

function imageResource(image) {
  // The renderer only borrows decoded resources; import/project code owns disposal.
  if (!image) return null;
  if (image.demo) {
    return { kind: "url", source: "/cosplay-reference.png" };
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

export function BackgroundLayer({
  image,
  canvasSize,
  filters,
  onImageSourceReady,
}) {
  const canvasRef = useRef(null);
  const sourceCacheRef = useRef(null);
  const resource = useMemo(() => imageResource(image), [image]);
  const isDemo = image?.demo === true;
  const [urlSource, setUrlSource] = useState(null);
  const [renderError, setRenderError] = useState(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const dimensions = previewSize(canvasSize.width, canvasSize.height);

  useEffect(() => {
    sourceCacheRef.current = null;
    setCanvasReady(false);
    setRenderError(null);
  }, [resource]);

  useEffect(() => {
    const source =
      resource?.kind === "drawable"
        ? resource.source
        : resource?.kind === "url"
          ? urlSource?.url === resource.source
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

    const handle = schedule(() => {
      if (cancelled) return;
      try {
        const context = canvas.getContext("2d", {
          willReadFrequently: true,
        });
        if (!context) return;
        const active = hasActivePixelFilters(filters);
        const cached = sourceCacheRef.current;
        if (
          active &&
          cached?.source === source &&
          cached.width === dimensions.width &&
          cached.height === dimensions.height &&
          cached.pixels
        ) {
          context.putImageData(
            applyPixelFilters(cached.pixels, filters),
            0,
            0,
          );
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
        onImageSourceReady?.(source);
        setCanvasReady(true);
        sourceCacheRef.current = {
          source,
          width: dimensions.width,
          height: dimensions.height,
          pixels: null,
        };
        if (!active) {
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
          context.putImageData(applyPixelFilters(pixels, filters), 0, 0);
          setRenderError(null);
        } catch {
          // Drawing succeeded, so the canvas remains a safe unfiltered fallback.
          setRenderError("无法应用像素效果，已保留原图");
        }
      } catch {
        setCanvasReady(false);
        setRenderError("无法绘制底图，已保留原图");
      }
    });

    return () => {
      cancelled = true;
      cancel(handle);
    };
  }, [
    dimensions.height,
    dimensions.width,
    filters,
    resource,
    urlSource,
    onImageSourceReady,
  ]);

  if (!isDemo && !resource) return null;

  return (
    <div
      data-testid="canvas-background"
      className={`canvas-background${isDemo ? " demo-canvas" : ""}`}
      style={{ filter: previewFilter(filters) }}
    >
      {resource?.kind === "url" ? (
        <img
          data-testid="background-image-source"
          className={canvasReady ? "background-source hidden" : "background-source"}
          src={resource.source}
          alt=""
          draggable={false}
          onLoad={(event) =>
            setUrlSource({
              url: resource.source,
              source: event.currentTarget,
            })
          }
          onError={() => setRenderError("无法加载底图，请重新选择照片")}
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
