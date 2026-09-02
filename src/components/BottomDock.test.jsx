import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { BottomDock } from "./BottomDock.jsx";

describe("BottomDock", () => {
  test("returns to selection in one tap without opening a sheet", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(
      <BottomDock
        activeSheet="tools"
        activeTool="pointBox"
        onSelect={onSelect}
        onOpen={onOpen}
        onExport={vi.fn()}
        onToggleComparison={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "移动端返回选择模式" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "打开预设面板" })).not.toBeInTheDocument();
  });

  test("keeps original comparison reachable from the mobile dock", async () => {
    const user = userEvent.setup();
    const onToggleComparison = vi.fn();
    render(
      <BottomDock
        activeSheet={null}
        canCompare
        comparisonVisible={false}
        onOpen={vi.fn()}
        onExport={vi.fn()}
        onToggleComparison={onToggleComparison}
      />,
    );

    await user.click(screen.getByRole("button", { name: "移动端原图对比" }));
    expect(onToggleComparison).toHaveBeenCalledTimes(1);
  });
});
