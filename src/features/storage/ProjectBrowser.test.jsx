import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ProjectBrowser } from "./ProjectBrowser.jsx";

function metadata(overrides = {}) {
  return {
    id: "alpha",
    name: "银黄实验",
    updatedAt: Date.now() - 30_000,
    width: 1080,
    height: 1350,
    layerCount: 3,
    sourceStatus: "available",
    revision: 1,
    ...overrides,
  };
}

function store(overrides = {}) {
  return {
    listProjects: vi.fn().mockResolvedValue([metadata()]),
    loadProject: vi.fn().mockResolvedValue({
      project: { id: "alpha", name: "银黄实验" },
      sourceResource: new Blob(["photo"], { type: "image/png" }),
      revision: 1,
    }),
    saveProject: vi.fn().mockResolvedValue(undefined),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("ProjectBrowser", () => {
  test("shows loading, then recent projects without auto-opening one", async () => {
    let resolveProjects;
    const storage = store({
      listProjects: vi.fn(
        () => new Promise((resolve) => {
          resolveProjects = resolve;
        }),
      ),
    });
    const onOpen = vi.fn();

    render(
      <ProjectBrowser
        store={storage}
        onOpen={onOpen}
        onNewImage={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("正在读取最近项目");

    resolveProjects([
      metadata({ id: "new", name: "最新项目", updatedAt: 300 }),
      metadata({ id: "old", name: "旧项目", updatedAt: 100 }),
    ]);

    const items = await screen.findAllByRole("listitem");
    expect(within(items[0]).getByText("最新项目")).toBeInTheDocument();
    expect(within(items[1]).getByText("旧项目")).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("renders compact metadata, absolute time, source-missing state, and opens on choice", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn().mockResolvedValue(undefined);
    render(
      <ProjectBrowser
        store={store({
          listProjects: vi.fn().mockResolvedValue([
            metadata({ sourceStatus: "missing", updatedAt: 1_700_000_000_000 }),
          ]),
        })}
        onOpen={onOpen}
        onNewImage={vi.fn()}
      />,
    );

    const item = await screen.findByRole("listitem");
    expect(item).toHaveTextContent("1080 × 1350");
    expect(item).toHaveTextContent("3 个图层");
    expect(item).toHaveTextContent("原始照片缺失");
    expect(within(item).getByRole("time")).toHaveAttribute("dateTime");
    expect(within(item).getByRole("time")).toHaveAttribute("title");

    await user.click(within(item).getByRole("button", { name: "打开 银黄实验" }));
    expect(onOpen).toHaveBeenCalledWith("alpha");
  });

  test("renames by loading and resaving the real project and refreshes the list", async () => {
    const user = userEvent.setup();
    const storage = store();
    vi.spyOn(window, "prompt").mockReturnValue("新的名字");
    render(
      <ProjectBrowser
        store={storage}
        onOpen={vi.fn()}
        onNewImage={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "重命名 银黄实验" }),
    );

    expect(storage.loadProject).toHaveBeenCalledWith("alpha");
    expect(storage.saveProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: "alpha", name: "新的名字" }),
      undefined,
      expect.objectContaining({
        expectedRevision: 1,
        sourceMode: "preserve",
      }),
    );
    expect(storage.listProjects).toHaveBeenCalledTimes(2);
    window.prompt.mockRestore();
  });

  test("deletes only after confirmation and refreshes", async () => {
    const user = userEvent.setup();
    const storage = store();
    const confirmation = vi.spyOn(window, "confirm");
    confirmation.mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(
      <ProjectBrowser
        store={storage}
        onOpen={vi.fn()}
        onNewImage={vi.fn()}
      />,
    );
    const remove = await screen.findByRole("button", {
      name: "删除 银黄实验",
    });

    await user.click(remove);
    expect(storage.deleteProject).not.toHaveBeenCalled();
    await user.click(remove);
    expect(storage.deleteProject).toHaveBeenCalledWith("alpha", 1);
    expect(storage.listProjects).toHaveBeenCalledTimes(2);
    confirmation.mockRestore();
  });

  test("supports empty, unavailable, corrupt-open, and new-image states", async () => {
    const user = userEvent.setup();
    const onNewImage = vi.fn();
    const view = render(
      <ProjectBrowser
        store={store({ listProjects: vi.fn().mockResolvedValue([]) })}
        onOpen={vi.fn()}
        onNewImage={onNewImage}
      />,
    );
    expect(await screen.findByText("还没有本机项目")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新图片" }));
    expect(onNewImage).toHaveBeenCalled();

    view.rerender(
      <ProjectBrowser
        store={store({
          listProjects: vi.fn().mockRejectedValue({
            code: "STORAGE_UNAVAILABLE",
          }),
        })}
        onOpen={vi.fn()}
        onNewImage={onNewImage}
      />,
    );
    expect(
      await screen.findByText("本机项目存储暂时不可用"),
    ).toBeInTheDocument();

    const corruptOpen = vi.fn().mockRejectedValue({
      code: "CORRUPT_PROJECT",
    });
    view.rerender(
      <ProjectBrowser
        store={store()}
        onOpen={corruptOpen}
        onNewImage={onNewImage}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "打开 银黄实验" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("项目数据已损坏"),
    );
  });

  test("loads thumbnail blobs lazily and revokes their object URLs", async () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:thumbnail");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const storage = store({
      listProjects: vi.fn().mockResolvedValue([
        metadata({ thumbnailAvailable: true }),
      ]),
      loadThumbnail: vi
        .fn()
        .mockResolvedValue(new Blob(["thumb"], { type: "image/webp" })),
    });
    const view = render(
      <ProjectBrowser
        store={storage}
        onOpen={vi.fn()}
        onNewImage={vi.fn()}
      />,
    );

    const image = await screen.findByRole("img", {
      name: "银黄实验 缩略图",
    });
    expect(storage.loadThumbnail).toHaveBeenCalledWith("alpha");
    expect(image).toHaveAttribute("src", "blob:thumbnail");
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:thumbnail");
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  test("tracks overlapping project operations independently with a busy set", async () => {
    const user = userEvent.setup();
    const pending = new Promise(() => {});
    render(
      <ProjectBrowser
        store={store({
          listProjects: vi.fn().mockResolvedValue([
            metadata({ id: "a", name: "A" }),
            metadata({ id: "b", name: "B" }),
          ]),
        })}
        onOpen={() => pending}
        onNewImage={vi.fn()}
      />,
    );
    const openA = await screen.findByRole("button", { name: "打开 A" });
    const openB = screen.getByRole("button", { name: "打开 B" });
    await user.click(openA);
    await user.click(openB);
    expect(openA).toBeDisabled();
    expect(openB).toBeDisabled();
  });

  test("refreshes recent projects after a cross-tab storage notification", async () => {
    let subscriber;
    const storage = store({
      subscribeProjectChanges: vi.fn((callback) => {
        subscriber = callback;
        return () => {};
      }),
    });
    render(
      <ProjectBrowser
        store={storage}
        onOpen={vi.fn()}
        onNewImage={vi.fn()}
      />,
    );
    await screen.findByText("银黄实验");
    await subscriber({ type: "saved", id: "elsewhere", revision: 2 });
    await waitFor(() =>
      expect(storage.listProjects).toHaveBeenCalledTimes(2),
    );
  });
});
