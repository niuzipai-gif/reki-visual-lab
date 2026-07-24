import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { createAnnotation } from "../../domain/project.js";
import { MotionPanel } from "./MotionPanel.jsx";

function animatedLayer(overrides = {}) {
  return {
    ...createAnnotation("box", [
      { x: 0.2, y: 0.3 },
      { x: 0.6, y: 0.7 },
    ], { id: "motion-layer" }),
    ...overrides,
  };
}

describe("MotionPanel", () => {
  test("updates the selected layer animation and pauses the timeline", () => {
    const onChange = vi.fn();
    const onPlayChange = vi.fn();

    render(
      <MotionPanel
        layer={animatedLayer()}
        playing
        timeMs={120}
        onChange={onChange}
        onPlayChange={onPlayChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("动画类型"), {
      target: { value: "pulse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "暂停动画预览" }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      type: "pulse",
    }));
    expect(onPlayChange).toHaveBeenCalledWith(false);
    expect(screen.getByText("0.12s / 4.00s")).toBeVisible();
  });

  test("exposes all persisted animation controls and restart", () => {
    const onChange = vi.fn();
    const onRestart = vi.fn();

    render(
      <MotionPanel
        layer={animatedLayer({ animation: { type: "glitch", amplitude: 0.5 } })}
        playing={false}
        timeMs={450}
        onChange={onChange}
        onPlayChange={vi.fn()}
        onRestart={onRestart}
      />,
    );

    expect(screen.getByLabelText("动画时长")).toBeVisible();
    expect(screen.getByLabelText("动画延迟")).toBeVisible();
    expect(screen.getByLabelText("循环播放")).toBeVisible();
    expect(screen.getByLabelText("动态幅度")).toBeVisible();
    expect(screen.getByLabelText("播放方向")).toBeVisible();
    expect(screen.getByRole("slider", { name: "全局时间轴" }))
      .toHaveValue("450");

    fireEvent.change(screen.getByLabelText("动态幅度"), {
      target: { value: "75" },
    });
    fireEvent.click(screen.getByRole("button", { name: "重新开始动画预览" }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ amplitude: 0.75 }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
