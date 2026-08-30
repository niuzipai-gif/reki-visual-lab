import "./setup";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const taskWire = {
  task_id: "task-123",
  status: "awaiting_confirmation",
  created_at: "2026-08-31T00:00:00Z",
  updated_at: "2026-08-31T00:01:00Z",
  original_asset_url: {
    kind: "original",
    url: "https://storage.example/original.jpg",
    expires_at: "2026-08-31T01:00:00Z",
  },
  mask_asset_url: null,
  analysis: [
    {
      id: "face-card",
      category: "face",
      title: "面部细节",
      summary: "保留角色辨识度，轻微清理肤质。",
      confidence: 0.92,
      risk: "不要改变面部身份。",
      enabled: false,
      regions: [],
    },
  ],
  plan: null,
  versions: [],
  error: null,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("typed task API client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", "https://render.example");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("creates a task with the invite in the body and maps task_id", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        task_id: "task-123",
        upload_url: "https://storage.example/upload",
        expires_at: "2026-08-31T01:00:00Z",
        status: "uploading",
      }),
    );

    const { createTask } = await import("../app/api");
    const task = await createTask(
      {
        filename: "cos-photo.png",
        contentType: "image/png",
        byteSize: 1200,
      },
      "invite-in-memory",
    );

    expect(task).toMatchObject({
      taskId: "task-123",
      status: "uploading",
      uploadUrl: "https://storage.example/upload",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://render.example/api/v1/tasks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          invite_token: "invite-in-memory",
          filename: "cos-photo.png",
          content_type: "image/png",
          byte_size: 1200,
        }),
      }),
    );
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
      "X-Invite-Token",
    );
  });

  it("sends the invite header on every subsequent task request", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(taskWire))
      .mockResolvedValueOnce(jsonResponse(taskWire))
      .mockResolvedValueOnce(jsonResponse(taskWire))
      .mockResolvedValueOnce(jsonResponse(taskWire))
      .mockResolvedValueOnce(
        jsonResponse({
          url: "https://storage.example/download",
          expires_at: "2026-08-31T01:00:00Z",
        }),
      );

    const { getDownloadUrl, getTask, savePlan, startAnalysis, startGeneration } =
      await import("../app/api");
    const inviteToken = "invite-in-memory";

    expect(await startAnalysis("task-123", inviteToken, "analyze-key")).toBeUndefined();
    await getTask("task-123", inviteToken);
    expect(await savePlan("task-123", { goals: [], operations: [] }, inviteToken)).toBeUndefined();
    expect(await startGeneration("task-123", inviteToken, "generate-key")).toBeUndefined();
    expect(await getDownloadUrl("task-123", inviteToken)).toBe(
      "https://storage.example/download",
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init.headers).get("X-Invite-Token")).toBe(inviteToken);
    }
  });

  it("adds idempotency keys to analyze and generate requests", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(taskWire))
      .mockResolvedValueOnce(jsonResponse(taskWire));

    const { startAnalysis, startGeneration } = await import("../app/api");
    expect(await startAnalysis("task-123", "invite-in-memory", "analyze-key")).toBeUndefined();
    expect(await startGeneration("task-123", "invite-in-memory", "generate-key")).toBeUndefined();

    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("Idempotency-Key")).toBe("analyze-key");
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("Idempotency-Key")).toBe("generate-key");
  });

  it("uploads only to the server-issued signed URL without forwarding the invite", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const { uploadOriginal } = await import("../app/api");
    const file = new File(["png-data"], "cos-photo.png", {
      type: "image/png",
    });

    await uploadOriginal("https://storage.example/signed-upload", file);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.example/signed-upload",
      expect.objectContaining({
        method: "PUT",
        body: file,
        headers: { "Content-Type": "image/png" },
      }),
    );
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
      "X-Invite-Token",
    );
  });

  it("maps failed provider responses to a user-safe error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "PROVIDER_ERROR",
            message: '{"prompt":"private provider payload"}',
            retryable: true,
          },
        },
        502,
      ),
    );

    const { getTask } = await import("../app/api");
    await expect(getTask("task-123", "invite-in-memory")).rejects.toMatchObject(
      {
        code: "PROVIDER_ERROR",
        message: "图片处理暂时不可用，请稍后重试。",
        retryable: true,
      },
    );
  });

  it("maps an HTTP 200 failed task payload to a user-readable error state", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...taskWire,
        status: "failed",
        error: {
          code: "PROVIDER_ERROR",
          message: '{"prompt":"private provider payload"}',
          retryable: true,
        },
      }),
    );

    const { getTask } = await import("../app/api");
    const task = await getTask("task-123", "invite-in-memory");

    expect(task.status).toBe("failed");
    expect(task.error).toMatchObject({
      code: "PROVIDER_ERROR",
      message: "图片处理暂时不可用，请稍后重试。",
      retryable: true,
    });
  });
});
