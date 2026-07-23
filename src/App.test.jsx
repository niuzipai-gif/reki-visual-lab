import React, { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProject } from "./domain/project.js";
import { App } from "./App.jsx";

vi.mock("./features/storage/thumbnail.js", () => ({
  createProjectThumbnail: (...args) =>
    globalThis.__thumbnailFactory?.(...args) ?? Promise.resolve(null),
}));

vi.mock("./features/import/ImportPanel.jsx", () => ({
  ImportPanel({ onProject, children }) {
    return (
      <main>
        <button
          type="button"
          onClick={() =>
            onProject({
              ...createProject({ width: 800, height: 600 }),
              id: "imported",
              name: "Imported",
              image: {
                source: { width: 800, height: 600 },
                originalFile: new Blob(["import"], { type: "image/png" }),
                dispose: globalThis.__importDispose,
              },
            })
          }
        >
          测试导入
        </button>
        {children}
      </main>
    );
  },
}));

vi.mock("./Workbench.jsx", () => ({
  default: function MockWorkbench({
    initialDemoProject,
    onProjectChange,
    onReplacePhoto,
    saveStatus,
  }) {
    return (
      <main aria-label="测试工作台">
        <span data-testid="project-name">{initialDemoProject.name}</span>
        <span data-testid="source-kind">
          {initialDemoProject.image ? "available" : "missing"}
        </span>
        <span>{saveStatus === "saving" ? "保存中" : saveStatus === "saved" ? "已保存" : saveStatus === "saved-pruned" ? "已保存，已清理最旧项目" : saveStatus === "error" ? "保存失败" : saveStatus === "conflict" ? "保存冲突" : ""}</span>
        <button
          type="button"
          onClick={() =>
            onProjectChange({
              ...initialDemoProject,
              name: "edit-one",
              layers: [{ id: "one" }],
            })
          }
        >
          编辑一次
        </button>
        <button
          type="button"
          onClick={() => {
            onProjectChange({
              ...initialDemoProject,
              name: "stale",
              layers: [{ id: "stale" }],
            });
            onProjectChange({
              ...initialDemoProject,
              name: "latest",
              layers: [{ id: "latest" }],
            });
          }}
        >
          快速编辑
        </button>
        <button type="button">切换临时面板</button>
        <button
          type="button"
          onClick={() =>
            onReplacePhoto(
              new Blob(["new replacement"], { type: "image/png" }),
            )
          }
        >
          替换测试照片
        </button>
        {!initialDemoProject.image ? (
          <button
            type="button"
            onClick={() =>
              onReplacePhoto(new Blob(["replacement"], { type: "image/png" }))
            }
          >
            添加或替换照片
          </button>
        ) : null}
      </main>
    );
  },
}));

function savedProject(overrides = {}) {
  return {
    ...createProject({ width: 1080, height: 1350 }),
    id: "saved",
    name: "Saved",
    image: { fileName: "saved.png", type: "image/png", size: 5 },
    sourceStatus: "available",
    ...overrides,
  };
}

function storage(overrides = {}) {
  return {
    listProjects: vi.fn().mockResolvedValue([
      {
        id: "saved",
        name: "Saved",
        updatedAt: 100,
        width: 1080,
        height: 1350,
        layerCount: 0,
        sourceStatus: "available",
      },
    ]),
    loadProject: vi.fn().mockResolvedValue({
      project: savedProject(),
      sourceResource: new Blob(["saved"], { type: "image/png" }),
    }),
    saveProject: vi.fn().mockResolvedValue({ revision: 1 }),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    subscribeProjectChanges: vi.fn(() => () => {}),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.__importDispose;
  delete globalThis.__thumbnailFactory;
});

