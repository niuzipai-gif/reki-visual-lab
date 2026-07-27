import React, { useMemo } from "react";
import { Circle, Group, Image, Rect } from "react-konva";
import { resizeBoundsFromHandle } from "../../domain/transform.js";
import { resolveAnimation, resolveDrawClip } from "../motion/animationRuntime.js";
import { createFragmentPreview } from "./fragmentComposite.js";

const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN_SIZE = 0.01;

function safeRect(rect) {
  const x = Number(rect?.x);
  const y = Number(rect?.y);
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  if (![x, y, width, height].every(Number.isFinite)) {
    return { x: 0, y: 0, width: MIN_SIZE, height: MIN_SIZE };
  }
  const normalizedWidth = Math.max(MIN_SIZE, Math.min(1, width));
  const normalizedHeight = Math.max(MIN_SIZE, Math.min(1, height));
  return {
    x: Math.max(0, Math.min(1 - normalizedWidth, x)),
    y: Math.max(0, Math.min(1 - normalizedHeight, y)),
    width: normalizedWidth,
    height: normalizedHeight,
  };
}

function sourceDimension(image, axis, fallback) {
  const candidates = axis === "width"
    ? [image?.naturalWidth, image?.videoWidth, image?.width]
    : [image?.naturalHeight, image?.videoHeight, image?.height];
  const value = candidates.find((candidate) => Number.isFinite(candidate) && candidate > 0);
  return value ?? fallback;
}

function handlePosition(bounds, handle) {
  return {
    x: handle.includes("w")
      ? bounds.x
      : handle.includes("e")
        ? bounds.x + bounds.width
        : bounds.x + bounds.width / 2,
    y: handle.includes("n")
      ? bounds.y
      : handle.includes("s")
        ? bounds.y + bounds.height
        : bounds.y + bounds.height / 2,
  };
}

function clampDrag(transform, offset) {
  const round = (value) => Math.round(value * 1_000_000) / 1_000_000;
  return {
    ...transform,
    x: round(Math.max(0, Math.min(1 - transform.width, transform.x + offset.x))),
    y: round(Math.max(0, Math.min(1 - transform.height, transform.y + offset.y))),
  };
}

function roundedRect(rect) {
  const round = (value) => Math.round(value * 1_000_000) / 1_000_000;
  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
  };
}

function fragmentOpacity(value) {
  const opacity = Number(value);
  return Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
}

function previewEffectSignature(effects) {
  return JSON.stringify(effects ?? []);
}

/**
 * A non-destructive rectangular view into the image source. Dragging only
 * writes `transform`, so the reducer deliberately unlinks it from its marker.
 */
export function FragmentNode({
  layer,
  image,
  canvasSize,
  selected = false,
  onSelect,
  onChange,
  animationTimeMs = 0,
}) {
  const transform = safeRect(layer?.transform ?? layer?.sourceRect);
  const sourceRect = safeRect(layer?.sourceRect);
  const canvasWidth = Math.max(1, Number(canvasSize?.width) || 1);
  const canvasHeight = Math.max(1, Number(canvasSize?.height) || 1);
  const bounds = {
    x: transform.x * canvasWidth,
    y: transform.y * canvasHeight,
    width: transform.width * canvasWidth,
    height: transform.height * canvasHeight,
  };
  const imageWidth = sourceDimension(image, "width", canvasWidth);
  const imageHeight = sourceDimension(image, "height", canvasHeight);
  const localPreview = useMemo(() => {
    try {
      return createFragmentPreview({
        source: image,
        layer,
        canvasSize,
      });
    } catch {
      // A tainted source can still render through Konva's direct crop path.
      return null;
    }
  }, [
    image,
    canvasSize?.width,
    canvasSize?.height,
    layer?.sourceRect?.x,
    layer?.sourceRect?.y,
    layer?.sourceRect?.width,
    layer?.sourceRect?.height,
    previewEffectSignature(layer?.effects),
  ]);
  const motion = resolveAnimation(layer?.animation, animationTimeMs);
  const opacity = fragmentOpacity(layer?.opacity);
  const origin = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const clip = resolveDrawClip(bounds, motion.drawProgress);

  function select(event) {
    if (event) event.cancelBubble = true;
    onSelect?.();
  }

  function finishDrag(event) {
    const offset = {
      x: (Number(event.target.x?.()) || 0) / canvasWidth,
      y: (Number(event.target.y?.()) || 0) / canvasHeight,
    };
    event.target.position?.({ x: 0, y: 0 });
    onChange?.({ transform: clampDrag(transform, offset) });
  }

  function finishResize(handle, event) {
    if (event) event.cancelBubble = true;
    const pointer = {
      x: (Number(event.target.x?.()) || 0) / canvasWidth,
      y: (Number(event.target.y?.()) || 0) / canvasHeight,
    };
    const next = roundedRect(resizeBoundsFromHandle(transform, handle, pointer));
    event.target.position?.(handlePosition(bounds, handle));
    onChange?.({ transform: next });
  }

  const geometry = (
    <Group
      name="fragment-motion-geometry"
      x={origin.x + motion.translateX * canvasWidth}
      y={origin.y + motion.translateY * canvasHeight}
      offsetX={origin.x}
      offsetY={origin.y}
      scaleX={motion.scale}
      scaleY={motion.scale}
      rotation={motion.rotation}
      opacity={motion.opacity * opacity}
      clipX={clip?.x}
      clipY={clip?.y}
      clipWidth={clip?.width}
      clipHeight={clip?.height}
    >
      {image ? (
        <Image
          name="fragment-image"
          image={localPreview ?? image}
          cropX={localPreview ? 0 : sourceRect.x * imageWidth}
          cropY={localPreview ? 0 : sourceRect.y * imageHeight}
          cropWidth={localPreview ? localPreview.width : sourceRect.width * imageWidth}
          cropHeight={localPreview ? localPreview.height : sourceRect.height * imageHeight}
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
        />
      ) : (
        <Rect
          name="fragment-source-unavailable"
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          fill="rgba(0, 0, 0, .35)"
          stroke="#e5484d"
          strokeWidth={2}
          dash={[6, 4]}
        />
      )}
    </Group>
  );

  return (
    <Group
      id={layer.id}
      name={`fragment${selected ? " selected" : ""}`}
      data-motion={layer.animation?.type ?? "none"}
      draggable={!layer.locked}
      onClick={select}
      onTap={select}
      onDragEnd={layer.locked ? undefined : finishDrag}
    >
      {layer.animation?.type === "glitch" ? (
        <>
          <Group x={-4} listening={false}>{geometry}</Group>
          <Group x={4} listening={false}>{geometry}</Group>
        </>
      ) : null}
      {geometry}
      {selected ? (
        <>
          <Rect
            name="fragment-selection-bounds"
            x={bounds.x - 6}
            y={bounds.y - 6}
            width={Math.max(12, bounds.width + 12)}
            height={Math.max(12, bounds.height + 12)}
            stroke="#ff6b6b"
            strokeWidth={1}
            dash={[5, 4]}
            listening={false}
          />
          {!layer.locked ? RESIZE_HANDLES.map((handle) => {
            const position = handlePosition(bounds, handle);
            return (
              <Circle
                key={handle}
                name={`fragment-resize-handle-${handle}`}
                x={position.x}
                y={position.y}
                radius={7}
                fill="#ff6b6b"
                stroke="#fff7ed"
                strokeWidth={1}
                draggable
                onDragStart={(event) => { event.cancelBubble = true; }}
                onDragEnd={(event) => finishResize(handle, event)}
              />
            );
          }) : null}
        </>
      ) : null}
    </Group>
  );
}
