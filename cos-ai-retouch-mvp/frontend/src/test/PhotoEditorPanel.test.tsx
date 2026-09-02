// @vitest-environment jsdom
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PhotoEditorPanel from "../components/PhotoEditorPanel";

const sourceUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='80'%3E%3Crect width='120' height='80' fill='%23f1c8d8'/%3E%3C/svg%3E";

function renderEditor() {
  return render(
    <PhotoEditorPanel
      filename="miku-cos.jpg"
      sourceUrl={sourceUrl}
      onBack={vi.fn()}
    />,
  );
}

describe("PhotoEditorPanel", () => {
  it("opens a browser-only COS editor with real retouch modules and layers", () => {
    renderEditor();

    expect(screen.getByRole("heading", { name: "COS 修图工作台" })).toBeVisible();
    expect(screen.getByText("纯网页操作 · 原图不覆盖 · PSD 可导出")).toBeVisible();
    for (const label of ["面部精修", "发丝整理", "服装修复", "身形边缘", "背景清理", "光影重塑", "风格质感"]) {
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    }
    expect(screen.getByRole("heading", { name: "图层" })).toBeVisible();
    expect(screen.getByText("原图（锁定）")).toBeVisible();
    expect(screen.getAllByText("光影与色彩").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "导出 PSD" })).toBeVisible();
  });

  it("changes a real adjustment value and keeps the edit in the light layer", () => {
    renderEditor();

    const exposure = screen.getByRole("slider", { name: "曝光" });
    fireEvent.change(exposure, { target: { value: "34" } });

    expect(exposure).toHaveValue("34");
    expect(screen.getByText("已记录在「光影与色彩」图层")).toBeVisible();
  });

  it("adds a bounded COS module layer and can hide it without touching the original", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "发丝整理" }));

    expect(screen.getAllByText("发丝整理 · 待云端 AI").length).toBeGreaterThan(0);
    const visibility = screen.getByRole("checkbox", { name: "显示图层: 发丝整理 · 待云端 AI" });
    expect(visibility).toBeChecked();
    fireEvent.click(visibility);
    expect(visibility).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "显示图层: 原图（锁定）" })).toBeChecked();
  });

  it("switches to mask mode and exposes brush controls", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "画笔蒙版" }));

    expect(screen.getByText("蒙版模式：画出要处理的地方")).toBeVisible();
    expect(screen.getByRole("slider", { name: "蒙版画笔大小" })).toBeVisible();
    expect(screen.getByRole("button", { name: "撤回上一笔" })).toBeDisabled();
  });

  it("restores the original and calls the back action", () => {
    const onBack = vi.fn();
    render(<PhotoEditorPanel filename="miku.jpg" sourceUrl={sourceUrl} onBack={onBack} />);

    fireEvent.change(screen.getByRole("slider", { name: "曝光" }), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "恢复原图" }));
    expect(screen.getByRole("slider", { name: "曝光" })).toHaveValue("0");
    fireEvent.click(screen.getByRole("button", { name: "返回照片选择" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
