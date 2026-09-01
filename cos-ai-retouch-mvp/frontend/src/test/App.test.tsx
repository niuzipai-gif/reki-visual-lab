// @vitest-environment jsdom
import "./setup";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../app/api";
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

    expect(screen.getByText("COS AI 角色写真")).toBeVisible();
    expect(screen.getByRole("heading", { name: "进入我的写真工作室" })).toBeVisible();
    expect(screen.getByText("输入邀请 token，开启一张照片的温柔修图。")).toBeVisible();
    expect(screen.getByRole("button", { name: "开始我的修图" })).toBeVisible();
    await user.type(screen.getByLabelText("邀请 token"), "invite-in-memory");
    await user.click(screen.getByRole("button", { name: "开始我的修图" }));

    expect(await screen.findByRole("heading", { name: "先放一张你喜欢的照片" })).toBeVisible();
    expect(screen.getByText("COS AI 角色写真")).toBeVisible();
    expect(screen.getByRole("heading", { name: "把喜欢的角色，好好留在照片里" })).toBeVisible();
    expect(screen.getByText("你的照片只用于本次修图")).toBeVisible();
    expect(screen.getByText("修图小助手")).toBeVisible();
    expect(screen.getByText("上传照片")).toBeVisible();
    expect(screen.getByText("选择想变好的地方")).toBeVisible();
    expect(screen.getByText("生成预览")).toBeVisible();
    expect(screen.getByText("每一步都由你确认，原图和角色感都会好好保留。")).toBeVisible();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });

  it("rejects a non-JPG/PNG file or a file above 20MB before calling the API", async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<App apiClient={client} />);

    await user.type(screen.getByLabelText("邀请 token"), "invite-in-memory");
    await user.click(screen.getByRole("button", { name: "开始我的修图" }));
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
    await user.click(screen.getByRole("button", { name: "开始我的修图" }));

    const file = new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("选择 JPG 或 PNG 原图"), file);

    expect(await screen.findByAltText("待处理原图预览")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "开始看看哪里可以更好" }));
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

    expect(await screen.findByRole("heading", { name: "看看哪里可以更好" })).toBeVisible();
    for (const label of ["面部", "头发", "服装", "身体 / 姿态", "背景", "光线"]) {
      expect(screen.getByText(label)).toBeVisible();
    }
    for (const label of ["脸部状态", "头发与假发", "服装细节", "背景与光线"]) {
      expect(screen.getByRole("heading", { level: 3, name: label })).toBeVisible();
    }
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
    const intensitySlider = screen.getByRole("slider", { name: "修图力度" });
    expect(intensitySlider).toBeVisible();
    expect(intensitySlider).toHaveAttribute("min", "0");
    expect(intensitySlider).toHaveAttribute("max", "100");
    expect(intensitySlider).toHaveAttribute("step", "1");
    expect(intensitySlider).toHaveValue("55");
    expect(screen.getByText("自然", { exact: true })).toBeVisible();
    expect(screen.getByText("明显", { exact: true })).toBeVisible();
    expect(screen.queryByText("姿态", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("置信度 92%")).toBeVisible();
    expect(screen.getByTestId("region-highlight-face-1")).toHaveAttribute(
      "aria-label",
      "区域 face-1",
    );
    expect(screen.getByLabelText("自然变好看")).toBeVisible();
    expect(screen.getByLabelText("修复小瑕疵")).toBeVisible();
    expect(screen.getByLabelText("整理细节")).toBeVisible();
  });

  it("saves a continuous intensity value without snapping to a preset", async () => {
    const user = userEvent.setup();
    const client = makeClient();
    render(<App apiClient={client} />);

    await user.type(screen.getByLabelText("邀请 token"), "invite-in-memory");
    await user.click(screen.getByRole("button", { name: "开始我的修图" }));
    await user.upload(
      screen.getByLabelText("选择 JPG 或 PNG 原图"),
      new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "开始看看哪里可以更好" }));
    const intensitySlider = await screen.findByRole("slider", { name: "修图力度" });

    fireEvent.change(intensitySlider, { target: { value: "73" } });
    expect(intensitySlider).toHaveValue("73");
    await user.click(screen.getByRole("switch", { name: "脸部状态中的面部处理开关" }));
    await user.click(screen.getByRole("button", { name: "保存这份选择" }));

    await waitFor(() => expect(client.savePlan).toHaveBeenCalledTimes(1));
    expect(client.savePlan.mock.calls[0][1]).toMatchObject({
      intensity: 73,
      operations: [expect.objectContaining({ intensity: 73 })],
    });
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
      await user.click(screen.getByRole("button", { name: "开始我的修图" }));
      await user.upload(
        screen.getByLabelText("选择 JPG 或 PNG 原图"),
        new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" }),
      );
      await user.click(screen.getByRole("button", { name: "开始看看哪里可以更好" }));

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
    await user.click(screen.getByRole("button", { name: "开始我的修图" }));
    await user.upload(
      screen.getByLabelText("选择 JPG 或 PNG 原图"),
      new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "开始看看哪里可以更好" }));

    const retryButton = await screen.findByRole("button", { name: "再试一次" });
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
    await user.click(screen.getByRole("button", { name: "开始我的修图" }));
    await user.upload(
      screen.getByLabelText("选择 JPG 或 PNG 原图"),
      new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "开始看看哪里可以更好" }));
    await screen.findByRole("heading", { name: "看看哪里可以更好" });

    const faceSwitch = screen.getByRole("switch", { name: "脸部状态中的面部处理开关" });
    if (!(faceSwitch as HTMLInputElement).checked) await user.click(faceSwitch);
    await user.click(screen.getByRole("button", { name: "生成我的预览" }));

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
    await user.click(screen.getByRole("button", { name: "开始我的修图" }));
    await user.upload(
      screen.getByLabelText("选择 JPG 或 PNG 原图"),
      new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "开始看看哪里可以更好" }));
    await screen.findByRole("heading", { name: "看看哪里可以更好" });

    const faceSwitch = screen.getByRole("switch", { name: "脸部状态中的面部处理开关" });
    if (!(faceSwitch as HTMLInputElement).checked) await user.click(faceSwitch);
    await user.click(screen.getByRole("button", { name: "生成我的预览" }));
    const retryButton = await screen.findByRole("button", { name: "重试生成" });

    expect(client.savePlan).toHaveBeenCalledTimes(1);
    expect(faceSwitch).toBeDisabled();
    expect(screen.getByLabelText("自然变好看")).toBeDisabled();
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
    await user.click(screen.getByRole("button", { name: "开始我的修图" }));
    await user.upload(
      screen.getByLabelText("选择 JPG 或 PNG 原图"),
      new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "开始看看哪里可以更好" }));
    await screen.findByRole("heading", { name: "看看哪里可以更好" });

    const faceSwitch = screen.getByRole("switch", { name: "脸部状态中的面部处理开关" });
    if (!(faceSwitch as HTMLInputElement).checked) await user.click(faceSwitch);
    await user.click(screen.getByRole("button", { name: "生成我的预览" }));
    const retryButton = await screen.findByRole("button", { name: "重试生成" });
    await user.click(retryButton);

    await waitFor(() => expect(client.startGeneration).toHaveBeenCalledTimes(2));
    expect(client.startGeneration.mock.calls[0][2]).toBe(
      client.startGeneration.mock.calls[1][2],
    );
  });

  it("syncs a provider failure task back into App and shows retryable progress", async () => {
    const user = userEvent.setup();
    const failedTask: TaskView = {
      ...plannedTask,
      status: "failed",
      error: {
        code: "PROVIDER_ERROR",
        message: "图像服务暂时不可用，请稍后重试。",
        retryable: true,
      },
    };
    const client = makeClient(plannedTask);
    client.getTask
      .mockResolvedValueOnce(plannedTask)
      .mockResolvedValueOnce(plannedTask)
      .mockResolvedValueOnce(failedTask);
    client.startGeneration.mockRejectedValueOnce(new Error("provider rejected"));
    render(<App apiClient={client} />);

    await user.type(screen.getByLabelText("邀请 token"), "invite-in-memory");
    await user.click(screen.getByRole("button", { name: "开始我的修图" }));
    await user.upload(
      screen.getByLabelText("选择 JPG 或 PNG 原图"),
      new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "开始看看哪里可以更好" }));
    await screen.findByRole("heading", { name: "看看哪里可以更好" });

    const faceSwitch = screen.getByRole("switch", { name: "脸部状态中的面部处理开关" });
    if (!(faceSwitch as HTMLInputElement).checked) await user.click(faceSwitch);
    await user.click(screen.getByRole("button", { name: "生成我的预览" }));

    await waitFor(() => expect(screen.getAllByText("处理失败").length).toBeGreaterThan(0));
    expect(
      screen.getAllByText("图像服务暂时不可用，请稍后重试。").length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "重试生成" })).toBeEnabled();
  });

  it("disables plan saving for a failed task that already has a plan", async () => {
    const user = userEvent.setup();
    const client = makeClient({
      ...plannedTask,
      status: "failed",
      error: { code: "GENERATION_FAILED", message: "generation failed", retryable: true },
    });
    render(<App apiClient={client} />);

    await user.type(screen.getByLabelText("邀请 token"), "invite-in-memory");
    await user.click(screen.getByRole("button", { name: "开始我的修图" }));
    await user.upload(
      screen.getByLabelText("选择 JPG 或 PNG 原图"),
      new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "开始看看哪里可以更好" }));
    await screen.findByRole("heading", { name: "看看哪里可以更好" });

    expect(screen.getByRole("button", { name: "保存这份选择" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重试生成" })).toBeEnabled();
    expect(client.savePlan).not.toHaveBeenCalled();
  });

  it("returns to the invite gate when the API rejects the invite", async () => {
    const user = userEvent.setup();
    const client = makeClient();
    client.createTask.mockRejectedValueOnce(
      new ApiError(
        "INVALID_INVITE",
        "Traceback: provider response body storage://private",
        401,
      ),
    );
    render(<App apiClient={client} />);

    await user.type(screen.getByLabelText("邀请 token"), "invalid-invite");
    await user.click(screen.getByRole("button", { name: "开始我的修图" }));
    await user.upload(
      screen.getByLabelText("选择 JPG 或 PNG 原图"),
      new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "开始看看哪里可以更好" }));

    expect(await screen.findByRole("heading", { name: "进入我的写真工作室" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("邀请 token 无效，请重新输入。");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Traceback");
    expect(screen.getByLabelText("邀请 token")).toBeVisible();
  });

  it("opens the result review interface from a validation review recovery action", async () => {
    const user = userEvent.setup();
    const client = makeClient({
      ...plannedTask,
      status: "failed",
      error: {
        code: "VALIDATION_REVIEW",
        message: "候选图需要人工复核，请查看结果后再决定。",
        retryable: false,
      },
      versions: [
        {
          id: "version-1",
          assetUrl: {
            kind: "version",
            url: "https://storage.example/version-1.png",
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
          createdAt: "2026-08-31T00:02:00Z",
          validation: { face_identity: "pass" },
          selected: true,
        },
      ],
    });
    render(<App apiClient={client} />);

    await user.type(screen.getByLabelText("邀请 token"), "invite-in-memory");
    await user.click(screen.getByRole("button", { name: "开始我的修图" }));
    await user.upload(
      screen.getByLabelText("选择 JPG 或 PNG 原图"),
      new File(["jpeg-data"], "cos-photo.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "开始看看哪里可以更好" }));
    await screen.findByRole("heading", { name: "看看哪里可以更好" });

    await user.click(screen.getAllByRole("button", { name: "查看复核结果" })[0]);

    expect(await screen.findByRole("heading", { name: "选一张最像你的" })).toBeVisible();
    expect(screen.getByTestId("before-after-comparison")).toBeVisible();
  });
});
