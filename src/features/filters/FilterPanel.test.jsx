import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { FilterPanel } from "./FilterPanel.jsx";

describe("FilterPanel", () => {
  test("adds named effects through the explicit palette instead of writing flat filters", () => {
    const onAction = vi.fn();
    render(<FilterPanel effects={[]} onAction={onAction} />);

    fireEvent.click(screen.getByRole("button", { name: "添加 颗粒 效果" }));
    expect(onAction).toHaveBeenCalledWith("add", expect.objectContaining({
      type: "grain",
      settings: { amount: 0.3, seed: 1 },
    }));
  });

  test("edits cards through effect-stack actions and can reset visible effects", () => {
    const onAction = vi.fn();
    render(<FilterPanel effects={[{
      id: "rgb-1", type: "rgbOffset", name: "RGB 偏移", visible: true, opacity: 1,
      settings: { offset: 4 },
    }]} onAction={onAction} />);

    fireEvent.click(screen.getByRole("button", { name: "隐藏 RGB 偏移" }));
    expect(onAction).toHaveBeenCalledWith("update", "rgb-1", { visible: false });
    fireEvent.click(screen.getByRole("button", { name: "重置底图效果" }));
    expect(onAction).toHaveBeenCalledWith("reset");
  });
});
