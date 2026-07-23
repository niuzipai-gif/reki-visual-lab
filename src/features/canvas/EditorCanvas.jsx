import React, { useEffect, useMemo, useRef } from "react";
import { Image, Layer, Stage } from "react-konva";
import { normalizePoint } from "../../domain/geometry.js";
import { createAnnotation } from "../../domain/project.js";
import { TOOL_DEFINITIONS } from "../tools/toolDefinitions.js";
import { AnnotationNode } from "./AnnotationNode.jsx";

const TOOL_BY_ID = new Map(
  TOOL_DEFINITIONS.map((definition) => [definition.id, definition]),
);
const TOUCH_JITTER_RADIUS_PX = 12;
const TOUCH_DOUBLE_TAP_WINDOW_MS = 500;

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function offsetPoint(point, x, y) {
  return {
    x: clamp(point.x + x),
    y: clamp(point.y + y),
  };
}

function placePattern(point, offsets) {
  const xValues = offsets.map(({ x }) => x);
  const yValues = offsets.map(({ y }) => y);
  const origin = {
    x: Math.max(
      -Math.min(...xValues),
      Math.min(1 - Math.max(...xValues), point.x),
    ),
    y: Math.max(
      -Math.min(...yValues),
      Math.min(1 - Math.max(...yValues), point.y),
    ),
  };

  return offsets.map((offset) => offsetPoint(origin, offset.x, offset.y));
}

function immediatePoints(type, point) {
  switch (type) {
    case "box":
      return placePattern(point, [
        { x: 0, y: 0 },
        { x: 0.16, y: 0.12 },
      ]);
    case "stackBox":
      return placePattern(point, [
        { x: 0, y: 0 },
        { x: 0.18, y: 0.14 },
      ]);
    case "nodeCloud":
      return placePattern(point, [
        { x: 0, y: 0 },
        { x: 0.08, y: -0.05 },
        { x: 0.13, y: 0.04 },
        { x: 0.06, y: 0.11 },
        { x: -0.05, y: 0.07 },
      ]);
    case "randomNodes":
      return placePattern(point, [
        { x: 0, y: 0 },
        { x: 0.11, y: -0.03 },
        { x: -0.06, y: 0.08 },
        { x: 0.04, y: 0.13 },
        { x: 0.15, y: 0.09 },
      ]);
    case "orbit":
      return placePattern(point, [
        { x: 0, y: 0 },
        { x: 0.12, y: 0 },
      ]);
    case "label":
      return [point];
    default:
      return null;
  }
}

function samePoint(first, second) {
  return first?.x === second?.x && first?.y === second?.y;
}

function appendUniquePoint(points, point) {
  return samePoint(points.at(-1), point) ? points : [...points, point];
}

function touchTapTime(event) {
  return Number.isFinite(event.evt?.timeStamp)
    ? event.evt.timeStamp
    : Date.now();
}

function isJitteredDoubleTap(previous, current, canvasSize) {
  if (!previous) return false;
  const elapsed = Math.abs(current.time - previous.time);
  const xDistance = (current.point.x - previous.point.x) * canvasSize.width;
  const yDistance = (current.point.y - previous.point.y) * canvasSize.height;

  return (
    elapsed <= TOUCH_DOUBLE_TAP_WINDOW_MS &&
    Math.hypot(xDistance, yDistance) <= TOUCH_JITTER_RADIUS_PX
  );
}

function pointFromEvent(event, canvasSize) {
  const stage = event.target.getStage();
  const point = stage?.getPointerPosition();
  if (!point) return null;

  const normalized = normalizePoint(point, canvasSize);
  return { x: clamp(normalized.x), y: clamp(normalized.y) };
}

function imageElement(image) {
  return image?.element ?? image?.bitmap ?? image?.image ?? image;
}

export function EditorCanvas({
  project,
  selectedLayerId,
  activeTool = "select",
  onSelectLayer,
  onCreateLayer,
  onChangeLayer,
}) {
  const draftPoints = useRef([]);
  const recentTouchTap = useRef(null);
  const canvasSize = project.canvas;
  const tool = TOOL_BY_ID.get(activeTool) ?? TOOL_BY_ID.get("select");
  const visibleLayers = useMemo(
    () => project.layers.filter((layer) => layer.visible),
    [project.layers],
  );

  useEffect(() => {
    draftPoints.current = [];
    recentTouchTap.current = null;
  }, [activeTool]);

  function create(type, points) {
    const annotation = createAnnotation(type, points);
    onCreateLayer?.(annotation);
    return annotation;
  }

  function handleCreate(event, inputType) {
    if (!tool.objectType) {
      if (tool.id === "select") onSelectLayer?.(null);
      return;
    }

    const point = pointFromEvent(event, canvasSize);
    if (!point) return;

    if (tool.objectType === "leader" || tool.objectType === "path") {
      if (tool.objectType === "path" && event.evt?.detail > 1) return;
      if (tool.objectType === "path" && inputType === "touch") {
        const currentTap = {
          point,
          time: touchTapTime(event),
        };
        const duplicate = isJitteredDoubleTap(
          recentTouchTap.current,
          currentTap,
          canvasSize,
        );
        recentTouchTap.current = currentTap;
        if (duplicate) return;
      }

      const next = appendUniquePoint(draftPoints.current, point);
      draftPoints.current = next;
      if (tool.objectType === "leader" && next.length >= 2) {
        draftPoints.current = [];
        create(tool.objectType, next);
      }
      return;
    }

    const points = immediatePoints(tool.objectType, point);
    if (points) create(tool.objectType, points);
  }

  function completePath() {
    if (tool.objectType !== "path" || draftPoints.current.length < 2) return;
    const points = draftPoints.current;
    draftPoints.current = [];
    create(tool.objectType, points);
  }

  return (
    <div
      data-testid="editor-canvas"
      role="application"
      aria-label="标注画布"
      tabIndex={0}
    >
      <Stage
        width={canvasSize.width}
        height={canvasSize.height}
        onClick={(event) => handleCreate(event, "mouse")}
        onTap={(event) => handleCreate(event, "touch")}
        onDblClick={completePath}
        onDblTap={completePath}
      >
        <Layer>
          {project.canvas.backgroundVisible && project.image ? (
            <Image
              name="background-image"
              image={imageElement(project.image)}
              width={canvasSize.width}
              height={canvasSize.height}
              listening={false}
            />
          ) : null}
          {visibleLayers.map((layer) => (
            <AnnotationNode
              key={layer.id}
              layer={layer}
              canvasSize={canvasSize}
              selected={layer.id === selectedLayerId}
              onSelect={() => onSelectLayer?.(layer.id)}
              onChange={(patch) => onChangeLayer?.(layer.id, patch)}
            />
          ))}
        </Layer>
      </Stage>
    </div>
  );
}
