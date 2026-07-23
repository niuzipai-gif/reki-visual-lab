import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import {
  DEFAULT_FILTER_SETTINGS,
} from "./filterPipeline.js";
import { FilterPanel } from "./FilterPanel.jsx";

describe("FilterPanel", () => {
  test("renders real controls for every static pixel effect", () => {
    render(
      <FilterPanel
        settings={DEFAULT_FILTER_SETTINGS}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "启用阈值" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "阈值" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "4×4 网点" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "颗粒" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "RGB 偏移" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "扫描线" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "启用双色调" })).toBeInTheDocument();
    expect(screen.getByLabelText("暗部颜色")).toHaveAttribute("type", "color");
    expect(screen.getByLabelText("亮部颜色")).toHaveAttribute("type", "color");
    expect(screen.getByRole("button", { name: "重置底图效果" })).toBeInTheDocument();
  });

  test("emits one focused filter update per control interaction", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterPanel
        settings={DEFAULT_FILTER_SETTINGS}
        onChange={onChange}
        onReset={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "启用阈值" }));
    expect(onChange).toHaveBeenLastCalledWith({
      threshold: 128,
      halftone: false,
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    rerender(
      <FilterPanel
        settings={{ ...DEFAULT_FILTER_SETTINGS, threshold: 128 }}
        onChange={onChange}
        onReset={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("slider", { name: "阈值" }), {
      target: { value: "143" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ threshold: 143 });
    expect(onChange).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("checkbox", { name: "4×4 网点" }));
    expect(onChange).toHaveBeenLastCalledWith({
      halftone: true,
      threshold: null,
    });
    fireEvent.change(screen.getByRole("slider", { name: "颗粒" }), {
      target: { value: "0.35" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ grain: 0.35 });
    fireEvent.change(screen.getByRole("slider", { name: "RGB 偏移" }), {
      target: { value: "4" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ rgbOffset: 4 });
    fireEvent.change(screen.getByRole("slider", { name: "扫描线" }), {
      target: { value: "0.4" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ scanline: 0.4 });
  });

  test("enables and edits duotone colors as RGB values", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const settings = {
      ...DEFAULT_FILTER_SETTINGS,
      duotone: { dark: [10, 20, 30], light: [240, 220, 170] },
    };
    render(
      <FilterPanel settings={settings} onChange={onChange} onReset={vi.fn()} />,
    );

    expect(screen.getByRole("checkbox", { name: "启用双色调" })).toBeChecked();
    expect(screen.getByLabelText("暗部颜色")).toHaveValue("#0a141e");
    fireEvent.change(screen.getByLabelText("暗部颜色"), {
      target: { value: "#123456" },
    });
    expect(onChange).toHaveBeenCalledWith({
      duotone: { dark: [18, 52, 86], light: [240, 220, 170] },
    });

    await user.click(screen.getByRole("checkbox", { name: "启用双色调" }));
    expect(onChange).toHaveBeenLastCalledWith({ duotone: null });
  });

  test("resets all filter state through one action", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(
      <FilterPanel
        settings={{
          threshold: 90,
          halftone: true,
          grain: 0.8,
          rgbOffset: 9,
          scanline: 0.7,
          duotone: { dark: [0, 0, 0], light: [255, 255, 255] },
        }}
        onChange={vi.fn()}
        onReset={onReset}
      />,
    );

    await user.click(screen.getByRole("button", { name: "重置底图效果" }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  test("keeps threshold and halftone mutually exclusive", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterPanel
        settings={{ ...DEFAULT_FILTER_SETTINGS, threshold: 128 }}
        onChange={onChange}
        onReset={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "4×4 网点" }));
    expect(onChange).toHaveBeenCalledWith({
      halftone: true,
      threshold: null,
    });

    onChange.mockClear();
    rerender(
      <FilterPanel
        settings={{ ...DEFAULT_FILTER_SETTINGS, halftone: true }}
        onChange={onChange}
        onReset={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "启用阈值" }));
    expect(onChange).toHaveBeenCalledWith({
      threshold: 128,
      halftone: false,
    });
  });
});
