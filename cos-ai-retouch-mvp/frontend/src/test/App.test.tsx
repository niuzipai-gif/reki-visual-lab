// @vitest-environment jsdom
import "./setup";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App, { createOperationKeyStore } from "../app/App";
import type { TaskView } from "../domain/task";

const awaitingTask: TaskView = {
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

const plannedTask: TaskView = {
  ...awaitingTask,
  plan: {
    goals: ["natural_retouch"],
    preserve: [],
    regions: [],
    maskStrokes: [],
    operations: [{ kind: "skin_retouch", goal: "natural_retouch", regionIds: [], intensity: 55, enabled: true }],
    intensity: 55,
    integration: [],
    validation: [],
  },
};

function makeClient(task: TaskView = awaitingTask) {
  return {
    createTask: vi.fn().mockResolvedValue({
      taskId: "task-123",
      status: "uploading" as const,
      uploadUrl: "https://storage.example/signed-upload",
      expiresAt: "2026-08-31T01:00:00Z",
    }),
    uploadOriginal: vi.fn().mockResolvedValue(undefined),
    startAnalysis: vi.fn().mockResolvedValue(undefined),
    getTask: vi.fn().mockResolvedValue(task),
    savePlan: vi.fn().mockResolvedValue(undefined),
    startGeneration: vi.fn().mockResolvedValue(undefined),
    getDownloadUrl: vi.fn(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("COS retouch app", () => {
  it("reuses one idempotency key per task operation without crossing scopes", () => {
    let generated = 0;
    const keys = createOperationKeyStore(() => `key-${++generated}`);

    expect(keys.get("task-a", "analyze")).toBe("key-1");
    expect(keys.get("task-a", "analyze")).toBe("key-1");
    expect(keys.get("task-a", "generate")).toBe("key-2");
    expect(keys.get("task-b", "analyze")).toBe("key-3");
    expect(generated).toBe(3);
  });

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
    expect(client.getTask).toHaveBeenCalledWith("task-123", "invite-in-memory");

    expect(await screen.findByRole("heading", { name: "AI 分析" })).toBeVisible();
    for (const label of ["面部", "头发", "服装", "身体 / 姿态", "背景", "光线"]) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(screen.queryByText("姿态", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("置信度 92%")).toBeVisible();
    expect(screen.getByTestId("region-highlight-face-1")).toHaveAttribute(
      "aria-label",
      "区域 face-1",
    );
    expect(screen.getByLabelText("自然修图")).toBeVisible();
    expect(screen.getByLabelText("结构修复")).toBeVisible();
    expect(screen.getByLabelText("自然 + 结构")).toBeVisible();
  });

  it("keeps the preview Blob URL alive across the upload-to-analysis switch and releases it on app unmount", async () => {
    const user = userEvent.setup();
    const client = makeClient();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi.fn(() => "blob:cos-preview");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });

    try {
      const { unmount } = render(<App apiClient={client} />);
      await user.type(screen.getByLabelText("邀请 token"), "invite-in-memory");
      await user.click(screen.getByRole("button", { name: "进入工作台" }));
      await user.upload(
        screen.getByLabelText("选择 JPG 或 PNG 原图"),
        new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" }),
      );
      await user.click(screen.getByRole("button", { name: "上传并开始分析" }));

      const analysisPreview = await screen.findByAltText("原图分析预览");
      expect(analysisPreview).toHaveAttribute("src", "blob:cos-preview");
      expect(revokeObjectURL).not.toHaveBeenCalled();

      unmount();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:cos-preview");
    } finally {
      if (originalCreateObjectURL) {
        Object.defineProperty(URL, "createObjectURL", {
          configurable: true,
          value: originalCreateObjectURL,
        });
      } else {
        Reflect.deleteProperty(URL, "createObjectURL");
      }
      if (originalRevokeObjectURL) {
        Object.defineProperty(URL, "revokeObjectURL", {
          configurable: true,
          value: originalRevokeObjectURL,
        });
      } else {
        Reflect.deleteProperty(URL, "revokeObjectURL");
      }
    }
  });

  it("retries analysis with the same idempotency key after a request failure", async () => {
    const user = userEvent.setup();
    const client = makeClient();
    client.startAnalysis
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce(undefined);
    render(<App apiClient={client} />);

    await user.type(screen.getByLabelText("邀请 token"), "invite-in-memory");
    await user.click(screen.getByRole("button", { name: "进入工作台" }));
    await user.upload(
      screen.getByLabelText("选择 JPG 或 PNG 原图"),
      new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "上传并开始分析" }));

    const retryButton = await screen.findByRole("button", { name: "重试分析" });
    await user.click(retryButton);

    await waitFor(() => expect(client.startAnalysis).toHaveBeenCalledTimes(2));
    expect(client.startAnalysis.mock.calls[0][2]).toBe(
      client.startAnalysis.mock.calls[1][2],
    );
  });

  it("saves the latest plan before generation even when the task already has a plan", async () => {
    const user = userEvent.setup();
    const client = makeClient(plannedTask);
    render(<App apiClient={client} />);

    await user.type(screen.getByLabelText("邀请 token"), "invite-in-memory");
    await user.click(screen.getByRole("button", { name: "进入工作台" }));
    await user.upload(
      screen.getByLabelText("选择 JPG 或 PNG 原图"),
      new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "上传并开始分析" }));
    await screen.findByRole("heading", { name: "AI 分析" });

    const faceSwitch = screen.getByRole("switch", { name: "面部处理开关" });
    if (!(faceSwitch as HTMLInputElement).checked) await user.click(faceSwitch);
    await user.click(screen.getByRole("button", { name: "确认并生成候选图" }));

    await waitFor(() => expect(client.startGeneration).toHaveBeenCalledTimes(1));
    expect(client.savePlan).toHaveBeenCalledTimes(1);
    expect(client.savePlan.mock.invocationCallOrder[0]).toBeLessThan(
      client.startGeneration.mock.invocationCallOrder[0],
    );
  });

  it("skips plan saving when the first generation was accepted but status lookup failed", async () => {
    const user = userEvent.setup();
    const client = makeClient(plannedTask);
    const generatingTask: TaskView = { ...plannedTask, status: "generating" };
    client.getTask
      .mockResolvedValueOnce(plannedTask)
      .mockResolvedValueOnce(plannedTask)
      .mockRejectedValueOnce(new Error("status lookup failed"))
      .mockResolvedValueOnce(generatingTask);
    render(<App apiClient={client} />);

    await user.type(screen.getByLabelText("邀请 token"), "invite-in-memory");
    await user.click(screen.getByRole("button", { name: "进入工作台" }));
    await user.upload(
      screen.getByLabelText("选择 JPG 或 PNG 原图"),
      new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "上传并开始分析" }));
    await screen.findByRole("heading", { name: "AI 分析" });

    const faceSwitch = screen.getByRole("switch", { name: "面部处理开关" });
    if (!(faceSwitch as HTMLInputElement).checked) await user.click(faceSwitch);
    await user.click(screen.getByRole("button", { name: "确认并生成候选图" }));
    const retryButton = await screen.findByRole("button", { name: "重试生成" });

    expect(client.savePlan).toHaveBeenCalledTimes(1);
    expect(faceSwitch).toBeDisabled();
    expect(screen.getByLabelText("自然修图")).toBeDisabled();
    await user.click(retryButton);

    await waitFor(() => expect(client.startGeneration).toHaveBeenCalledTimes(2));
    expect(client.savePlan).toHaveBeenCalledTimes(1);
    expect(client.startGeneration.mock.calls[0][2]).toBe(
      client.startGeneration.mock.calls[1][2],
    );
  });

  it("retries generation with the same idempotency key after a request failure", async () => {
    const user = userEvent.setup();
    const client = makeClient(plannedTask);
    client.startGeneration
      .mockRejectedValueOnce(new Error("temporary generation failure"))
      .mockResolvedValueOnce(undefined);
    render(<App apiClient={client} />);

    await user.type(screen.getByLabelText("邀请 token"), "invite-in-memory");
    await user.click(screen.getByRole("button", { name: "进入工作台" }));
    await user.upload(
      screen.getByLabelText("选择 JPG 或 PNG 原图"),
      new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "上传并开始分析" }));
    await screen.findByRole("heading", { name: "AI 分析" });

    const faceSwitch = screen.getByRole("switch", { name: "面部处理开关" });
    if (!(faceSwitch as HTMLInputElement).checked) await user.click(faceSwitch);
    await user.click(screen.getByRole("button", { name: "确认并生成候选图" }));
    const retryButton = await screen.findByRole("button", { name: "重试生成" });
    await user.click(retryButton);

    await waitFor(() => expect(client.startGeneration).toHaveBeenCalledTimes(2));
    expect(client.startGeneration.mock.calls[0][2]).toBe(
      client.startGeneration.mock.calls[1][2],
    );
  });
});
