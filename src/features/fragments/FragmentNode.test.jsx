import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { FragmentNode } from "./FragmentNode.jsx";

const konva = vi.hoisted(() => ({ drag: { x: 0, y: 0 } }));

vi.mock("react-konva", () => ({
  Group: ({ children, id, name, opacity, draggable, onDragEnd, ...props }) => (
    <div
      {...props}
      data-layer-id={id}
      data-name={name}
      data-opacity={opacity}
      data-draggable={String(Boolean(draggable))}
      onDragEnd={() => onDragEnd?.({
        target: {
          x: () => konva.drag.x,
          y: () => konva.drag.y,
          position: vi.fn(),
        },
      })}
    >
      {children}
    </div>
  ),
  Image: ({ name, image, cropX, cropY, cropWidth, cropHeight, x, y, width, height }) => (
    <span
      data-name={name}
      data-preview-source={image?.constructor?.name === "PreviewCanvas" ? "local-effects" : "original"}
      data-crop-x={cropX}
      data-crop-y={cropY}
      data-crop-width={cropWidth}
      data-crop-height={cropHeight}
      data-x={x}
      data-y={y}
      data-width={width}
      data-height={height}
    />
  ),
  Rect: ({ name, x, y, width, height }) => (
    <span data-name={name} data-x={x} data-y={y} data-width={width} data-height={height} />
  ),
  Circle: ({ name, onDragEnd }) => (
    <span
      data-name={name}
      onDragEnd={(event) => {
        event.stopPropagation();
        onDragEnd?.({
          cancelBubble: false,
          target: {
            x: () => konva.drag.x,
            y: () => konva.drag.y,
            position: vi.fn(),
          },
        });
      }}
    />
  ),
}));

const fragment = {
  id: "fragment-01",
  type: "extractedFragment",
  sourceRect: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
  transform: { x: 0.45, y: 0.5, width: 0.3, height: 0.2 },
  locked: false,
  animation: { type: "none" },
};

describe("FragmentNode", () => {
  test("renders the referenced original rectangle at an independently transformed position", () => {
    const { container } = render(
      <FragmentNode
        layer={fragment}
        image={{ width: 1000, height: 800 }}
        canvasSize={{ width: 1000, height: 1000 }}
        selected={false}
      />,
    );

    const pixels = container.querySelector('[data-name="fragment-image"]');
    expect(pixels).toHaveAttribute("data-crop-x", "100");
    expect(pixels).toHaveAttribute("data-crop-y", "160");
    expect(pixels).toHaveAttribute("data-x", "450");
    expect(pixels).toHaveAttribute("data-y", "500");
  });

  test("multiplies fragment opacity into its local motion geometry", () => {
    const { container } = render(
      <FragmentNode
        layer={{ ...fragment, opacity: 0.35 }}
        image={{ width: 1000, height: 800 }}
        canvasSize={{ width: 1000, height: 1000 }}
      />,
    );

    expect(container.querySelector('[data-name="fragment-motion-geometry"]'))
      .toHaveAttribute("data-opacity", "0.35");
  });

  test("renders selected local effects from a cached cropped preview instead of changing the base image", () => {
    class PreviewCanvas {
      constructor(width, height) {
        this.width = width;
        this.height = height;
        this.context = {
          clearRect: vi.fn(), drawImage: vi.fn(),
          getImageData: () => new ImageData(new Uint8ClampedArray([100, 0, 0, 255]), 1, 1),
          putImageData: vi.fn(),
        };
      }
      getContext() { return this.context; }
    }
    vi.stubGlobal("OffscreenCanvas", PreviewCanvas);
    const { container } = render(
      <FragmentNode
        layer={{
          ...fragment,
          effects: [{
            id: "brightness", type: "brightness", name: "亮度", visible: true,
            opacity: 1, settings: { amount: 1.2 },
          }],
        }}
        image={{ width: 1000, height: 800 }}
        canvasSize={{ width: 1000, height: 1000 }}
      />,
    );

    const pixels = container.querySelector('[data-name="fragment-image"]');
    expect(pixels).toHaveAttribute("data-preview-source", "local-effects");
    expect(pixels).toHaveAttribute("data-crop-x", "0");
    vi.unstubAllGlobals();
  });

  test("moves only the extracted fragment transform and never marker points", () => {
    const onChange = vi.fn();
    konva.drag = { x: 150, y: -100 };
    const { container } = render(
      <FragmentNode
        layer={fragment}
        image={{ width: 1000, height: 800 }}
        canvasSize={{ width: 1000, height: 1000 }}
        selected
        onChange={onChange}
      />,
    );

    fireEvent.dragEnd(container.querySelector('[data-layer-id="fragment-01"]'));

    expect(onChange).toHaveBeenCalledWith({
      transform: { x: 0.6, y: 0.4, width: 0.3, height: 0.2 },
    });
    expect(onChange.mock.calls[0][0]).not.toHaveProperty("points");
  });

  test("resizes an extracted fragment with the same selected handles used for markers", () => {
    const onChange = vi.fn();
    konva.drag = { x: 800, y: 700 };
    const { container } = render(
      <FragmentNode
        layer={fragment}
        image={{ width: 1000, height: 800 }}
        canvasSize={{ width: 1000, height: 1000 }}
        selected
        onChange={onChange}
      />,
    );

    fireEvent.dragEnd(container.querySelector('[data-name="fragment-resize-handle-se"]'));

    expect(onChange).toHaveBeenCalledWith({
      transform: { x: 0.45, y: 0.5, width: 0.35, height: 0.2 },
    });
  });
});
