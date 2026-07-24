import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { EffectStackPanel } from "./EffectStackPanel.jsx";

describe("EffectStackPanel", () => {
  const effects = [
    {
      id: "grain-1",
      type: "grain",
      name: "颗粒",
      visible: true,
      opacity: 0.65,
      settings: { amount: 0.35, seed: 1 },
    },
    {
      id: "scanline-1",
      type: "scanline",
      name: "扫描线",
      visible: false,
      opacity: 1,
      settings: { amount: 0.4 },
    },
  ];

  test("renders named cards with accessible visibility, opacity, order and delete controls", () => {
    const onAction = vi.fn();
    render(<EffectStackPanel effects={effects} onAction={onAction} />);

    expect(screen.getByText("颗粒")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "隐藏 颗粒" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "颗粒 不透明度" })).toHaveValue("65");
    expect(screen.getByRole("slider", { name: "颗粒 不透明度" })).toHaveAttribute("aria-valuetext", "65%");
    expect(screen.getByRole("button", { name: "下移 颗粒" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除 颗粒" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "显示 扫描线" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "隐藏 颗粒" }));
    expect(onAction).toHaveBeenCalledWith("update", "grain-1", { visible: false });
  });

  test("exposes a real strength setting for halftone and duotone", () => {
    const onAction = vi.fn();
    render(<EffectStackPanel effects={[
      { id: "half", type: "halftone", name: "网点", visible: true, opacity: 1, settings: { amount: 0.6 } },
      { id: "duo", type: "duotone", name: "双色调", visible: true, opacity: 1, settings: { amount: 0.7, dark: [0, 0, 0], light: [255, 255, 255] } },
    ]} onAction={onAction} />);

    fireEvent.click(screen.getByRole("button", { name: "展开 网点 设置" }));
    expect(screen.getByRole("slider", { name: "网点 强度" })).toHaveValue("0.6");
    fireEvent.change(screen.getByRole("slider", { name: "网点 强度" }), { target: { value: "0.4" } });
    expect(onAction).toHaveBeenCalledWith("update", "half", { settings: { amount: 0.4 } });

    fireEvent.click(screen.getByRole("button", { name: "展开 双色调 设置" }));
    expect(screen.getByRole("slider", { name: "双色调 强度" })).toHaveValue("0.7");
  });
});
