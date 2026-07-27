import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { BottomDock } from "./BottomDock.jsx";

describe("BottomDock", () => {
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
