import React, { StrictMode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createAnnotation, createProject } from "../../domain/project.js";
import { AnnotationNode } from "./AnnotationNode.jsx";
import { EditorCanvas } from "./EditorCanvas.jsx";

const konvaState = vi.hoisted(() => ({
  pointer: { x: 270, y: 675 },
  drag: { x: 0, y: 0 },
}));

vi.mock("react-konva", () => {
  function stageEvent(domEvent) {
    const stage = {
      getPointerPosition: () => ({ ...konvaState.pointer }),
    };
    return {
      evt: domEvent,
      target: {
        getStage: () => stage,
      },
    };
  }

  function Stage({
    children,
    width,
    height,
    onClick,
    onTap,
    onDblClick,
    onDblTap,
    ...props
  }) {
    return (
      <div
        {...props}
        data-konva="Stage"
        data-width={width}
        data-height={height}
        onClick={(event) => onClick?.(stageEvent(event))}
        onDoubleClick={(event) => onDblClick?.(stageEvent(event))}
        onTouchEnd={(event) => onTap?.(stageEvent(event))}
        onContextMenu={(event) => onDblTap?.(stageEvent(event))}
      >
        {children}
      </div>
    );
  }

  function Layer({ children }) {
    return <div data-konva="Layer">{children}</div>;
  }

  function Group({
    children,
    id,
    draggable,
    onClick,
    onTap,
    onDragEnd,
  }) {
    return (
      <div
        data-konva="Group"
        data-layer-id={id}
        data-draggable={String(Boolean(draggable))}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.({ evt: event });
        }}
        onTouchEnd={(event) => {
          event.stopPropagation();
          onTap?.({ evt: event });
        }}
        onDragEnd={() =>
          onDragEnd?.({
            target: {
              x: () => konvaState.drag.x,
              y: () => konvaState.drag.y,
              position: vi.fn(),
            },
          })
        }
      >
        {children}
      </div>
    );
  }

  function Image({ name }) {
    return <span data-konva="Image" data-testid={name} />;
  }

  function Line({ name, tension, points, hitStrokeWidth, strokeWidth }) {
    return (
      <span
        data-konva="Line"
        data-name={name}
        data-points={JSON.stringify(points)}
        data-tension={tension}
        data-hit-stroke-width={hitStrokeWidth}
        data-stroke-width={strokeWidth}
      />
    );
  }

  function Rect({
    name,
    x,
    y,
    width,
    height,
    fill,
    hitStrokeWidth,
    listening,
  }) {
    return (
      <span
        data-konva="Rect"
        data-name={name}
        data-x={x}
        data-y={y}
        data-width={width}
        data-height={height}
        data-fill={fill}
        data-hit-stroke-width={hitStrokeWidth}
        data-listening={String(listening)}
      />
    );
  }

  function Circle({ name, hitStrokeWidth, fill, radius }) {
    return (
      <span
        data-konva="Circle"
        data-name={name}
        data-hit-stroke-width={hitStrokeWidth}
        data-fill={fill}
        data-radius={radius}
      />
    );
  }

  function Text({ text }) {
    return <span data-konva="Text">{text}</span>;
  }

  return { Circle, Group, Image, Layer, Line, Rect, Stage, Text };
});

const style = {
  lineColor: "#efbe3b",
  textColor: "#fff2c4",
  anchorColor: "#efbe3b",
  lineWidth: 2,
  fontSize: 14,
  anchorSize: 5,
  dash: [],
  opacity: 1,
  curveTension: 0.45,
};

function layer(type, id, points, overrides = {}) {
  return {
    ...createAnnotation(type, points, { id, style }),
    ...overrides,
  };
}

function projectWith(overrides = {}) {
  return {
    ...createProject({ width: 1080, height: 1350 }),
    image: { element: { source: "portrait" } },
    ...overrides,
  };
}

function editorStage() {
  const canvas = screen.getByTestId("editor-canvas");
  return canvas.matches('[data-konva="Stage"]')
    ? canvas
    : canvas.querySelector('[data-konva="Stage"]');
}

