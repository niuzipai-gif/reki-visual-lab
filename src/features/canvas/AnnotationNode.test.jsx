import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AnnotationNode } from "./AnnotationNode.jsx";

const motion = vi.hoisted(() => ({ resolveAnimation: vi.fn() }));

vi.mock("react-konva", () => ({
  Circle: (props) => <div {...props} />,
  Group: (props) => <div {...props} />,
  Line: (props) => <div {...props} />,
  Rect: (props) => <div {...props} />,
  Text: (props) => <div {...props} />,
}));

vi.mock("../motion/animationRuntime.js", () => ({
  resolveAnimation: motion.resolveAnimation,
}));

const layer = {
  id: "annotation-1",
  type: "box",
  points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }],
  style: {
    lineColor: "#fff",
    textColor: "#fff",
    anchorColor: "#fff",
    lineWidth: 2,
    dash: [],
    opacity: 1,
    anchorSize: 4,
    curveTension: 0,
    fontSize: 16,
  },
  animation: { type: "none" },
};

function renderNode(props) {
  return <AnnotationNode
    layer={layer}
    canvasSize={{ width: 1000, height: 1000 }}
    onSelect={() => {}}
    onChange={() => {}}
    {...props}
  />;
}

describe("AnnotationNode preview memoization", () => {
  beforeEach(() => {
    motion.resolveAnimation.mockReset();
  });

  test("skips static annotation work when only preview time changes", () => {
    motion.resolveAnimation.mockReturnValue({
      translateX: 0, translateY: 0, scale: 1, rotation: 0, opacity: 1,
      drawProgress: 1, flash: 1,
    });
    const { rerender } = render(renderNode({ animationTimeMs: 0 }));

    rerender(renderNode({ animationTimeMs: 17 }));

    expect(motion.resolveAnimation).toHaveBeenCalledTimes(1);
  });

  test("repaints animated annotations when preview time changes", () => {
    motion.resolveAnimation.mockReturnValue({
      translateX: 0, translateY: 0, scale: 1, rotation: 0, opacity: 1,
      drawProgress: 1, flash: 1,
    });
    const animatedLayer = { ...layer, animation: { type: "pulse" } };
    const { rerender } = render(renderNode({ layer: animatedLayer, animationTimeMs: 0 }));

    rerender(renderNode({ layer: animatedLayer, animationTimeMs: 17 }));

    expect(motion.resolveAnimation).toHaveBeenCalledTimes(2);
  });
});
