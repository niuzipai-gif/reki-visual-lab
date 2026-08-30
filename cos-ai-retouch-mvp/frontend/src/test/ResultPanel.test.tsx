// @vitest-environment jsdom
import "./setup";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ResultPanel from "../components/ResultPanel";
import type { ApiClient } from "../app/api";
import type { TaskView, VersionView } from "../domain/task";

const originalUrl = "https://storage.local/tasks/task-1/original/cos.jpg";

function version(id: string, label: string, selected = false): VersionView {
  return {
    id,
    assetUrl: {
      kind: "version",
      url: `https://storage.local/tasks/task-1/versions/${id}.png`,
      expiresAt: "2026-09-01T00:00:00Z",
    },
    createdAt: "2026-08-31T01:00:00Z",
    validation: {
      face_identity: "pass",
      pose_and_composition: "pass",
      hands_and_costume: label === "候选 1" ? "review" : "pass",
      background_geometry: "pass",
      lighting_and_noise: label === "候选 1" ? "review" : "pass",
    },
    selected,
  };
}

function taskWithVersions(versions: VersionView[]): TaskView {
  return {
    taskId: "task-1",
    status: "succeeded",
    createdAt: "2026-08-31T00:00:00Z",
    updatedAt: "2026-08-31T01:00:00Z",
    originalAssetUrl: {
      kind: "original",
      url: originalUrl,
      expiresAt: "2026-09-01T00:00:00Z",
    },
    maskAssetUrl: null,
    analysis: [],
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
    versions,
    error: null,
  };
}

function client(): ApiClient {
  return {
    createTask: vi.fn(),
    uploadOriginal: vi.fn(),
    startAnalysis: vi.fn(),
    getTask: vi.fn(),
    savePlan: vi.fn(),
    startGeneration: vi.fn().mockResolvedValue(undefined),
    getDownloadUrl: vi.fn().mockResolvedValue("https://download.local/result.png"),
  };
}

describe("ResultPanel", () => {
  it("keeps the original on the left, limits candidates to two, and exposes validation labels", () => {
    const task = taskWithVersions([
      version("v1", "候选 1"),
      version("v2", "候选 2"),
      version("v3", "候选 3"),
    ]);

    render(
      <ResultPanel
        task={task}
        originalUrl={originalUrl}
        inviteToken="invite-demo"
        apiClient={client()}
        onTaskUpdate={vi.fn()}
      />,
    );

    const comparison = screen.getByTestId("before-after-comparison");
    expect(comparison.firstElementChild).toHaveAttribute("data-testid", "comparison-before");
    expect(screen.getByTestId("comparison-before")).toHaveAttribute("data-asset-kind", "original");
    expect(screen.getByTestId("comparison-before")).toHaveAttribute("src", originalUrl);
    expect(screen.getAllByTestId(/candidate-card-/)).toHaveLength(2);
    expect(screen.getByText("手部与服装：需复核")).toBeVisible();
    expect(screen.getByText("光线与噪点：需复核")).toBeVisible();
  });

  it("supports dragging the comparison divider and changing preview zoom", () => {
    const task = taskWithVersions([version("v1", "候选 1")]);
    render(
      <ResultPanel
        task={task}
        originalUrl={originalUrl}
        inviteToken="invite-demo"
        apiClient={client()}
        onTaskUpdate={vi.fn()}
      />,
    );

    const divider = screen.getByRole("slider", { name: "对比位置" });
    const zoom = screen.getByRole("slider", { name: "预览缩放" });
    fireEvent.change(divider, { target: { value: "68" } });
    fireEvent.change(zoom, { target: { value: "125" } });

    expect(divider).toHaveValue("68");
    expect(zoom).toHaveValue("125");
    expect(screen.getByTestId("comparison-after")).toHaveStyle({ transform: "scale(1.25)" });
  });

  it("keeps, regenerates, restores the original, and downloads through the task API", async () => {
    const user = userEvent.setup();
    const api = client();
    const onTaskUpdate = vi.fn();
    const onRestoreOriginal = vi.fn();
    const task = taskWithVersions([version("v1", "候选 1"), version("v2", "候选 2")]);
    vi.mocked(api.getTask).mockResolvedValue(task);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <ResultPanel
        task={task}
        originalUrl={originalUrl}
        inviteToken="invite-demo"
        apiClient={api}
        onTaskUpdate={onTaskUpdate}
        onRestoreOriginal={onRestoreOriginal}
        getOperationKey={() => "generate-once"}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "保留此版本" })[0]);
    expect(onTaskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      versions: expect.arrayContaining([
        expect.objectContaining({ id: "v1", selected: true }),
      ]),
    }));

    await user.click(screen.getByRole("button", { name: "重新生成" }));
    await waitFor(() => expect(api.startGeneration).toHaveBeenCalledWith("task-1", "invite-demo", "generate-once"));
    expect(onTaskUpdate).toHaveBeenCalledWith(task);

    await user.click(screen.getByRole("button", { name: "恢复原图" }));
    expect(onRestoreOriginal).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("comparison-before")).toHaveAttribute("src", originalUrl);

    await user.click(screen.getByRole("button", { name: "下载当前结果" }));
    await waitFor(() => expect(api.getDownloadUrl).toHaveBeenCalledWith("task-1", "invite-demo"));
    expect(openSpy).toHaveBeenCalledWith("https://download.local/result.png", "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });
});
