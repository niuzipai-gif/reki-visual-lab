// @vitest-environment jsdom
import "./setup";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "../app/App";

const awaitingTask = {
  taskId: "task-123",
  status: "awaiting_confirmation" as const,
  createdAt: "2026-08-31T00:00:00Z",
  updatedAt: "2026-08-31T00:01:00Z",
  analysis: [
    {
      id: "face-card",
      category: "face",
      title: "面部细节",
      summary: "保留角色辨识度，轻微清理肤质。",
      confidence: 0.92,
      risk: "不要改变面部身份。",
      enabled: false,
      regions: [
        {
          id: "face-1",
          label: "face",
          x: 0.25,
          y: 0.2,
          width: 0.3,
          height: 0.4,
          source: "analysis",
        },
      ],
    },
  ],
  originalAssetUrl: null,
  maskAssetUrl: null,
  plan: null,
  versions: [],
  error: null,
};

function makeClient() {
  return {
    createTask: vi.fn().mockResolvedValue({
      taskId: "task-123",
      status: "uploading" as const,
      uploadUrl: "https://storage.example/signed-upload",
      expiresAt: "2026-08-31T01:00:00Z",
    }),
    uploadOriginal: vi.fn().mockResolvedValue(undefined),
    startAnalysis: vi.fn().mockResolvedValue(awaitingTask),
    getTask: vi.fn().mockResolvedValue(awaitingTask),
    savePlan: vi.fn(),
    startGeneration: vi.fn(),
    getDownloadUrl: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("COS retouch app", () => {
  it("keeps the invite in the React flow and opens the upload panel", async () => {
    const user = userEvent.setup();
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    render(<App />);

    await user.type(screen.getByLabelText("邀请 token"), "invite-in-memory");
    await user.click(screen.getByRole("button", { name: "进入工作台" }));

    expect(await screen.findByRole("heading", { name: "上传原图" })).toBeVisible();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });

  it("rejects a non-JPG/PNG file or a file above 20MB before calling the API", async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<App apiClient={client} />);

    await user.type(screen.getByLabelText("邀请 token"), "invite-in-memory");
    await user.click(screen.getByRole("button", { name: "进入工作台" }));
    const input = screen.getByLabelText("选择 JPG 或 PNG 原图");

    const tooLarge = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.png", {
      type: "image/png",
    });
    fireEvent.change(input, { target: { files: [tooLarge] } });

    expect(await screen.findByText("文件不能超过 20MB。")).toBeVisible();
    expect(client.createTask).not.toHaveBeenCalled();

    const gif = new File(["gif-data"], "not-supported.gif", {
      type: "image/gif",
    });
    fireEvent.change(input, { target: { files: [gif] } });
    expect(await screen.findByText("仅支持 JPG 或 PNG 图片。")) .toBeVisible();
    expect(client.createTask).not.toHaveBeenCalled();
  });

  it("previews a valid upload, starts analysis, and shows bounded analysis cards", async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<App apiClient={client} />);

    await user.type(screen.getByLabelText("邀请 token"), "invite-in-memory");
    await user.click(screen.getByRole("button", { name: "进入工作台" }));

    const file = new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("选择 JPG 或 PNG 原图"), file);

    expect(await screen.findByAltText("待处理原图预览")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "上传并开始分析" }));
    await waitFor(() => expect(client.createTask).toHaveBeenCalledTimes(1));
    expect(client.uploadOriginal).toHaveBeenCalledWith(
      "https://storage.example/signed-upload",
      file,
    );
    expect(client.startAnalysis).toHaveBeenCalledWith(
      "task-123",
      "invite-in-memory",
      expect.any(String),
    );

    expect(await screen.findByRole("heading", { name: "AI 分析" })).toBeVisible();
    for (const label of ["面部", "头发", "服装", "身体", "姿态", "背景", "光线"]) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(screen.getByText("置信度 92%")).toBeVisible();
    expect(screen.getByTestId("region-highlight-face-1")).toHaveAttribute(
      "aria-label",
      "区域 face-1",
    );
    expect(screen.getByLabelText("自然修图")).toBeVisible();
    expect(screen.getByLabelText("结构修复")).toBeVisible();
    expect(screen.getByLabelText("自然 + 结构")).toBeVisible();
  });
});
