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
    expect(screen.getByRole("slider", { name: "颗粒 不透明度" })).toHaveValue("0.65");
    expect(screen.getByRole("button", { name: "下移 颗粒" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除 颗粒" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "显示 扫描线" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "隐藏 颗粒" }));
    expect(onAction).toHaveBeenCalledWith("update", "grain-1", { visible: false });
  });
});
