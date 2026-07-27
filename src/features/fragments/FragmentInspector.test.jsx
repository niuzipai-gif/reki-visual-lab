import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { FragmentInspector } from "./FragmentInspector.jsx";
import { Inspector } from "../tools/Inspector.jsx";

const fragment = {
  id: "fragment-01",
  type: "extractedFragment",
  name: "fragment_01",
  sourceMarkerId: "marker-01",
  sourceRect: { x: 0.2, y: 0.25, width: 0.3, height: 0.2 },
  transform: { x: 0.55, y: 0.4, width: 0.3, height: 0.2 },
  linkedToMarker: false,
  sourceFill: "preserve",
  effects: [],
};

describe("FragmentInspector", () => {
  test("offers every spatial marker an inspector action to extract its visible bounds", () => {
    const onExtract = vi.fn();
    render(
      <Inspector
        layer={{
          id: "marker-01",
          type: "orbit",
          name: "orbit_01",
          points: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }],
          label: "label_01",
          style: {
            lineColor: "#e5484d", textColor: "#fff", anchorColor: "#f66",
            lineWidth: 2, fontSize: 14, anchorSize: 5, dash: [], opacity: 1, curveTension: 0,
          },
        }}
        onPatch={vi.fn()}
        onBatchLabel={vi.fn()}
        onApplyStyle={vi.fn()}
        onDelete={vi.fn()}
        onExtract={onExtract}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "提取框内原图" }));

    expect(onExtract).toHaveBeenCalledTimes(1);
  });

  test("changes the fill used at the original extracted location", () => {
    const onPatch = vi.fn();
    render(<FragmentInspector layer={fragment} onPatch={onPatch} />);

    fireEvent.change(screen.getByLabelText("原位置填充"), {
      target: { value: "transparent" },
    });

    expect(onPatch).toHaveBeenCalledWith({ sourceFill: "transparent" });
  });

  test("lets an independently moved fragment reconnect to its source marker", () => {
    const onRelink = vi.fn();
    render(
      <FragmentInspector
        layer={fragment}
        onPatch={vi.fn()}
        onRelink={onRelink}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重新关联标记" }));

    expect(onRelink).toHaveBeenCalledTimes(1);
  });

  test("explains that the fragment is a rectangular original-pixel reference", () => {
    render(<FragmentInspector layer={fragment} onPatch={vi.fn()} />);

    expect(screen.getByText(/矩形原图像素/)).toBeInTheDocument();
    expect(screen.getByText(/不会抠图/)).toBeInTheDocument();
  });
});
