// @vitest-environment jsdom
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TaskProgress from "../components/TaskProgress";

describe("TaskProgress recovery states", () => {
  it.each([
    ["INVALID_INVITE", "邀请 token 无效，请重新输入。", "重新输入邀请 token", "invite"],
    ["UNSUPPORTED_IMAGE", "图片格式不受支持，请上传 JPG 或 PNG。", "重新上传图片", "reupload"],
    ["UPLOAD_FAILED", "原图上传失败，请重试或重新上传。", "重试上传", "retry"],
    ["ANALYSIS_FAILED", "原图分析失败，请重试分析。", "重试分析", "retry"],
    ["TASK_NOT_READY", "任务还未准备好，请回到上一步完成确认。", "回到上一步", "back"],
    ["PROVIDER_TIMEOUT", "图片处理超时，请重试。", "重试处理", "retry"],
    ["PROVIDER_QUOTA", "图片处理额度暂时不足，请稍后重试。", "稍后重试", "retry"],
    ["PROVIDER_ERROR", "图像服务暂时不可用，请稍后重试。", "重试处理", "retry"],
    ["VALIDATION_REVIEW", "候选图需要人工复核，请查看结果后再决定。", "查看复核结果", "review"],
  ])("renders a recovery action for %s", async (code, message, actionLabel, action) => {
    const onRecover = vi.fn();

    renderProgress({
      code,
      message: "Traceback provider body storage://private",
      retryable: true,
    }, onRecover);

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("alert")).not.toHaveTextContent("Traceback");
    fireEvent.click(screen.getByRole("button", { name: actionLabel }));
    expect(onRecover).toHaveBeenCalledWith(action);
  });

  it("offers re-upload when an asset has expired", async () => {
    const onRecover = vi.fn();
    renderProgress({ code: "TASK_EXPIRED", message: "unsafe", retryable: false }, onRecover, "expired");

    expect(screen.getByText("任务已过期，请重新上传原图。")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重新上传原图" }));
    expect(onRecover).toHaveBeenCalledWith("reupload");
  });
});

function renderProgress(
  error: { code: string; message: string; retryable: boolean },
  onRecover: (action: string) => void,
  status: "failed" | "expired" = "failed",
) {
  return renderWithImport({ status, error, onRecover });
}

function renderWithImport(props: Parameters<typeof TaskProgress>[0]) {
  return render(<TaskProgress {...props} />);
}
