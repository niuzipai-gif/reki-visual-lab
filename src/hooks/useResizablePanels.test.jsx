import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useResizablePanels } from "./useResizablePanels.js";

function Harness() {
  const { desktopWidth, sheetHeight, desktopSeparatorProps, sheetSeparatorProps } =
    useResizablePanels();

  return (
    <>
      <output aria-label="desktop width">{desktopWidth}</output>
      <output aria-label="sheet height">{sheetHeight}</output>
      <div {...desktopSeparatorProps} />
      <div {...sheetSeparatorProps} />
    </>
  );
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("useResizablePanels", () => {
  test("clamps a persisted desktop panel width to the supported range", () => {
    localStorage.setItem("reki.desktop-panel-width", "900");
    render(<Harness />);

    expect(screen.getByLabelText("desktop width")).toHaveTextContent("520");
  });

  test("updates and persists desktop width from the keyboard separator", () => {
    render(<Harness />);
    const separator = screen.getByRole("separator", { name: "调整右侧工作区宽度" });

    fireEvent.keyDown(separator, { key: "ArrowRight" });

    expect(screen.getByLabelText("desktop width")).toHaveTextContent("336");
    expect(localStorage.getItem("reki.desktop-panel-width")).toBe("336");
  });

  test("updates a mobile sheet height from its keyboard separator and clamps it", () => {
    render(<Harness />);
    const separator = screen.getByRole("separator", { name: "调整移动端面板高度" });

    fireEvent.keyDown(separator, { key: "End" });

    expect(screen.getByLabelText("sheet height")).toHaveTextContent("82");
    expect(localStorage.getItem("reki.mobile-sheet-height")).toBe("82");
  });

  test("resizes the desktop work area with a pointer drag", () => {
    render(<Harness />);
    const separator = screen.getByRole("separator", { name: "调整右侧工作区宽度" });

    fireEvent.pointerDown(separator, { button: 0, clientX: 700 });
    fireEvent.pointerMove(window, { clientX: 600 });
    fireEvent.pointerUp(window);

    expect(screen.getByLabelText("desktop width")).toHaveTextContent("420");
  });
});