beforeEach(() => {
  konvaState.pointer = { x: 270, y: 675 };
  konvaState.drag = { x: 0, y: 0 };
});

describe("AnnotationNode", () => {
  test.each([
    ["box", "Rect"],
    ["stackBox", "Rect"],
    ["path", "Line"],
    ["leader", "Line"],
    ["nodeCloud", "Circle"],
    ["randomNodes", "Circle"],
    ["orbit", "Circle"],
    ["label", "Text"],
  ])("renders a focused %s annotation group", (type, primitive) => {
    const points = [
      { x: 0.2, y: 0.3 },
      { x: 0.6, y: 0.7 },
      { x: 0.8, y: 0.4 },
    ];

    const { container } = render(
      <AnnotationNode
        layer={layer(type, type, points)}
        canvasSize={{ width: 1080, height: 1350 }}
        selected={false}
        onSelect={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    expect(container.querySelector(`[data-layer-id="${type}"]`)).toBeTruthy();
    expect(container.querySelector(`[data-konva="${primitive}"]`)).toBeTruthy();
  });

  test("uses curve tension, exposes selection, and writes normalized drag changes", () => {
    const onChange = vi.fn();
    const annotation = layer("path", "route", [
      { x: 0.25, y: 0.5 },
      { x: 0.5, y: 0.75 },
    ]);
    konvaState.drag = { x: 108, y: -135 };

    const { container } = render(
      <AnnotationNode
        layer={annotation}
        canvasSize={{ width: 1080, height: 1350 }}
        selected
        onSelect={vi.fn()}
        onChange={onChange}
      />,
    );

    expect(container.querySelector('[data-tension="0.45"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-konva="Circle"]').length).toBeGreaterThan(0);
    fireEvent.dragEnd(container.querySelector('[data-layer-id="route"]'));

    expect(onChange).toHaveBeenCalledWith({
      points: [
        { x: 0.35, y: 0.4 },
        { x: 0.6, y: 0.65 },
      ],
    });
  });

  test("adds real hit regions without widening visible strokes", () => {
    const { container, rerender } = render(
      <AnnotationNode
        layer={layer("path", "path-hit", [
          { x: 0.2, y: 0.3 },
          { x: 0.6, y: 0.7 },
        ])}
        canvasSize={{ width: 1080, height: 1350 }}
        selected={false}
        onSelect={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    const path = container.querySelector('[data-konva="Line"]');
    expect(path).toHaveAttribute("data-hit-stroke-width", "28");
    expect(path).toHaveAttribute("data-stroke-width", "2");

    rerender(
      <AnnotationNode
        layer={layer("box", "box-hit", [
          { x: 0.2, y: 0.3 },
          { x: 0.6, y: 0.7 },
        ])}
        canvasSize={{ width: 1080, height: 1350 }}
        selected={false}
        onSelect={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    const box = container.querySelector('[data-name="box-hit-area"]');
    expect(box).toHaveAttribute("data-fill", "rgba(0,0,0,0.001)");
    expect(box).toHaveAttribute("data-hit-stroke-width", "28");

    rerender(
      <AnnotationNode
        layer={layer("orbit", "orbit-hit", [
          { x: 0.5, y: 0.5 },
          { x: 0.7, y: 0.5 },
        ])}
        canvasSize={{ width: 1080, height: 1350 }}
        selected={false}
        onSelect={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    expect(
      container.querySelector('[data-name="orbit-hit-area"]'),
    ).toHaveAttribute("data-hit-stroke-width", "28");
  });

  test.each(["nodeCloud", "randomNodes"])(
    "uses per-node hit circles instead of a covering bounds hit shape for %s",
    (type) => {
      const points = [
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.8 },
        { x: 0.9, y: 0.2 },
      ];
      const { container } = render(
        <AnnotationNode
          layer={layer(type, `${type}-hits`, points)}
          canvasSize={{ width: 1080, height: 1350 }}
          selected={false}
          onSelect={vi.fn()}
          onChange={vi.fn()}
        />,
      );
      const hitTargets = container.querySelectorAll(
        '[data-name="node-hit-target"]',
      );

      expect(
        container.querySelector('[data-name="annotation-hit-area"]'),
      ).toBeNull();
      expect(hitTargets).toHaveLength(points.length);
      for (const target of hitTargets) {
        expect(target).toHaveAttribute("data-fill", "rgba(0,0,0,0.001)");
        expect(Number(target.getAttribute("data-radius"))).toBeGreaterThanOrEqual(
          12,
        );
      }
      if (type === "nodeCloud") {
        expect(
          container.querySelector('[data-konva="Line"]'),
        ).toHaveAttribute("data-hit-stroke-width", "28");
      }
    },
  );

  test("clamps drag deltas so every annotation point remains recoverable", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <AnnotationNode
        layer={layer("box", "right-edge", [
          { x: 0.8, y: 0.7 },
          { x: 0.95, y: 0.9 },
        ])}
        canvasSize={{ width: 1080, height: 1350 }}
        selected={false}
        onSelect={vi.fn()}
        onChange={onChange}
      />,
    );

    konvaState.drag = { x: 540, y: 405 };
    fireEvent.dragEnd(container.querySelector('[data-layer-id="right-edge"]'));
    const rightPatch = onChange.mock.calls[0][0];

    expect(rightPatch.points[0].x).toBeCloseTo(0.85);
    expect(rightPatch.points[1].x).toBeCloseTo(1);
    expect(rightPatch.points[0].y).toBeCloseTo(0.8);
    expect(rightPatch.points[1].y).toBeCloseTo(1);
    expect(rightPatch.points[1].x - rightPatch.points[0].x).toBeCloseTo(0.15);
    expect(rightPatch.points[1].y - rightPatch.points[0].y).toBeCloseTo(0.2);

    onChange.mockClear();
    rerender(
      <AnnotationNode
        layer={layer("box", "left-edge", [
          { x: 0.1, y: 0.2 },
          { x: 0.3, y: 0.4 },
        ])}
        canvasSize={{ width: 1080, height: 1350 }}
        selected={false}
        onSelect={vi.fn()}
        onChange={onChange}
      />,
    );
    konvaState.drag = { x: -540, y: -675 };
    fireEvent.dragEnd(container.querySelector('[data-layer-id="left-edge"]'));
    const leftPatch = onChange.mock.calls[0][0];

    expect(leftPatch.points[0]).toEqual({ x: 0, y: 0 });
    expect(leftPatch.points[1].x).toBeCloseTo(0.2);
    expect(leftPatch.points[1].y).toBeCloseTo(0.2);
  });

  test("selection bounds include the visual offsets of stacked boxes", () => {
    const { container } = render(
      <AnnotationNode
        layer={layer("stackBox", "stack", [
          { x: 0.2, y: 0.3 },
          { x: 0.6, y: 0.7 },
        ])}
        canvasSize={{ width: 1080, height: 1350 }}
        selected
        onSelect={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    const selection = container.querySelector(
      '[data-name="selection-bounds"]',
    );

    expect(selection).toHaveAttribute("data-x", "210");
    expect(selection).toHaveAttribute("data-y", "387");
    expect(selection).toHaveAttribute("data-width", "456");
    expect(Number(selection.getAttribute("data-height"))).toBeCloseTo(564);
  });

  test("selects locked layers without allowing them to drag", () => {
    const onSelect = vi.fn();
    const onChange = vi.fn();
    const annotation = layer(
      "box",
      "locked-box",
      [{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.7 }],
      { locked: true },
    );

    const { container } = render(
      <AnnotationNode
        layer={annotation}
        canvasSize={{ width: 1080, height: 1350 }}
        selected={false}
        onSelect={onSelect}
        onChange={onChange}
      />,
    );
    const node = container.querySelector('[data-layer-id="locked-box"]');

    expect(node).toHaveAttribute("data-draggable", "false");
    fireEvent.click(node);
    fireEvent.dragEnd(node);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("EditorCanvas", () => {
  test("provides an accessible focus target around the Konva stage", () => {
    render(
      <EditorCanvas
        project={projectWith()}
        activeTool="select"
        selectedLayerId={null}
        onSelectLayer={vi.fn()}
        onCreateLayer={vi.fn()}
        onChangeLayer={vi.fn()}
      />,
    );

    expect(screen.getByTestId("editor-canvas")).toHaveAttribute(
      "aria-label",
      "标注画布",
    );
    expect(screen.getByTestId("editor-canvas")).toHaveAttribute(
      "role",
      "application",
    );
    expect(screen.getByTestId("editor-canvas")).toHaveAttribute("tabindex", "0");
  });

  test("renders background only when enabled and filters visible layers in order", () => {
    const layers = [
      layer("box", "back", [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }]),
      layer(
        "label",
        "hidden",
        [{ x: 0.4, y: 0.4 }],
        { visible: false },
      ),
      layer("orbit", "front", [{ x: 0.5, y: 0.5 }, { x: 0.7, y: 0.5 }]),
    ];
    const { container, rerender } = render(
      <EditorCanvas
        project={projectWith({ layers })}
        activeTool="select"
        selectedLayerId={null}
        onSelectLayer={vi.fn()}
        onCreateLayer={vi.fn()}
        onChangeLayer={vi.fn()}
      />,
    );

    expect(screen.getByTestId("background-image")).toBeInTheDocument();
    expect(
      [...container.querySelectorAll("[data-layer-id]")].map(
        (node) => node.dataset.layerId,
      ),
    ).toEqual(["back", "front"]);

    rerender(
      <EditorCanvas
        project={projectWith({
          layers,
          canvas: {
            width: 1080,
            height: 1350,
            backgroundVisible: false,
          },
        })}
        activeTool="select"
        selectedLayerId={null}
        onSelectLayer={vi.fn()}
        onCreateLayer={vi.fn()}
        onChangeLayer={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("background-image")).not.toBeInTheDocument();
  });

  test("routes annotation interactions to layer selection and changes", () => {
    const onSelectLayer = vi.fn();
    const onChangeLayer = vi.fn();
    const annotation = layer("label", "caption", [{ x: 0.25, y: 0.5 }]);
    const { container } = render(
      <EditorCanvas
        project={projectWith({ layers: [annotation] })}
        activeTool="select"
        selectedLayerId="caption"
        onSelectLayer={onSelectLayer}
        onCreateLayer={vi.fn()}
        onChangeLayer={onChangeLayer}
      />,
    );

    fireEvent.click(container.querySelector('[data-layer-id="caption"]'));
    expect(onSelectLayer).toHaveBeenCalledWith("caption");
  });

  test("lets empty space between node targets bubble to the canvas", () => {
    const onSelectLayer = vi.fn();
    render(
      <EditorCanvas
        project={projectWith({
          layers: [
            layer("randomNodes", "sparse-nodes", [
              { x: 0.1, y: 0.1 },
              { x: 0.9, y: 0.9 },
            ]),
          ],
        })}
        activeTool="select"
        selectedLayerId="sparse-nodes"
        onSelectLayer={onSelectLayer}
        onCreateLayer={vi.fn()}
        onChangeLayer={vi.fn()}
      />,
    );

    konvaState.pointer = { x: 540, y: 675 };
    fireEvent.click(editorStage());

    expect(onSelectLayer).toHaveBeenCalledTimes(1);
    expect(onSelectLayer).toHaveBeenCalledWith(null);
  });

  test.each([
    ["point-box", "box"],
    ["stack-box", "stackBox"],
    ["global-nodes", "nodeCloud"],
    ["random-nodes", "randomNodes"],
    ["orbit", "orbit"],
    ["label", "label"],
  ])("maps %s clicks to %s annotations", (activeTool, objectType) => {
    const onCreateLayer = vi.fn();
    render(
      <EditorCanvas
        project={projectWith()}
        activeTool={activeTool}
        selectedLayerId={null}
        onSelectLayer={vi.fn()}
        onCreateLayer={onCreateLayer}
        onChangeLayer={vi.fn()}
      />,
    );

    fireEvent.click(editorStage());

    expect(onCreateLayer).toHaveBeenCalledTimes(1);
    expect(onCreateLayer.mock.calls[0][0]).toMatchObject({
      type: objectType,
      points: expect.arrayContaining([{ x: 0.25, y: 0.5 }]),
    });
  });

  test("finishes leaders once under StrictMode without updater side effects", () => {
    const onCreateLeader = vi.fn();
    render(
      <StrictMode>
        <EditorCanvas
          project={projectWith()}
          activeTool="leader"
          selectedLayerId={null}
          onSelectLayer={vi.fn()}
          onCreateLayer={onCreateLeader}
          onChangeLayer={vi.fn()}
        />
      </StrictMode>,
    );
    const stage = editorStage();

    fireEvent.touchEnd(stage);
    konvaState.pointer = { x: 810, y: 675 };
    fireEvent.touchEnd(stage);

    expect(onCreateLeader).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "leader",
        points: [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }],
      }),
    );
    expect(onCreateLeader).toHaveBeenCalledTimes(1);
  });

  test("keeps arbitrary path anchors until explicit valid completion", () => {
    const onCreatePath = vi.fn();
    render(
      <EditorCanvas
        project={projectWith()}
        activeTool="node-path"
        selectedLayerId={null}
        onSelectLayer={vi.fn()}
        onCreateLayer={onCreatePath}
        onChangeLayer={vi.fn()}
      />,
    );
    const stage = editorStage();

    fireEvent.doubleClick(stage);
    expect(onCreatePath).not.toHaveBeenCalled();

    konvaState.pointer = { x: 108, y: 135 };
    fireEvent.click(stage);
    fireEvent.doubleClick(stage);
    expect(onCreatePath).not.toHaveBeenCalled();

    konvaState.pointer = { x: 324, y: 675 };
    fireEvent.click(stage);
    konvaState.pointer = { x: 540, y: 1080 };
    fireEvent.click(stage);
    konvaState.pointer = { x: 972, y: 135 };
    fireEvent.click(stage);
    expect(onCreatePath).not.toHaveBeenCalled();

    fireEvent.doubleClick(stage);
    expect(onCreatePath).toHaveBeenCalledTimes(1);
    expect(onCreatePath).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "path",
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.3, y: 0.5 },
          { x: 0.5, y: 0.8 },
          { x: 0.9, y: 0.1 },
        ],
      }),
    );
  });

  test("deduplicates a double-click terminal anchor and creates once in StrictMode", () => {
    const onCreatePath = vi.fn();
    render(
      <StrictMode>
        <EditorCanvas
          project={projectWith()}
          activeTool="node-path"
          selectedLayerId={null}
          onSelectLayer={vi.fn()}
          onCreateLayer={onCreatePath}
          onChangeLayer={vi.fn()}
        />
      </StrictMode>,
    );
    const stage = editorStage();

    konvaState.pointer = { x: 108, y: 135 };
    fireEvent.click(stage, { detail: 1 });
    konvaState.pointer = { x: 540, y: 1080 };
    fireEvent.click(stage, { detail: 1 });
    konvaState.pointer = { x: 972, y: 135 };
    fireEvent.click(stage, { detail: 1 });
    fireEvent.click(stage, { detail: 2 });
    fireEvent.doubleClick(stage);

    expect(onCreatePath).toHaveBeenCalledTimes(1);
    expect(onCreatePath.mock.calls[0][0].points).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.8 },
      { x: 0.9, y: 0.1 },
    ]);
  });

  test("deduplicates jittered double-tap completion with zero or one existing anchor", () => {
    const onCreatePath = vi.fn();
    render(
      <EditorCanvas
        project={projectWith()}
        activeTool="node-path"
        selectedLayerId={null}
        onSelectLayer={vi.fn()}
        onCreateLayer={onCreatePath}
        onChangeLayer={vi.fn()}
      />,
    );
    const stage = editorStage();

    fireEvent.touchEnd(stage);
    fireEvent.contextMenu(stage);
    expect(onCreatePath).not.toHaveBeenCalled();

    konvaState.pointer = { x: 810, y: 675 };
    fireEvent.touchEnd(stage);
    konvaState.pointer = { x: 814, y: 680 };
    fireEvent.touchEnd(stage);
    fireEvent.contextMenu(stage);

    expect(onCreatePath).toHaveBeenCalledTimes(1);
    expect(onCreatePath).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "path",
        points: [
          { x: 0.25, y: 0.5 },
          { x: 0.75, y: 0.5 },
        ],
      }),
    );
  });

  test("deduplicates a jittered double-tap after multiple existing anchors", () => {
    const onCreatePath = vi.fn();
    render(
      <EditorCanvas
        project={projectWith()}
        activeTool="node-path"
        selectedLayerId={null}
        onSelectLayer={vi.fn()}
        onCreateLayer={onCreatePath}
        onChangeLayer={vi.fn()}
      />,
    );
    const stage = editorStage();

    konvaState.pointer = { x: 108, y: 135 };
    fireEvent.touchEnd(stage);
    konvaState.pointer = { x: 540, y: 1080 };
    fireEvent.touchEnd(stage);
    konvaState.pointer = { x: 972, y: 135 };
    fireEvent.touchEnd(stage);
    konvaState.pointer = { x: 978, y: 140 };
    fireEvent.touchEnd(stage);
    fireEvent.contextMenu(stage);

    expect(onCreatePath).toHaveBeenCalledTimes(1);
    expect(onCreatePath.mock.calls[0][0].points).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.8 },
      { x: 0.9, y: 0.1 },
    ]);
  });

  test("suppresses a jittered second tap that arrives after double-tap completion", () => {
    const onCreatePath = vi.fn();
    render(
      <EditorCanvas
        project={projectWith()}
        activeTool="node-path"
        selectedLayerId={null}
        onSelectLayer={vi.fn()}
        onCreateLayer={onCreatePath}
        onChangeLayer={vi.fn()}
      />,
    );
    const stage = editorStage();

    konvaState.pointer = { x: 108, y: 135 };
    fireEvent.touchEnd(stage);
    konvaState.pointer = { x: 810, y: 675 };
    fireEvent.touchEnd(stage);
    fireEvent.contextMenu(stage);
    expect(onCreatePath).toHaveBeenCalledTimes(1);

    konvaState.pointer = { x: 815, y: 680 };
    fireEvent.touchEnd(stage);
    konvaState.pointer = { x: 540, y: 1080 };
    fireEvent.touchEnd(stage);
    fireEvent.contextMenu(stage);

    expect(onCreatePath).toHaveBeenCalledTimes(1);
  });

  test("shifts default shapes inward near edges instead of collapsing them", () => {
    const onCreateLayer = vi.fn();
    const { rerender } = render(
      <EditorCanvas
        project={projectWith()}
        activeTool="point-box"
        selectedLayerId={null}
        onSelectLayer={vi.fn()}
        onCreateLayer={onCreateLayer}
        onChangeLayer={vi.fn()}
      />,
    );
    const stage = editorStage();
    konvaState.pointer = { x: 1070, y: 1340 };
    fireEvent.click(stage);

    const boxPoints = onCreateLayer.mock.calls[0][0].points;
    expect(boxPoints[1].x - boxPoints[0].x).toBeCloseTo(0.16);
    expect(boxPoints[1].y - boxPoints[0].y).toBeCloseTo(0.12);
    expect(Math.max(...boxPoints.map((point) => point.x))).toBe(1);
    expect(Math.max(...boxPoints.map((point) => point.y))).toBe(1);

    onCreateLayer.mockClear();
    rerender(
      <EditorCanvas
        project={projectWith()}
        activeTool="orbit"
        selectedLayerId={null}
        onSelectLayer={vi.fn()}
        onCreateLayer={onCreateLayer}
        onChangeLayer={vi.fn()}
      />,
    );
    fireEvent.click(stage);

    const orbitPoints = onCreateLayer.mock.calls[0][0].points;
    expect(orbitPoints[1].x - orbitPoints[0].x).toBeCloseTo(0.12);
    expect(orbitPoints[1].x).toBe(1);
  });
});