describe("App project persistence integration", () => {
  test("offers the most recent project without auto-opening it", async () => {
    const data = storage();
    render(<App storage={data} decode={vi.fn()} />);

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(data.loadProject).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("测试工作台")).not.toBeInTheDocument();
  });

  test("loads a saved Blob, decodes a fresh owned resource, and does not resave unchanged load", async () => {
    const decoded = { width: 1080, height: 1350, source: {}, dispose: vi.fn() };
    const decode = vi.fn().mockResolvedValue(decoded);
    const data = storage();
    render(<App storage={data} decode={decode} />);

    const open = await screen.findByRole("button", { name: "打开 Saved" });
    vi.useFakeTimers();
    fireEvent.click(open);
    await act(async () => {});
    expect(screen.getByLabelText("测试工作台")).toBeInTheDocument();
    expect(decode).toHaveBeenCalledWith(expect.any(Blob));
    expect(screen.getByTestId("source-kind")).toHaveTextContent("available");

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(data.saveProject).not.toHaveBeenCalled();
  });

  test("opens annotations with a missing source and can replace the photo", async () => {
    const replacement = {
      width: 1080,
      height: 1350,
      source: {},
      dispose: vi.fn(),
    };
    const decode = vi.fn().mockResolvedValue(replacement);
    const data = storage({
      loadProject: vi.fn().mockResolvedValue({
        project: savedProject({ image: null, sourceStatus: "missing" }),
        sourceResource: null,
      }),
    });
    render(<App storage={data} decode={decode} />);

    fireEvent.click(await screen.findByRole("button", { name: "打开 Saved" }));
    expect(await screen.findByTestId("source-kind")).toHaveTextContent("missing");
    fireEvent.click(screen.getByRole("button", { name: "添加或替换照片" }));

    await waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
  });

  test("debounces import autosave by 700ms and saves only the latest rapid edit", async () => {
    vi.useFakeTimers();
    const data = storage({ listProjects: vi.fn().mockResolvedValue([]) });
    render(<App storage={data} decode={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "测试导入" }));
    expect(data.saveProject).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(699));
    expect(data.saveProject).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(data.saveProject).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "快速编辑" }));
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(data.saveProject).toHaveBeenCalledTimes(2);
    expect(data.saveProject.mock.calls[1][0]).toMatchObject({
      name: "latest",
      layers: [{ id: "latest" }],
    });
    expect(data.saveProject.mock.calls[1][1]).toBeUndefined();
  });

  test("ignores transient UI and exposes saving, saved, and failed statuses", async () => {
    vi.useFakeTimers();
    let resolveSave;
    const data = storage({
      listProjects: vi.fn().mockResolvedValue([]),
      saveProject: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSave = resolve;
            }),
        )
        .mockRejectedValueOnce(new Error("disk")),
    });
    render(<App storage={data} decode={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "测试导入" }));
    fireEvent.click(screen.getByRole("button", { name: "切换临时面板" }));
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(screen.getByText("保存中")).toBeInTheDocument();
    expect(data.saveProject).toHaveBeenCalledTimes(1);

    await act(async () => resolveSave());
    expect(screen.getByText("已保存")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑一次" }));
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(screen.getByText("保存失败")).toBeInTheDocument();
  });

  test("disposes an imported decoded resource exactly once in StrictMode", async () => {
    vi.useFakeTimers();
    const dispose = vi.fn();
    globalThis.__importDispose = dispose;
    const view = render(
      <StrictMode>
        <App
          storage={storage({ listProjects: vi.fn().mockResolvedValue([]) })}
          decode={vi.fn()}
        />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole("button", { name: "测试导入" }));
    view.unmount();
    await act(() => vi.runAllTimersAsync());
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test("retains a failed dirty snapshot and retries it on pagehide", async () => {
    vi.useFakeTimers();
    const data = storage({
      listProjects: vi.fn().mockResolvedValue([]),
      saveProject: vi
        .fn()
        .mockRejectedValueOnce(new Error("disk"))
        .mockResolvedValueOnce({ revision: 1 }),
    });
    render(<App storage={data} decode={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "测试导入" }));
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(screen.getByText("保存失败")).toBeInTheDocument();

    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(data.saveProject).toHaveBeenCalledTimes(2);
    await act(async () => {});
    expect(screen.queryByText("保存失败")).not.toBeInTheDocument();
  });

  test("does not claim saved when a newer dirty revision appears during an in-flight save", async () => {
    vi.useFakeTimers();
    const resolvers = [];
    const data = storage({
      listProjects: vi.fn().mockResolvedValue([]),
      saveProject: vi.fn(
        () =>
          new Promise((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    });
    render(<App storage={data} decode={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "测试导入" }));
    await act(() => vi.advanceTimersByTimeAsync(700));
    fireEvent.click(screen.getByRole("button", { name: "编辑一次" }));
    await act(async () => resolvers[0]({ revision: 1 }));
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(data.saveProject).toHaveBeenCalledTimes(2);
    await act(async () => resolvers[1]({ revision: 2 }));
    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  test("ignores a late missing-source open after a newer project opens", async () => {
    let resolveA;
    const projectA = new Promise((resolve) => {
      resolveA = resolve;
    });
    const data = storage({
      listProjects: vi.fn().mockResolvedValue([
        { id: "a", name: "A", updatedAt: 2, width: 1, height: 1, layerCount: 0, sourceStatus: "missing" },
        { id: "b", name: "B", updatedAt: 1, width: 1, height: 1, layerCount: 0, sourceStatus: "missing" },
      ]),
      loadProject: vi.fn((id) =>
        id === "a"
          ? projectA
          : Promise.resolve({
              project: savedProject({ id: "b", name: "B", image: null }),
              sourceResource: null,
              revision: 1,
            }),
      ),
    });
    render(<App storage={data} decode={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "打开 A" }));
    fireEvent.click(screen.getByRole("button", { name: "打开 B" }));
    expect(await screen.findByTestId("project-name")).toHaveTextContent("B");

    await act(async () =>
      resolveA({
        project: savedProject({ id: "a", name: "A", image: null }),
        sourceResource: null,
        revision: 1,
      }),
    );
    expect(screen.getByTestId("project-name")).toHaveTextContent("B");
  });

  test("import invalidates a pending open and external revisions mark conflicts", async () => {
    let resolveOpen;
    let subscriber;
    const data = storage({
      loadProject: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveOpen = resolve;
          }),
      ),
      subscribeProjectChanges: vi.fn((callback) => {
        subscriber = callback;
        return () => {};
      }),
    });
    render(<App storage={data} decode={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "打开 Saved" }));
    fireEvent.click(screen.getByRole("button", { name: "测试导入" }));
    await act(async () =>
      resolveOpen({
        project: savedProject({ name: "Late" }),
        sourceResource: null,
        revision: 1,
      }),
    );
    expect(screen.getByTestId("project-name")).toHaveTextContent("Imported");

    await act(async () =>
      subscriber({ type: "saved", id: "imported", revision: 2 }),
    );
    expect(screen.getByText("保存冲突")).toBeInTheDocument();
  });

  test("wakes the current replacement after an old in-flight save exceeds its debounce", async () => {
    vi.useFakeTimers();
    let resolveOldSave;
    const data = storage({
      listProjects: vi.fn().mockResolvedValue([]),
      saveProject: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveOldSave = resolve;
            }),
        )
        .mockResolvedValueOnce({ revision: 2 }),
    });
    const decode = vi.fn().mockResolvedValue({
      width: 800,
      height: 600,
      source: {},
      dispose: vi.fn(),
    });
    render(<App storage={data} decode={decode} />);
    fireEvent.click(screen.getByRole("button", { name: "测试导入" }));
    await act(() => vi.advanceTimersByTimeAsync(700));
    fireEvent.click(screen.getByRole("button", { name: "替换测试照片" }));
    await act(async () => {});
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(data.saveProject).toHaveBeenCalledTimes(1);

    await act(async () => resolveOldSave({ revision: 1 }));
    await act(() => vi.runOnlyPendingTimersAsync());
    expect(data.saveProject).toHaveBeenCalledTimes(2);
    expect(data.saveProject.mock.calls[1][1]).toEqual(expect.any(Blob));
    expect(data.saveProject.mock.calls[1][2]).toMatchObject({
      expectedRevision: 1,
    });
  });

  test("persists a thumbnail that resolves after the first project flush", async () => {
    vi.useFakeTimers();
    let resolveThumbnail;
    let resolveFirstSave;
    globalThis.__thumbnailFactory = () =>
      new Promise((resolve) => {
        resolveThumbnail = resolve;
      });
    const data = storage({
      listProjects: vi.fn().mockResolvedValue([]),
      saveProject: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirstSave = resolve;
            }),
        )
        .mockResolvedValueOnce({ revision: 2 }),
    });
    render(<App storage={data} decode={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "测试导入" }));
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(data.saveProject).toHaveBeenCalledTimes(1);

    const thumbnail = new Blob(["late-thumb"], { type: "image/webp" });
    await act(async () => resolveThumbnail(thumbnail));
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(data.saveProject).toHaveBeenCalledTimes(1);
    await act(async () => resolveFirstSave({ revision: 1 }));
    await act(() => vi.runOnlyPendingTimersAsync());
    expect(data.saveProject).toHaveBeenCalledTimes(2);
    expect(data.saveProject.mock.calls[1][1]).toBeUndefined();
    expect(data.saveProject.mock.calls[1][2]).toMatchObject({
      sourceMode: "preserve",
      thumbnail,
    });
  });

  test("shows when a successful save atomically prunes the oldest project", async () => {
    vi.useFakeTimers();
    const data = storage({
      listProjects: vi.fn().mockResolvedValue([]),
      saveProject: vi.fn().mockResolvedValue({
        revision: 1,
        evictedIds: ["oldest"],
      }),
    });
    render(<App storage={data} decode={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "测试导入" }));
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(screen.getByText("已保存，已清理最旧项目")).toBeInTheDocument();
  });
});
