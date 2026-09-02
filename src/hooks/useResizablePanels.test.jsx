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

  test("falls back when a persisted mobile sheet height is invalid", () => {
    localStorage.setItem("reki.mobile-sheet-height", "not-a-height");
    render(<Harness />);

    expect(screen.getByLabelText("sheet height")).toHaveTextContent("62");
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

  test("resizes the mobile sheet with a pointer drag", () => {
    render(<Harness />);
    const separator = screen.getByRole("separator", { name: "调整移动端面板高度" });

    fireEvent.pointerDown(separator, { button: 0, clientY: 600 });
    fireEvent.pointerMove(window, { clientY: 446 });
    fireEvent.pointerUp(window);

    expect(screen.getByLabelText("sheet height")).toHaveTextContent("82");
  });

  test("cleans an active drag on pointercancel and unmount", () => {
    const removeListener = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Harness />);
    const separator = screen.getByRole("separator", { name: "调整右侧工作区宽度" });

    fireEvent.pointerDown(separator, { button: 0, clientX: 700 });
    fireEvent.pointerCancel(window);
    expect(removeListener).toHaveBeenCalledWith("pointermove", expect.any(Function));

    fireEvent.pointerDown(separator, { button: 0, clientX: 700 });
    unmount();

    expect(removeListener.mock.calls.filter(([type]) => type === "pointermove")).toHaveLength(2);
  });

  test("prevents browser scrolling when keyboard resizing", () => {
    render(<Harness />);
    const separator = screen.getByRole("separator", { name: "调整右侧工作区宽度" });
    const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });

    separator.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
