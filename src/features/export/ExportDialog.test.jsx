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
vi.mock("./exportImage.js", () => ({
  createExportPlan: () => ({ width: 100, height: 120, includeBackground: true, estimatedBytes: 48_000 }),
  isSafeExport: () => true,
  decodeOriginalSource: vi.fn(async () => ({ source: { width: 100, height: 120 }, dispose: vi.fn() })),
  renderProjectToBlob: (...args) => renderBlob(...args),
}));

import { ExportDialog } from "./ExportDialog.jsx";

describe("ExportDialog export lifecycle", () => {
  beforeEach(() => renderBlob.mockReset());
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
});
