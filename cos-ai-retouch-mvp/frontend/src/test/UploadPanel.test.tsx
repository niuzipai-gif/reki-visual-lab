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
    await user.click(screen.getByRole("button", { name: "上传并开始分析" }));
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { files: [replaced] } });

    expect(onTaskReset).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "上传并开始分析" }));
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(2));
    expect(uploadOriginal).toHaveBeenLastCalledWith(
      "https://storage.example/task-new/upload",
      replaced,
    );
  });
});
