import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const deferred = () => {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
};

const renderBlob = vi.fn();
const renderMotion = vi.fn();
vi.mock("./exportImage.js", () => ({
  createExportPlan: () => ({ width: 100, height: 120, includeBackground: true, estimatedBytes: 48_000 }),
  isSafeExport: () => true,
  decodeOriginalSource: vi.fn(async () => ({ source: { width: 100, height: 120 }, dispose: vi.fn() })),
  renderProjectToBlob: (...args) => renderBlob(...args),
}));
vi.mock("../motion/motionRenderer.js", () => ({
  MOTION_PRESET: { durationMs: 4000, fps: 24, maxEdge: 720, gifMaxEdge: 640 },
  createMotionPlan: (canvas, { maxEdge }) => {
    const scale = Math.min(1, maxEdge / Math.max(canvas.width, canvas.height));
    return { width: Math.round(canvas.width * scale), height: Math.round(canvas.height * scale) };
  },
  renderMotion: (...args) => renderMotion(...args),
}));

import { ExportDialog } from "./ExportDialog.jsx";

describe("ExportDialog export lifecycle", () => {
  beforeEach(() => { renderBlob.mockReset(); renderMotion.mockReset(); });
  afterEach(() => vi.restoreAllMocks());

  test("locks close affordances while export is in flight", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    renderBlob.mockReturnValue(pending.promise);
    const onClose = vi.fn();
    const onBusyChange = vi.fn();
    render(<React.StrictMode><ExportDialog project={{ name: "demo", canvas: { width: 100, height: 120 }, filters: {}, layers: [], image: {} }} onClose={onClose} onBusyChange={onBusyChange} /></React.StrictMode>);

    await user.click(screen.getByRole("button", { name: "导出图片" }));
    const close = screen.getByRole("button", { name: "关闭导出设置" });
    expect(close).toBeDisabled();
    fireEvent.mouseDown(screen.getByRole("presentation"), { target: screen.getByRole("presentation") });
    expect(onClose).not.toHaveBeenCalled();

    pending.resolve(new Blob(["ok"], { type: "image/png" }));
    await screen.findByText("导出完成，文件已保存。");
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  test("lets the user choose an image, video, GIF, or live-photo materials", async () => {
    const user = userEvent.setup();
    render(<ExportDialog project={{ name: "demo", canvas: { width: 100, height: 120 }, motion: { durationMs: 4000 }, filters: {}, layers: [], image: {} }} />);

    await user.click(screen.getByLabelText("动画视频"));
    expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled();
    expect(screen.getByText(/4 秒 · 24 FPS · 长边最多 720px/)).toBeVisible();

    await user.click(screen.getByLabelText("GIF"));
    expect(screen.getByRole("button", { name: "导出 GIF" })).toBeEnabled();

    await user.click(screen.getByLabelText("实况素材包"));
    expect(screen.getByText("封面图 + 短视频，可导入美图秀秀转换")).toBeVisible();
  });

  test("cancels a running animation export without triggering a download", async () => {
    const user = userEvent.setup();
    let capturedSignal;
    renderMotion.mockImplementation(({ signal }) => {
      capturedSignal = signal;
      return new Promise(() => {});
    });
    render(<ExportDialog project={{ name: "demo", canvas: { width: 100, height: 120 }, motion: { durationMs: 4000 }, filters: {}, layers: [], image: {} }} />);
    await user.click(screen.getByLabelText("动画视频"));
    await user.click(screen.getByRole("button", { name: "导出视频" }));
    await user.click(screen.getByRole("button", { name: "取消导出" }));
    expect(capturedSignal?.aborted).toBe(true);
  });

  test("shows the capped motion dimensions instead of the static image scale", async () => {
    const user = userEvent.setup();
    render(<ExportDialog project={{ name: "wide", canvas: { width: 2400, height: 1200 }, motion: { durationMs: 4000 }, filters: {}, layers: [], image: {} }} />);
    await user.click(screen.getByLabelText("动画视频"));
    expect(screen.getByText("720 × 360px")).toBeVisible();
    await user.click(screen.getByLabelText("GIF"));
    expect(screen.getByText("640 × 320px")).toBeVisible();
  });
});
