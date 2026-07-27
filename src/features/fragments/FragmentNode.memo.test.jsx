import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { FragmentNode } from "./FragmentNode.jsx";

const motion = vi.hoisted(() => ({
  resolveAnimation: vi.fn(),
  resolveDrawClip: vi.fn(),
}));

vi.mock("react-konva", () => ({
  Circle: (props) => <div {...props} />,
  Group: (props) => <div {...props} />,
  Image: (props) => <div {...props} />,
  Rect: (props) => <div {...props} />,
}));

vi.mock("../motion/animationRuntime.js", () => ({
  resolveAnimation: motion.resolveAnimation,
  resolveDrawClip: motion.resolveDrawClip,
}));

vi.mock("./fragmentComposite.js", () => ({
  createFragmentPreview: vi.fn(() => null),
}));

const layer = {
  id: "fragment-1",
  type: "extractedFragment",
  sourceRect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
  transform: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
  animation: { type: "none" },
};
const image = { width: 1000, height: 1000 };

function renderNode(props) {
  return <FragmentNode
    layer={layer}
    image={image}
    canvasSize={{ width: 1000, height: 1000 }}
    onSelect={() => {}}
    onChange={() => {}}
    {...props}
  />;
}

describe("FragmentNode preview memoization", () => {
  beforeEach(() => {
    motion.resolveAnimation.mockReset();
    motion.resolveDrawClip.mockReset();
  });

  test("skips static fragment work when only preview time changes", () => {
    motion.resolveAnimation.mockReturnValue({
      translateX: 0, translateY: 0, scale: 1, rotation: 0, opacity: 1,
      drawProgress: 1, flash: 1,
    });
    motion.resolveDrawClip.mockReturnValue(null);
    const { rerender } = render(renderNode({ animationTimeMs: 0 }));

    rerender(renderNode({ animationTimeMs: 17 }));

    expect(motion.resolveAnimation).toHaveBeenCalledTimes(1);
  });

  test("repaints animated fragments when preview time changes", () => {
    motion.resolveAnimation.mockReturnValue({
      translateX: 0, translateY: 0, scale: 1, rotation: 0, opacity: 1,
      drawProgress: 1, flash: 1,
    });
    motion.resolveDrawClip.mockReturnValue(null);
    const animatedLayer = { ...layer, animation: { type: "pulse" } };
    const { rerender } = render(renderNode({ layer: animatedLayer, animationTimeMs: 0 }));

    rerender(renderNode({ layer: animatedLayer, animationTimeMs: 17 }));

    expect(motion.resolveAnimation).toHaveBeenCalledTimes(2);
  });
});
