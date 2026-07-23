import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ImportPanel } from "./ImportPanel.jsx";

function imageFile({
  name = "portrait.png",
  type = "image/png",
  size = 100,
} = {}) {
  const file = new File(["photo"], name, { type });
  Object.defineProperty(file, "size", { configurable: true, value: size });
  return file;
}

describe("ImportPanel", () => {
  test("offers an accessible local-only file chooser for launch formats", async () => {
    const user = userEvent.setup();
    render(<ImportPanel onProject={vi.fn()} decode={vi.fn()} />);

    const input = screen.getByLabelText("选择照片");
    const chooser = screen.getByRole("button", { name: "选择照片" });
    const dropZone = screen.getByRole("button", {
      name: "拖放照片或选择照片",
    });
    const click = vi.spyOn(input, "click");

    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(screen.getByText("照片仅在本机处理")).toBeInTheDocument();
    expect(screen.queryByText(/登录|注册/)).not.toBeInTheDocument();

    await user.click(chooser);
    expect(click).toHaveBeenCalledTimes(1);
    dropZone.focus();
    await user.keyboard("{Enter}");
    expect(click).toHaveBeenCalledTimes(2);
  });

  test("shows validation errors without decoding invalid files", async () => {
    const decode = vi.fn();
    render(<ImportPanel onProject={vi.fn()} decode={decode} />);
    const input = screen.getByLabelText("选择照片");

    fireEvent.change(input, {
      target: {
        files: [imageFile({ name: "clip.mp4", type: "video/mp4" })],
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "请选择 JPG、PNG 或 WebP 图片",
    );
    expect(decode).not.toHaveBeenCalled();
  });

  test("loads a decoded file into an exact-sized project", async () => {
    const source = { width: 4032, height: 3024 };
    const dispose = vi.fn();
    let resolveDecode;
    const decode = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDecode = resolve;
        }),
    );
    const onProject = vi.fn();
    const file = imageFile({ name: "coser.webp", type: "image/webp" });
    render(<ImportPanel onProject={onProject} decode={decode} />);

    await userEvent.upload(screen.getByLabelText("选择照片"), file);

    expect(screen.getByRole("status")).toHaveTextContent("正在读取照片");
    resolveDecode({
      source,
      width: 4032,
      height: 3024,
      kind: "bitmap",
      dispose,
    });
    await waitFor(() => expect(onProject).toHaveBeenCalledTimes(1));
    const project = onProject.mock.calls[0][0];
    expect(project.canvas).toEqual({
      width: 4032,
      height: 3024,
      backgroundVisible: true,
    });
    expect(project.image).toMatchObject({
      source,
      width: 4032,
      height: 3024,
      kind: "bitmap",
      fileName: "coser.webp",
      type: "image/webp",
      dispose,
    });
    expect(screen.getByRole("status")).toHaveTextContent("照片已准备好");
  });

  test("supports desktop drop and reports decode failures", async () => {
    const decode = vi.fn().mockRejectedValue(new Error("损坏的图片"));
    render(<ImportPanel onProject={vi.fn()} decode={decode} />);
    const dropZone = screen.getByRole("button", {
      name: "拖放照片或选择照片",
    });
    const file = imageFile();

    fireEvent.dragOver(dropZone, {
      dataTransfer: { files: [file], types: ["Files"] },
    });
    expect(dropZone).toHaveAttribute("data-dragging", "true");
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("损坏的图片");
    expect(dropZone).toHaveAttribute("data-dragging", "false");
  });

  test("publishes only the newest decode and disposes an out-of-order result", async () => {
    const pending = new Map();
    const decode = vi.fn(
      (file) =>
        new Promise((resolve) => {
          pending.set(file.name, resolve);
        }),
    );
    const onProject = vi.fn();
    render(<ImportPanel onProject={onProject} decode={decode} />);
    const input = screen.getByLabelText("选择照片");
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();

    fireEvent.change(input, {
      target: { files: [imageFile({ name: "first.png" })] },
    });
    fireEvent.change(input, {
      target: { files: [imageFile({ name: "second.png" })] },
    });
    pending.get("second.png")({
      source: { width: 900, height: 600 },
      width: 900,
      height: 600,
      kind: "bitmap",
      dispose: secondDispose,
    });
    await waitFor(() => expect(onProject).toHaveBeenCalledTimes(1));
    expect(onProject.mock.calls[0][0].image.fileName).toBe("second.png");

    pending.get("first.png")({
      source: { width: 800, height: 600 },
      width: 800,
      height: 600,
      kind: "bitmap",
      dispose: firstDispose,
    });
    await waitFor(() => expect(firstDispose).toHaveBeenCalledTimes(1));
    expect(secondDispose).not.toHaveBeenCalled();
    expect(onProject).toHaveBeenCalledTimes(1);
  });

  test("disposes a decode that resolves after the panel unmounts", async () => {
    let resolveDecode;
    const dispose = vi.fn();
    const decode = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveDecode = resolve;
        }),
    );
    const onProject = vi.fn();
    const view = render(<ImportPanel onProject={onProject} decode={decode} />);

    fireEvent.change(screen.getByLabelText("选择照片"), {
      target: { files: [imageFile({ name: "late.png" })] },
    });
    view.unmount();
    resolveDecode({
      source: { width: 800, height: 600 },
      width: 800,
      height: 600,
      kind: "bitmap",
      dispose,
    });

    await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
    expect(onProject).not.toHaveBeenCalled();
  });
});
