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

  test("keeps static layers focused while preserving advanced animation values", () => {
    const onChange = vi.fn();
    const advancedAnimation = {
      type: "none",
      durationMs: 1500,
      delayMs: 800,
      loop: false,
      amplitude: 0.75,
      direction: "alternate",
    };
    const { rerender } = render(
      <MotionPanel
        layer={animatedLayer({ animation: advancedAnimation })}
        timeMs={450}
        onChange={onChange}
        onPlayChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("动画类型")).toBeVisible();
    expect(screen.getByRole("button", { name: "播放动画预览" })).toBeVisible();
    expect(screen.getByRole("slider", { name: "全局时间轴" })).toHaveValue("450");
    expect(screen.getByText("选择动画后，可调整时长、延迟与动态幅度。")).toBeVisible();
    expect(screen.queryByLabelText("动画时长")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("动画延迟")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("循环播放")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("动态幅度")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("播放方向")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("动画类型"), { target: { value: "fade" } });
    expect(onChange).toHaveBeenCalledWith({ ...advancedAnimation, type: "fade" });

    rerender(
      <MotionPanel
        layer={animatedLayer({ animation: { ...advancedAnimation, type: "fade" } })}
        timeMs={450}
        onChange={onChange}
        onPlayChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("动画时长")).toHaveValue(1500);
    expect(screen.getByLabelText("动画延迟")).toHaveValue(800);
    expect(screen.getByLabelText("循环播放")).not.toBeChecked();
    expect(screen.getByLabelText("动态幅度")).toHaveValue("75");
    expect(screen.getByLabelText("播放方向")).toHaveValue("alternate");
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

  test("edits the persisted global preview duration", () => {
    const onTimelineDurationChange = vi.fn();
    render(
      <MotionPanel
        layer={animatedLayer()}
        timelineDurationMs={4000}
        onTimelineDurationChange={onTimelineDurationChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("全局动画时长"), {
      target: { value: "5200" },
    });

    expect(onTimelineDurationChange).toHaveBeenCalledWith(5200);
  });
});
