import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { BackgroundLayer } from "./BackgroundLayer.jsx";

const identityIds = new WeakMap();
let nextIdentityId = 1;

function sourceIdentity(image) {
  if (!image) return null;
  if (typeof image !== "object") return image;
  return image.originalFile ?? image.source ?? image.element ?? image.bitmap ?? image;
}

function identityKey(value) {
  if (value && (typeof value === "object" || typeof value === "function")) {
    if (!identityIds.has(value)) identityIds.set(value, nextIdentityId++);
    return `source-${identityIds.get(value)}`;
  }
  return `source-${String(value ?? "none")}`;
}

function fitCanvas(canvasSize, availableSize, zoom) {
  const fitScale = Math.min(
    availableSize.width / canvasSize.width,
    availableSize.height / canvasSize.height,
  );
  const safeScale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1;
  const scale = safeScale * (zoom / 100);
  return {
    width: canvasSize.width * scale,
    height: canvasSize.height * scale,
  };
}

/**
 * A deliberately passive sibling canvas for source comparison. It has no
 * Konva stage, annotation nodes, animation clock, or image effect stack.
 */
export function OriginalComparisonPane({
  image,
  canvasSize,
  zoom = 100,
  presentationSize,
  hidden = false,
}) {
  const viewportRef = useRef(null);
  const [measuredSize, setMeasuredSize] = useState(null);
  const availableSize = presentationSize ?? measuredSize ?? canvasSize;
  const identity = sourceIdentity(image);
  const cache = useMemo(
    () => ({
      key: `${identityKey(identity)}:${availableSize.width}x${availableSize.height}`,
      image,
    }),
    [availableSize.height, availableSize.width, identity, image],
  );
  const fitted = fitCanvas(canvasSize, availableSize, zoom);

  useLayoutEffect(() => {
    if (presentationSize || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setMeasuredSize({ width, height });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [presentationSize]);

  return (
    <section
      ref={viewportRef}
      className="original-comparison-pane"
      aria-label="原图实时对照"
      data-effect-count="0"
      data-animation="none"
      data-zoom={zoom}
      data-cache-key={cache.key}
      hidden={hidden}
    >
      <div
        className="original-comparison-surface"
        style={{ width: fitted.width, height: fitted.height }}
      >
        <BackgroundLayer
          image={cache.image}
          canvasSize={canvasSize}
          filters={{}}
          effectStack={[]}
          showOriginal
        />
      </div>
    </section>
  );
}
