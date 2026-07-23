import React, { useEffect, useMemo, useRef } from "react";

function previewFilter(filters = {}) {
  const values = [
    `brightness(${filters.brightness ?? 1})`,
    `contrast(${(filters.contrast ?? 1) + (filters.sharpness ?? 0) * 0.15})`,
    `saturate(${filters.saturation ?? 1})`,
  ];
  if (filters.grain) values.push(`sepia(${filters.grain * 0.35})`);
  if (filters.chromaShift) {
    values.push(`hue-rotate(${filters.chromaShift * 30}deg)`);
  }
  return values.join(" ");
}

function imageResource(image) {
  // The renderer only borrows decoded resources; import/project code owns disposal.
  if (!image || image.demo) return null;

  if (typeof image === "string") {
    return { kind: "url", source: image };
  }

  const wrapped = image.element ?? image.bitmap ?? image.image;
  const source = wrapped ?? image;

  if (typeof source === "string") {
    return { kind: "url", source };
  }

  if (wrapped == null && typeof image.url === "string") {
    return { kind: "url", source: image.url };
  }

  return { kind: "drawable", source };
}

export function BackgroundLayer({ image, canvasSize, filters }) {
  const canvasRef = useRef(null);
  const resource = useMemo(() => imageResource(image), [image]);
  const isDemo = image?.demo === true;

  useEffect(() => {
    if (resource?.kind !== "drawable") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const context = canvas.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, canvasSize.width, canvasSize.height);
      context.drawImage(
        resource.source,
        0,
        0,
        canvasSize.width,
        canvasSize.height,
      );
    } catch {
      // A not-yet-ready or released drawable should not take down the editor.
    }
  }, [canvasSize.height, canvasSize.width, resource]);

  if (!isDemo && !resource) return null;

  return (
    <div
      data-testid="canvas-background"
      className={`canvas-background${isDemo ? " demo-canvas" : ""}`}
      style={{ filter: previewFilter(filters) }}
    >
      {resource?.kind === "url" ? (
        <img
          data-testid="background-image"
          src={resource.source}
          alt=""
          draggable={false}
        />
      ) : resource?.kind === "drawable" ? (
        <canvas
          ref={canvasRef}
          data-testid="background-image"
          width={canvasSize.width}
          height={canvasSize.height}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}
