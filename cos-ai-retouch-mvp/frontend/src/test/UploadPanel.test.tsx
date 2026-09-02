// @vitest-environment jsdom
import "./setup";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import UploadPanel from "../components/UploadPanel";
import type { TaskView } from "../domain/task";

function task(taskId: string, status: TaskView["status"]): TaskView {
  return {
    taskId,
    status,
    uploadUrl: `https://storage.example/${taskId}/upload`,
    analysis: [],
    originalAssetUrl: null,
    maskAssetUrl: null,
    plan: null,
    versions: [],
    error: null,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UploadPanel file identity", () => {
  it("explains the COS retouch menu before a photo is uploaded", () => {
    render(
      <UploadPanel
        inviteToken="invite-in-memory"
        apiClient={{
          createTask: vi.fn(),
          uploadOriginal: vi.fn(),
          startAnalysis: vi.fn(),
          getTask: vi.fn(),
          savePlan: vi.fn(),
          startGeneration: vi.fn(),
          getDownloadUrl: vi.fn(),
        }}
        onTaskUpdate={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "AI 会帮你检查什么？" })).toBeVisible();
    for (const label of ["脸部与妆容", "假发与发丝", "服装与配件", "身形与姿态", "背景与杂物", "光影与质感"]) {
      expect(screen.getByRole("heading", { name: label })).toBeVisible();
    }
    expect(screen.getByText("不是换脸，也不是整张图重画。")).toBeVisible();
    expect(screen.getByText("先给方案，再由你决定要不要生成。")) .toBeVisible();
  });

  it("uses the welcoming upload flow copy", () => {
    render(
      <UploadPanel
        inviteToken="invite-in-memory"
        apiClient={{
          createTask: vi.fn(),
          uploadOriginal: vi.fn(),
          startAnalysis: vi.fn(),
          getTask: vi.fn(),
          savePlan: vi.fn(),
          startGeneration: vi.fn(),
          getDownloadUrl: vi.fn(),
        }}
        onTaskUpdate={vi.fn()}
      />,
    );

    expect(screen.getByText("第一步 · 上传照片")).toBeVisible();
    expect(screen.getByRole("heading", { name: "先放一张你喜欢的照片" })).toBeVisible();
    expect(screen.getByText("我们会保留你的脸、姿势和服装设计，只帮你把细节变得更好。")).toBeVisible();
    expect(screen.getByText("把 COS 照片放在这里")).toBeVisible();
    expect(screen.getByRole("button", { name: "开始看看哪里可以更好" })).toBeDisabled();
  });

  it("resets the old task before reusing a same-name same-size replaced file", async () => {
    const user = userEvent.setup();
    const createdTask = task("task-old", "uploading");
    const analyzedTask = task("task-old", "analyzing");
    const createTask = vi.fn()
      .mockResolvedValueOnce(createdTask)
      .mockResolvedValueOnce(task("task-new", "uploading"));
    const uploadOriginal = vi.fn().mockResolvedValue(undefined);
    const apiClient = {
      createTask,
      uploadOriginal,
      startAnalysis: vi.fn().mockResolvedValue(undefined),
      getTask: vi.fn().mockResolvedValue(analyzedTask),
      savePlan: vi.fn(),
      startGeneration: vi.fn(),
      getDownloadUrl: vi.fn(),
    };
    const onTaskReset = vi.fn();
    render(
      <UploadPanel
        inviteToken="invite-in-memory"
        apiClient={apiClient}
        onTaskUpdate={vi.fn()}
        onTaskReset={onTaskReset}
      />,
    );
    const input = screen.getByLabelText("选择 JPG 或 PNG 原图");
    const first = new File(["aa"], "same.jpg", { type: "image/jpeg", lastModified: 1 });
    const replaced = new File(["bb"], "same.jpg", { type: "image/jpeg", lastModified: 2 });

    await user.upload(input, first);
    await screen.findByAltText("待处理原图预览");
    expect(screen.getByRole("region", { name: "先放一张你喜欢的照片" })).toHaveClass("upload-panel-ready");
    await user.click(screen.getByRole("button", { name: "开始看看哪里可以更好" }));
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { files: [replaced] } });

    expect(onTaskReset).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "开始看看哪里可以更好" }));
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(2));
    expect(uploadOriginal).toHaveBeenLastCalledWith(
      "https://storage.example/task-new/upload",
      replaced,
    );
  });

  it("keeps the selected file when a replacement is attempted during upload", async () => {
    const user = userEvent.setup();
    const createTask = vi.fn().mockResolvedValue(task("task-old", "uploading"));
    let resolveUpload: (() => void) | undefined;
    const uploadOriginal = vi.fn(() => new Promise<void>((resolve) => {
      resolveUpload = resolve;
    }));
    const apiClient = {
      createTask,
      uploadOriginal,
      startAnalysis: vi.fn().mockResolvedValue(undefined),
      getTask: vi.fn().mockResolvedValue(task("task-old", "awaiting_confirmation")),
      savePlan: vi.fn(),
      startGeneration: vi.fn(),
      getDownloadUrl: vi.fn(),
    };
    render(
      <UploadPanel
        inviteToken="invite-in-memory"
        apiClient={apiClient}
        onTaskUpdate={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("选择 JPG 或 PNG 原图");
    const original = new File(["old"], "original.jpg", {
      type: "image/jpeg",
      lastModified: 1,
    });
    const replacement = new File(["new"], "replacement.jpg", {
      type: "image/jpeg",
      lastModified: 2,
    });

    await user.upload(input, original);
    await user.click(screen.getByRole("button", { name: "开始看看哪里可以更好" }));
    await waitFor(() => expect(uploadOriginal).toHaveBeenCalledTimes(1));

    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { files: [replacement] } });
    expect(input).toBeDisabled();
    expect(screen.getByText("original.jpg")).toBeVisible();
    expect(createTask).toHaveBeenCalledTimes(1);

    resolveUpload?.();
    await waitFor(() => expect(apiClient.startAnalysis).toHaveBeenCalledTimes(1));
    expect(screen.getByText("original.jpg")).toBeVisible();
    expect(screen.queryByText("replacement.jpg")).not.toBeInTheDocument();
  });
});
