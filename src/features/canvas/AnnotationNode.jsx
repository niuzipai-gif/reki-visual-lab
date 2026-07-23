import React from "react";
import { Circle, Group, Line, Rect, Text } from "react-konva";
import { denormalizePoint, normalizePoint } from "../../domain/geometry.js";
import {
  resizeBoundsFromHandle,
  resizeNormalizedPoints,
} from "../../domain/transform.js";

const HIT_STROKE_WIDTH = 28;
const TRANSPARENT_HIT_FILL = "rgba(0,0,0,0.001)";
const STACK_OFFSET = 12;
const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function flattenPoints(points) {
  return points.flatMap(({ x, y }) => [x, y]);
}

function pointBounds(points) {
  if (!points.length) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const x = Math.min(...xValues);
  const y = Math.min(...yValues);

  return {
    x,
    y,
    width: Math.max(1, Math.max(...xValues) - x),
    height: Math.max(1, Math.max(...yValues) - y),
  };
}

// Kept as the single normalized-geometry contract shared by editor tooling and export QA.
export function annotationBounds(layer, points, style) {
  const bounds = pointBounds(points);

  if (layer.type === "stackBox") {
    return {
      x: bounds.x,
      y: bounds.y - STACK_OFFSET,
      width: bounds.width + STACK_OFFSET,
      height: bounds.height + STACK_OFFSET,
    };
  }

  if (layer.type === "orbit" && points.length) {
    const center = points[0];
    const edge = points[1] ?? {
      x: center.x + style.anchorSize * 6,
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
    return {
      x: points[0].x,
      y: points[0].y,
      width: Math.max(
        style.fontSize,
        String(layer.label ?? "").length * style.fontSize * 0.6,
      ),
      height: style.fontSize,
    };
  }

  return bounds;
}

function BoxShape({ points, style, stacked = false }) {
  if (points.length < 2) return null;
  const bounds = pointBounds(points.slice(0, 2));
  const offsets = stacked ? [STACK_OFFSET, STACK_OFFSET / 2, 0] : [0];

  return offsets.map((offset) => (
    <Rect
      key={offset}
      name="box-hit-area"
      x={bounds.x + offset}
      y={bounds.y - offset}
      width={bounds.width}
      height={bounds.height}
      fill={TRANSPARENT_HIT_FILL}
      stroke={style.lineColor}
      strokeWidth={style.lineWidth}
      hitStrokeWidth={HIT_STROKE_WIDTH}
      dash={style.dash}
      opacity={style.opacity}
    />
  ));
}

function PathShape({ points, style, closed = false }) {
  if (points.length < 2) return null;

  return (
    <Line
      points={flattenPoints(points)}
      stroke={style.lineColor}
      strokeWidth={style.lineWidth}
      dash={style.dash}
      opacity={style.opacity}
      tension={style.curveTension}
      closed={closed}
      lineCap="round"
      lineJoin="round"
      hitStrokeWidth={HIT_STROKE_WIDTH}
    />
  );
}

function Anchors({ points, style }) {
  return points.map((point, index) => (
    <Circle
      key={`${point.x}:${point.y}:${index}`}
      x={point.x}
      y={point.y}
      radius={style.anchorSize}
      fill={style.anchorColor}
      opacity={style.opacity}
      hitStrokeWidth={HIT_STROKE_WIDTH}
    />
  ));
}

function LeaderShape({ points, style }) {
  if (points.length < 2) return null;

  return (
    <>
      <PathShape points={points} style={style} />
      <Circle
        x={points[0].x}
        y={points[0].y}
        radius={style.anchorSize}
        fill={style.anchorColor}
        opacity={style.opacity}
        hitStrokeWidth={HIT_STROKE_WIDTH}
      />
    </>
  );
}

function OrbitShape({ points, style }) {
  if (!points.length) return null;
  const center = points[0];
  const edge = points[1] ?? {
    x: center.x + style.anchorSize * 6,
    y: center.y,
  };
  const radius = Math.hypot(edge.x - center.x, edge.y - center.y);

  return (
    <>
      <Circle
        name="orbit-hit-area"
        x={center.x}
        y={center.y}
        radius={radius}
        stroke={style.lineColor}
        strokeWidth={style.lineWidth}
        dash={style.dash}
        opacity={style.opacity}
        hitStrokeWidth={HIT_STROKE_WIDTH}
      />
      <Circle
        x={center.x}
        y={center.y}
        radius={radius * 0.65}
        stroke={style.lineColor}
        strokeWidth={Math.max(1, style.lineWidth / 2)}
        opacity={style.opacity * 0.65}
        hitStrokeWidth={HIT_STROKE_WIDTH}
      />
      <Anchors points={points.slice(0, 2)} style={style} />
    </>
  );
}

function LabelShape({ layer, points, style }) {
  if (!points.length) return null;
  const labelOffset = layer.labelOffset ?? { x: 0, y: 0 };
  if (layer.showLabel === false) return null;

  return (
    <Text
      x={points[0].x + labelOffset.x}
      y={points[0].y + labelOffset.y}
      text={layer.label}
      fill={style.textColor}
      fontSize={style.fontSize}
      opacity={style.opacity}
    />
  );
}

function AnnotationLabel({ layer, points, style }) {
  if (
    layer.type === "label" ||
    layer.showLabel === false ||
    !points.length
  ) {
    return null;
  }
  const labelPoint =
    layer.labelPosition === "start" ? points[0] : points.at(-1);
  const labelOffset = layer.labelOffset ?? { x: 0, y: 0 };

  return (
    <Text
      name="annotation-label"
      x={labelPoint.x + 8 + labelOffset.x}
      y={labelPoint.y - style.fontSize / 2 + labelOffset.y}
      text={layer.label}
      fill={style.textColor}
      fontSize={style.fontSize}
      opacity={style.opacity}
    />
  );
}

function AnnotationShape({ layer, points, style }) {
  switch (layer.type) {
    case "box":
      return <BoxShape points={points} style={style} />;
    case "stackBox":
      return <BoxShape points={points} style={style} stacked />;
    case "path":
      return <PathShape points={points} style={style} />;
    case "leader":
      return <LeaderShape points={points} style={style} />;
    case "nodeCloud":
      return (
        <>
          <PathShape points={points} style={style} closed />
          <Anchors points={points} style={style} />
        </>
      );
    case "randomNodes":
      return <Anchors points={points} style={style} />;
    case "orbit":
      return <OrbitShape points={points} style={style} />;
    case "label":
      return <LabelShape layer={layer} points={points} style={style} />;
    default:
      return null;
  }
}

function NodeHitTargets({ layer, points, style }) {
  if (!["nodeCloud", "randomNodes"].includes(layer.type)) {
    return null;
  }

  return points.map((point, index) => (
    <Circle
      key={`hit:${point.x}:${point.y}:${index}`}
      name="node-hit-target"
      x={point.x}
      y={point.y}
      radius={Math.max(12, style.anchorSize + 8)}
      fill={TRANSPARENT_HIT_FILL}
    />
  ));
}

function clampTranslation(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function handlePosition(bounds, handle) {
  const x = handle.includes("w")
    ? bounds.x
    : handle.includes("e")
      ? bounds.x + bounds.width
      : bounds.x + bounds.width / 2;
  const y = handle.includes("n")
    ? bounds.y
    : handle.includes("s")
      ? bounds.y + bounds.height
      : bounds.y + bounds.height / 2;
  return { x, y };
}

export function AnnotationNode({
  layer,
  canvasSize,
  selected,
  onSelect,
  onChange,
}) {
  const points = (layer.points ?? []).map((point) =>
    denormalizePoint(point, canvasSize),
  );
  const style = layer.style;
  const bounds = annotationBounds(layer, points, style);

  function select(event) {
    event.cancelBubble = true;
    onSelect?.();
  }

  function finishDrag(event) {
    const x = clampTranslation(
      event.target.x(),
      -bounds.x,
      canvasSize.width - (bounds.x + bounds.width),
    );
    const y = clampTranslation(
      event.target.y(),
      -bounds.y,
      canvasSize.height - (bounds.y + bounds.height),
    );
    const offset = normalizePoint(
      { x, y },
      canvasSize,
    );
    event.target.position({ x: 0, y: 0 });
    onChange?.({
      points: (layer.points ?? []).map((point) => ({
        x: point.x + offset.x,
        y: point.y + offset.y,
      })),
    });
  }

  function finishResize(handle, event) {
    event.cancelBubble = true;
    const normalizedBounds = {
      x: bounds.x / canvasSize.width,
      y: bounds.y / canvasSize.height,
      width: bounds.width / canvasSize.width,
      height: bounds.height / canvasSize.height,
    };
    const pointer = {
      x: event.target.x() / canvasSize.width,
      y: event.target.y() / canvasSize.height,
    };
    const nextBounds = resizeBoundsFromHandle(
      normalizedBounds,
      handle,
      pointer,
    );
    const nextPoints = resizeNormalizedPoints(
      layer.points ?? [],
      normalizedBounds,
      nextBounds,
    );
    const patch = { points: nextPoints };
    if (layer.type === "label") {
      patch.style = {
        ...style,
        fontSize: Math.max(
          6,
          Math.round(style.fontSize * (nextBounds.height / normalizedBounds.height)),
        ),
      };
    }
    const position = handlePosition(bounds, handle);
    event.target.position(position);
    onChange?.(patch);
  }

  return (
    <Group
      id={layer.id}
      name={`annotation${selected ? " selected" : ""}`}
      draggable={!layer.locked}
      onClick={select}
      onTap={select}
      onDragEnd={layer.locked ? undefined : finishDrag}
    >
      <NodeHitTargets layer={layer} points={points} style={style} />
      <AnnotationShape layer={layer} points={points} style={style} />
      <AnnotationLabel layer={layer} points={points} style={style} />
      {selected ? (
        <>
          <Rect
            name="selection-bounds"
            x={bounds.x - 6}
            y={bounds.y - 6}
            width={Math.max(12, bounds.width + 12)}
            height={Math.max(12, bounds.height + 12)}
            stroke={style.anchorColor}
            strokeWidth={1}
            dash={[5, 4]}
            listening={false}
          />
          <Anchors points={points} style={style} />
          {!layer.locked
            ? RESIZE_HANDLES.map((handle) => {
                const position = handlePosition(bounds, handle);
                return (
                  <Circle
                    key={`resize:${handle}`}
                    name={`resize-handle-${handle}`}
                    x={position.x}
                    y={position.y}
                    radius={7}
                    fill={style.anchorColor}
                    stroke={style.textColor}
                    strokeWidth={1}
                    draggable
                    onDragStart={(event) => {
                      event.cancelBubble = true;
                    }}
                    onDragEnd={(event) => finishResize(handle, event)}
                  />
                );
              })
            : null}
        </>
      ) : null}
    </Group>
  );
}
