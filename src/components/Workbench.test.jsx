import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { createDemoProject, Workbench } from "../Workbench.jsx";
import { createAnnotation, createProject } from "../domain/project.js";
import { TOOL_DEFINITIONS } from "../features/tools/toolDefinitions.js";

const { editorCanvasSpy } = vi.hoisted(() => ({
  editorCanvasSpy: vi.fn(),
}));

vi.mock("../features/canvas/EditorCanvas.jsx", async () => {
  const { createAnnotation } = await import("../domain/project.js");

  return {
    EditorCanvas({
      project,
      selectedLayerId,
      activeTool,
      zoom,
      grid,
      onSelectLayer,
      onCreateLayer,
      onChangeLayer,
      onImageSourceReady,
      animationTimeMs,
    }) {
      editorCanvasSpy({ onImageSourceReady });
      const selected = project.layers.find(
        ({ id }) => id === selectedLayerId,
      );

      return (
        <div
          role="application"
          aria-label="标注画布"
          tabIndex={0}
          data-active-tool={activeTool}
          data-zoom={zoom}
          data-grid={String(Boolean(grid))}
          data-selected-points={JSON.stringify(selected?.points ?? [])}
          data-selected-dash={JSON.stringify(selected?.style?.dash ?? [])}
          data-selected-label-offset={JSON.stringify(
            selected?.labelOffset ?? { x: 0, y: 0 },
          )}
          data-selected-label-position={selected?.labelPosition ?? "end"}
          data-layer-count={project.layers.length}
          data-layer-labels={JSON.stringify(
            project.layers.map(({ label }) => label),
          )}
          data-layer-line-colors={JSON.stringify(
            project.layers.map(({ style }) => style.lineColor),
          )}
          data-filters={JSON.stringify(project.filters)}
          data-effect-stack={JSON.stringify(project.effectStack)}
          data-animation-time={animationTimeMs}
          data-selected-animation={JSON.stringify(selected?.animation ?? null)}
          data-selected-type={selected?.type ?? ""}
          data-selected-source-fill={selected?.sourceFill ?? ""}
          data-selected-effects={JSON.stringify(selected?.effects ?? [])}
          data-selected-linked={String(selected?.linkedToMarker ?? "")}
          data-motion-duration={project.motion?.durationMs}
        >
          <button
            type="button"
            onClick={() =>
              onCreateLayer(
                createAnnotation("label", [{ x: 0.5, y: 0.5 }], {
                  id: "canvas-label",
                  name: "canvas_label",
                }),
              )
            }
          >
            画布新增图层
          </button>
          {selected ? (
            <button
              type="button"
              onClick={() =>
                onChangeLayer(selected.id, { label: "canvas_changed" })
              }
            >
              画布修改选中图层
            </button>
          ) : null}
          <button type="button" onClick={() => onSelectLayer(null)}>
            清除画布选择
          </button>
          <button
            type="button"
            onClick={() =>
              onImageSourceReady?.({ width: 1080, height: 1350 })
            }
          >
            模拟底图就绪
          </button>
        </div>
      );
    },
  };
});

function renderDemo() {
  return render(<Workbench initialDemoProject />);
}

test("starts the demo with no implicit image effects", () => {
  const project = createDemoProject();

  expect(project.filters).toEqual({});
  expect(project.effectStack).toEqual([]);
});

async function openAdvancedSettings(user) {
  await user.click(screen.getByRole("button", { name: "高级设置" }));
}

function repeatedBoxProject() {
  return {
    ...createProject(),
    image: { demo: true },
    layers: ["first", "second", "third"].map((id) =>
      createAnnotation(
        "box",
        [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }],
        { id, name: id, label: `before-${id}` },
      ),
    ),
  };
}

function aiReadyProject() {
  return {
    ...createProject(),
    image: { source: { width: 1080, height: 1350 } },
    layers: [
      createAnnotation("box", [], {
        id: "manual-layer",
        name: "manual",
      }),
    ],
  };
}

function detachedFragmentProject() {
  const marker = createAnnotation(
    "box",
    [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }],
    { id: "source-marker", name: "source-marker" },
  );
  const fragment = createAnnotation("extractedFragment", [], {
    id: "detached-fragment",
    name: "detached-fragment",
    sourceMarkerId: marker.id,
    sourceRect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    transform: { x: 0.55, y: 0.45, width: 0.2, height: 0.2 },
    linkedToMarker: false,
    sourceFill: "preserve",
    effects: [],
  });
  return {
    ...createProject(),
    image: { demo: true },
    layers: [marker, fragment],
  };
}

function faceScanResult() {
  return {
    ok: true,
    face: [
      {
        landmarks: [
          {
            x: 0.25,
            y: 0.35,
            confidence: 0.98,
            source: "face",
            index: 33,
          },
        ],
      },
    ],
    hands: [],
    pose: [],
  };
}

describe("responsive Reki workbench", () => {
  test("demo mode renders every baseline tool and the complete workbench regions", () => {
    renderDemo();

    const rail = screen.getByRole("toolbar", { name: "标注工具" });
    for (const tool of TOOL_DEFINITIONS) {
      expect(
        within(rail).getByRole("button", { name: tool.label }),
      ).toBeInTheDocument();
    }
    expect(
      within(rail).getByRole("button", { name: "AI 扫描" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "编辑工作台" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "快速预设" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "高级检查器" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "图层" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("照片仅在本机处理");
    expect(screen.getByRole("button", { name: "导出" })).toBeVisible();
  });

  test("changes tools, applies a preset, and supports undo and redo", async () => {
    const user = userEvent.setup();
    renderDemo();

    const undo = screen.getByRole("button", { name: "撤销" });
    const redo = screen.getByRole("button", { name: "重做" });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();

    const pathTool = screen.getByRole("button", { name: "节点路径" });
    await user.click(pathTool);
    expect(pathTool).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("application", { name: "标注画布" })).toHaveAttribute(
      "data-active-tool",
      "node-path",
    );

    await user.click(screen.getByRole("button", { name: /档案扫描/ }));
    expect(
      screen.getByRole("button", { name: /档案扫描/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(undo).toBeEnabled();

    await user.click(undo);
    expect(redo).toBeEnabled();
    await user.click(redo);
    expect(undo).toBeEnabled();
  });

  test("undoes and redoes an entire preset with its pressed state atomically", async () => {
    const user = userEvent.setup();
    renderDemo();
    const canvas = screen.getByRole("application", { name: "标注画布" });
    const archive = screen.getByRole("button", { name: /档案扫描/ });

    expect(canvas).toHaveAttribute("data-layer-count", "3");
    await user.click(archive);
    expect(canvas).toHaveAttribute("data-layer-count", "5");
    expect(archive).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(canvas).toHaveAttribute("data-layer-count", "3");
    expect(archive).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "重做" }));
    expect(canvas).toHaveAttribute("data-layer-count", "5");
    expect(archive).toHaveAttribute("aria-pressed", "true");
  });

  test("batch labels update matching layers in one history commit", async () => {
    const user = userEvent.setup();
    render(<Workbench initialDemoProject={repeatedBoxProject()} />);
    const canvas = await screen.findByRole("application", {
      name: "标注画布",
    });
    await openAdvancedSettings(user);

    await user.clear(screen.getByRole("textbox", { name: "批量标签内容" }));
    await user.type(
      screen.getByRole("textbox", { name: "批量标签内容" }),
      "batch",
    );
    await user.click(
      screen.getByRole("button", { name: "批量修改标签" }),
    );
    expect(JSON.parse(canvas.dataset.layerLabels)).toEqual([
      "batch",
      "batch",
      "batch",
    ]);

    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(JSON.parse(canvas.dataset.layerLabels)).toEqual([
      "before-first",
      "before-second",
      "before-third",
    ]);
  });

  test("applies selected style to all layers in one history commit", async () => {
    const user = userEvent.setup();
    render(<Workbench initialDemoProject={repeatedBoxProject()} />);
    const canvas = await screen.findByRole("application", {
      name: "标注画布",
    });
    await openAdvancedSettings(user);

    fireEvent.change(screen.getByLabelText("线条颜色"), {
      target: { value: "#123456" },
    });
    await user.click(screen.getByRole("button", { name: "将当前样式应用到全部" }));
    expect(JSON.parse(canvas.dataset.layerLineColors)).toEqual([
      "#123456",
      "#123456",
      "#123456",
    ]);

    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(JSON.parse(canvas.dataset.layerLineColors)).toEqual([
      "#123456",
      "#e5484d",
      "#e5484d",
    ]);
  });

  test("wires zoom, grid, effect-free presets, and demo comparison to visible canvas props", async () => {
    const user = userEvent.setup();
    renderDemo();
    const canvas = screen.getByRole("application", { name: "标注画布" });

    fireEvent.change(screen.getByRole("slider", { name: "画布缩放" }), {
      target: { value: "125" },
    });
    expect(canvas).toHaveAttribute("data-zoom", "125");

    await user.click(screen.getByRole("button", { name: /网格开启/ }));
    expect(canvas).toHaveAttribute("data-grid", "false");

    const beforeEffects = canvas.dataset.effectStack;
    await user.click(screen.getByRole("button", { name: /档案扫描/ }));
    expect(canvas.dataset.effectStack).toBe(beforeEffects);

    expect(document.querySelector(".canvas-stage-wrap")).toHaveClass(
      "demo-canvas",
    );
    await user.click(screen.getByTestId("comparison-toggle"));
    expect(document.querySelector(".canvas-stage-wrap")).toHaveClass(
      "demo-canvas",
    );
    expect(document.querySelector(".canvas-comparison-layout")).toHaveClass(
      "is-comparing",
    );
  });

  test("keeps the editing canvas active beside an unfiltered original comparison pane", async () => {
    const user = userEvent.setup();
    const project = {
      ...createDemoProject(),
      effectStack: [{
        id: "contrast-1",
        type: "contrast",
        name: "对比度",
        visible: true,
        opacity: 1,
        settings: { amount: 1.2 },
      }],
    };
    render(<Workbench initialDemoProject={project} />);
    const editor = screen.getByRole("application", { name: "标注画布" });

    await user.click(screen.getByRole("button", { name: "原图对比" }));

    expect(editor).toBeVisible();
    expect(editor).toHaveAttribute("data-effect-stack", JSON.stringify(project.effectStack));
    expect(screen.getByLabelText("原图实时对照")).toHaveAttribute(
      "data-effect-count",
      "0",
    );

    await user.click(screen.getByRole("button", { name: "关闭对比" }));
    expect(screen.queryByLabelText("原图实时对照")).not.toBeInTheDocument();
    expect(editor).toBeVisible();
  });

  test("keeps the editor image callback stable when comparison is toggled", async () => {
    const user = userEvent.setup();
    editorCanvasSpy.mockClear();
    renderDemo();
    const initialCallback = editorCanvasSpy.mock.calls.at(-1)[0].onImageSourceReady;

    await user.click(screen.getByRole("button", { name: "原图对比" }));

    expect(editorCanvasSpy.mock.calls.at(-1)[0].onImageSourceReady).toBe(
      initialCallback,
    );
  });

  test("extracts the selected marker into an independently configurable original fragment", async () => {
    const user = userEvent.setup();
    renderDemo();
    const canvas = screen.getByRole("application", { name: "标注画布" });

    await user.click(screen.getByRole("button", { name: "提取框内原图" }));

    expect(canvas).toHaveAttribute("data-selected-type", "extractedFragment");
    expect(screen.getByLabelText("原位置填充")).toHaveValue("preserve");

    await user.selectOptions(screen.getByLabelText("原位置填充"), "black");
    expect(canvas).toHaveAttribute("data-selected-source-fill", "black");
  });

  test("keeps fragment effect cards local and never adds an implicit base-image effect", async () => {
    const user = userEvent.setup();
    renderDemo();
    const canvas = screen.getByRole("application", { name: "标注画布" });

    await user.click(screen.getByRole("button", { name: "提取框内原图" }));
    await user.click(screen.getByRole("button", { name: "添加 颗粒 片段效果" }));

    expect(JSON.parse(canvas.dataset.selectedEffects)).toEqual([
      expect.objectContaining({ type: "grain" }),
    ]);
    expect(JSON.parse(canvas.dataset.effectStack)).toEqual([]);
  });

  test("reconnects a detached fragment to its marker bounds", async () => {
    const user = userEvent.setup();
    render(<Workbench initialDemoProject={detachedFragmentProject()} />);
    const canvas = screen.getByRole("application", { name: "标注画布" });

    await user.click(screen.getByRole("button", { name: "选择图层 detached-fragment" }));
    await user.click(screen.getByRole("button", { name: "重新关联标记" }));

    expect(canvas).toHaveAttribute("data-selected-linked", "true");
  });

  test("keeps original comparison out of persisted project history", async () => {
    const user = userEvent.setup();
    const onProjectChange = vi.fn();
    render(<Workbench initialDemoProject onProjectChange={onProjectChange} />);
    const undo = screen.getByRole("button", { name: "撤销" });

    expect(undo).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "原图对比" }));

    expect(onProjectChange).not.toHaveBeenCalled();
    expect(undo).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "关闭对比" }));
    expect(onProjectChange).not.toHaveBeenCalled();
    expect(undo).toBeDisabled();
  });

  test("routes the bottom-image tool to explicit effect cards and resets all effects", async () => {
    const user = userEvent.setup();
    renderDemo();
    const canvas = screen.getByRole("application", { name: "标注画布" });

    await user.click(screen.getByRole("button", { name: "底图效果" }));
    expect(screen.getByRole("region", { name: "底图效果" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "添加 阈值 效果" }));
    expect(JSON.parse(canvas.dataset.effectStack).map(({ type }) => type)).toContain("threshold");

    await user.click(screen.getByRole("button", { name: "重置底图效果" }));
    expect(JSON.parse(canvas.dataset.effectStack)).toEqual([]);
  });

  test("updates one explicit effect card and undo restores its prior setting", async () => {
    const user = userEvent.setup();
    renderDemo();
    const canvas = screen.getByRole("application", { name: "标注画布" });
    const undo = screen.getByRole("button", { name: "撤销" });
    await user.click(screen.getByRole("button", { name: "底图效果" }));
    await user.click(screen.getByRole("button", { name: "添加 颗粒 效果" }));
    await user.click(screen.getByRole("button", { name: "展开 颗粒 设置" }));
    const grain = screen.getByRole("slider", { name: "颗粒 强度" });
    fireEvent.change(grain, { target: { value: "0.6" } });

    expect(JSON.parse(canvas.dataset.effectStack).at(-1)).toMatchObject({
      type: "grain", settings: { amount: 0.6 },
    });
    expect(undo).toBeEnabled();
    await user.click(undo);
    expect(JSON.parse(canvas.dataset.effectStack).at(-1)).toMatchObject({
      type: "grain", settings: { amount: 0.3 },
    });
  });

  test("edits selected-layer inspector values and applies style scopes", async () => {
    const user = userEvent.setup();
    renderDemo();
    await openAdvancedSettings(user);

    const label = screen.getByRole("textbox", { name: "当前标签" });
    await user.clear(label);
    await user.type(label, "mask_anchor");
    expect(label).toHaveValue("mask_anchor");

    fireEvent.change(screen.getByLabelText("线条颜色"), {
      target: { value: "#123456" },
    });
    await user.click(screen.getByRole("button", { name: "应用样式到同类" }));
    expect(screen.getByLabelText("线条颜色")).toHaveValue("#123456");

    await user.click(screen.getByRole("button", { name: "画布修改选中图层" }));
    expect(screen.getByRole("textbox", { name: "当前标签" })).toHaveValue(
      "canvas_changed",
    );
  });

  test("synchronizes the controlled batch label draft when selection changes", async () => {
    const user = userEvent.setup();
    render(<Workbench initialDemoProject={repeatedBoxProject()} />);
    const layers = await screen.findByRole("region", { name: "图层" });
    await openAdvancedSettings(user);
    const batchInput = screen.getByRole("textbox", {
      name: "批量标签内容",
    });

    expect(batchInput).toHaveValue("before-first");
    await user.clear(batchInput);
    await user.type(batchInput, "unsaved-draft");
    await user.click(
      within(layers).getByRole("button", { name: "选择图层 second" }),
    );

    expect(batchInput).toHaveValue("before-second");
  });

  test("keeps an explicit canvas deselection cleared", async () => {
    const user = userEvent.setup();
    renderDemo();

    await user.click(screen.getByRole("button", { name: "清除画布选择" }));

    expect(screen.getByText("选择一个图层")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "当前标签" })).not.toBeInTheDocument();
  });

  test("performs layer visibility, locking, duplication, ordering, selection, and deletion", async () => {
    const user = userEvent.setup();
    renderDemo();

    const layers = screen.getByRole("region", { name: "图层" });
    const firstLayer = within(layers).getAllByRole("listitem")[0];
    await user.click(within(firstLayer).getByRole("button", { name: /选择图层/ }));
    await user.click(within(firstLayer).getByRole("button", { name: /隐藏/ }));
    expect(within(firstLayer).getByRole("button", { name: /显示/ })).toBeInTheDocument();
    await user.click(within(firstLayer).getByRole("button", { name: /锁定/ }));
    expect(within(firstLayer).getByRole("button", { name: /解锁/ })).toBeInTheDocument();

    const before = within(layers).getAllByRole("listitem").length;
    await user.click(within(firstLayer).getByRole("button", { name: /复制/ }));
    expect(within(layers).getAllByRole("listitem")).toHaveLength(before + 1);

    const selected = within(layers).getAllByRole("listitem")[0];
    await user.click(within(selected).getByRole("button", { name: /置顶/ }));
    await user.click(within(selected).getByRole("button", { name: /下移/ }));
    await user.click(within(selected).getByRole("button", { name: /上移/ }));
    await user.click(within(selected).getByRole("button", { name: /置底/ }));
    await user.click(within(selected).getByRole("button", { name: /删除/ }));
    expect(within(layers).getAllByRole("listitem")).toHaveLength(before);
  });

  test("opens mobile inspector and layers sheets and closes them accessibly", async () => {
    const user = userEvent.setup();
    renderDemo();

    await user.click(screen.getByRole("button", { name: "打开样式面板" }));
    expect(screen.getByRole("dialog", { name: "移动端编辑面板" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "调整移动端面板高度" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "样式", selected: true }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "图层" }));
    expect(
      screen.getByRole("tab", { name: "图层", selected: true }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭面板" }));
    expect(
      screen.queryByRole("dialog", { name: "移动端编辑面板" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开图层面板" }));
    expect(
      screen.getByRole("tab", { name: "图层", selected: true }),
    ).toBeInTheDocument();
  });

  test("uses a fitted 100 percent starting zoom on a mobile viewport", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    try {
      renderDemo();
      expect(screen.getByRole("application", { name: "标注画布" })).toHaveAttribute("data-zoom", "100");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("returns to selection and closes a mobile tool sheet in one action", async () => {
    const user = userEvent.setup();
    renderDemo();

    await user.click(screen.getByRole("button", { name: "打开工具面板" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "移动端编辑面板" })).getByRole(
        "button",
        { name: "点框工具" },
      ),
    );
    await user.click(screen.getByRole("button", { name: "打开图层面板" }));
    expect(screen.getByRole("dialog", { name: "移动端编辑面板" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "移动端返回选择模式" }));

    expect(screen.getByRole("application", { name: "标注画布" })).toHaveAttribute("data-active-tool", "select");
    expect(screen.queryByRole("dialog", { name: "移动端编辑面板" })).not.toBeInTheDocument();
  });

  test("keeps the tool picker compact on mobile", async () => {
    const user = userEvent.setup();
    renderDemo();

    await user.click(screen.getByRole("button", { name: "打开工具面板" }));

    expect(screen.getByRole("dialog", { name: "移动端编辑面板" })).toHaveAttribute("data-compact", "true");
    expect(screen.queryByRole("separator", { name: "调整移动端面板高度" })).not.toBeInTheDocument();
  });

  test("routes the concise mobile dock to its matching sheet content", async () => {
    const user = userEvent.setup();
    renderDemo();

    await user.click(screen.getByRole("button", { name: "打开工具面板" }));
    expect(screen.getByRole("heading", { name: "工具" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭面板" }));

    expect(screen.getByRole("region", { name: "快速预设" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开预设面板" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开 AI 扫描面板" }));
    expect(screen.getByRole("heading", { name: "AI 扫描" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "AI 关键点扫描" })).toBeInTheDocument();
  });

  test("adds a decoded-source AI scan atomically and one undo removes it", async () => {
    const user = userEvent.setup();
    const scanLandmarks = vi.fn().mockResolvedValue(faceScanResult());
    render(
      <Workbench
        initialDemoProject={aiReadyProject()}
        scanLandmarks={scanLandmarks}
      />,
    );
    const canvas = screen.getByRole("application", { name: "标注画布" });

    const aiTool = screen.getByRole("button", { name: "AI 扫描" });
    await user.click(aiTool);
    expect(aiTool).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "扫描关键点" }));

    expect(scanLandmarks).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1080, height: 1350 }),
      ["face", "hands", "pose"],
      { signal: expect.any(AbortSignal) },
    );
    expect(canvas).toHaveAttribute("data-layer-count", "2");
    expect(screen.getByText(/已生成 1 个 AI 图层/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(canvas).toHaveAttribute("data-layer-count", "1");
    expect(screen.getByRole("button", { name: "扫描关键点" })).toBeEnabled();
  });

  test("clears only AI layers atomically and undo restores the scan", async () => {
    const user = userEvent.setup();
    const scanLandmarks = vi.fn().mockResolvedValue(faceScanResult());
    render(
      <Workbench
        initialDemoProject={aiReadyProject()}
        scanLandmarks={scanLandmarks}
      />,
    );
    const canvas = screen.getByRole("application", { name: "标注画布" });

    await user.click(screen.getByRole("button", { name: "AI 扫描" }));
    await user.click(screen.getByRole("button", { name: "扫描关键点" }));
    expect(canvas).toHaveAttribute("data-layer-count", "2");

    await user.click(screen.getByRole("button", { name: "清除 AI 结果" }));
    expect(canvas).toHaveAttribute("data-layer-count", "1");

    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(canvas).toHaveAttribute("data-layer-count", "2");
  });

  test("confirms before clearing every layer and undo restores the stack", async () => {
    const user = userEvent.setup();
    const confirmation = vi.spyOn(window, "confirm");
    confirmation.mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderDemo();
    const canvas = screen.getByRole("application", { name: "标注画布" });
    const clearButton = screen.getByRole("button", { name: "清除全部图层" });

    await user.click(clearButton);
    expect(confirmation).toHaveBeenCalledWith(
      "确定清除全部图层吗？此操作可通过撤销恢复。",
    );
    expect(canvas).toHaveAttribute("data-layer-count", "3");

    await user.click(clearButton);
    expect(canvas).toHaveAttribute("data-layer-count", "0");
    expect(clearButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(canvas).toHaveAttribute("data-layer-count", "3");
    confirmation.mockRestore();
  });

  test("keeps manual tools usable after failure and scans again after reopen", async () => {
    const user = userEvent.setup();
    const scanLandmarks = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        code: "MODEL_LOAD_FAILED",
        message: "模型下载失败",
      })
      .mockResolvedValueOnce(faceScanResult());
    render(
      <Workbench
        initialDemoProject={aiReadyProject()}
        scanLandmarks={scanLandmarks}
      />,
    );

    await user.click(screen.getByRole("button", { name: "AI 扫描" }));
    await user.click(screen.getByRole("button", { name: "扫描关键点" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("模型下载失败");

    await user.click(screen.getByRole("button", { name: "节点路径" }));
    expect(
      screen.getByRole("application", { name: "标注画布" }),
    ).toHaveAttribute("data-active-tool", "node-path");

    await user.click(screen.getByRole("button", { name: "AI 扫描" }));
    await user.click(screen.getByRole("button", { name: "扫描关键点" }));
    expect(scanLandmarks).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/已生成 1 个 AI 图层/)).toBeInTheDocument();
  });

  test("aborts and ignores a late desktop scan when another tool is selected", async () => {
    const user = userEvent.setup();
    let resolveScan;
    let signal;
    const scanLandmarks = vi.fn((_source, _modes, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        resolveScan = resolve;
      });
    });
    render(
      <Workbench
        initialDemoProject={aiReadyProject()}
        scanLandmarks={scanLandmarks}
      />,
    );
    const canvas = screen.getByRole("application", { name: "标注画布" });

    await user.click(screen.getByRole("button", { name: "AI 扫描" }));
    await user.click(screen.getByRole("button", { name: "扫描关键点" }));
    await user.click(screen.getByRole("button", { name: "节点路径" }));

    expect(signal.aborted).toBe(true);
    expect(
      screen.queryByRole("form", { name: "AI 关键点扫描" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveScan(faceScanResult());
      await Promise.resolve();
    });
    expect(canvas).toHaveAttribute("data-layer-count", "1");
  });

  test("aborts and ignores a late mobile scan when its sheet closes", async () => {
    const user = userEvent.setup();
    let resolveScan;
    let signal;
    const scanLandmarks = vi.fn((_source, _modes, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        resolveScan = resolve;
      });
    });
    render(
      <Workbench
        initialDemoProject={aiReadyProject()}
        scanLandmarks={scanLandmarks}
      />,
    );
    const canvas = screen.getByRole("application", { name: "标注画布" });

    await user.click(
      screen.getByRole("button", { name: "打开 AI 扫描面板" }),
    );
    await user.click(screen.getByRole("button", { name: "扫描关键点" }));
    await user.click(screen.getByRole("button", { name: "关闭面板" }));

    expect(signal.aborted).toBe(true);
    expect(
      screen.queryByRole("form", { name: "AI 关键点扫描" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveScan(faceScanResult());
      await Promise.resolve();
    });
    expect(canvas).toHaveAttribute("data-layer-count", "1");
  });

  test("keeps demo scanning unavailable until its URL image reports a drawable", async () => {
    const user = userEvent.setup();
    const scanLandmarks = vi.fn().mockResolvedValue(faceScanResult());
    render(
      <Workbench
        initialDemoProject
        scanLandmarks={scanLandmarks}
      />,
    );

    await user.click(screen.getByRole("button", { name: "AI 扫描" }));
    expect(screen.getByRole("button", { name: "扫描关键点" })).toBeDisabled();
    expect(screen.getByText(/图片加载完成后/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "模拟底图就绪" }));
    expect(screen.getByRole("button", { name: "扫描关键点" })).toBeEnabled();
  });

  test("exposes a modal export placeholder with focus and Escape close", async () => {
    const user = userEvent.setup();
    renderDemo();

    await user.click(screen.getByRole("button", { name: "导出" }));
    const dialog = screen.getByRole("dialog", { name: "导出设置" });
    const close = within(dialog).getByRole("button", { name: "关闭导出设置" });

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(close).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "导出设置" }),
    ).not.toBeInTheDocument();
  });

  test("updates box geometry and aspect ratio through type-specific controls", async () => {
    const user = userEvent.setup();
    renderDemo();

    await user.click(screen.getByRole("button", { name: /档案扫描/ }));
    await openAdvancedSettings(user);
    const canvas = screen.getByRole("application", { name: "标注画布" });

    fireEvent.change(screen.getByRole("spinbutton", { name: "框宽" }), {
      target: { value: "0.5" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "框高" }), {
      target: { value: "0.4" },
    });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "框宽高比" }),
      "1:1",
    );

    const points = JSON.parse(canvas.dataset.selectedPoints);
    expect(points[1].x - points[0].x).toBeCloseTo(0.5);
    expect(points[1].y - points[0].y).toBeCloseTo(0.5);
  });

  test("updates editable dash rhythm in selected-layer style", () => {
    renderDemo();
    fireEvent.click(screen.getByRole("button", { name: "高级设置" }));
    const canvas = screen.getByRole("application", { name: "标注画布" });

    fireEvent.change(screen.getByRole("spinbutton", { name: "虚线长度" }), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "虚线间隔" }), {
      target: { value: "5" },
    });

    expect(JSON.parse(canvas.dataset.selectedDash)).toEqual([12, 5]);
  });

  test("updates label position offsets in editor state", async () => {
    const user = userEvent.setup();
    renderDemo();
    const canvas = screen.getByRole("application", { name: "标注画布" });

    await user.click(
      screen.getByRole("button", { name: "选择图层 机械标签" }),
    );
    await openAdvancedSettings(user);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "标签位置" }),
      "start",
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "标签偏移 X" }), {
      target: { value: "18" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "标签偏移 Y" }), {
      target: { value: "-9" },
    });

    expect(JSON.parse(canvas.dataset.selectedLabelOffset)).toEqual({
      x: 18,
      y: -9,
    });
    expect(canvas).toHaveAttribute("data-selected-label-position", "start");
  });

  test("edits selected layer animation through the global timeline inspector", async () => {
    const user = userEvent.setup();
    renderDemo();
    const canvas = screen.getByRole("application", { name: "标注画布" });

    await user.selectOptions(screen.getByLabelText("动画类型"), "pulse");
    expect(JSON.parse(canvas.dataset.selectedAnimation)).toMatchObject({
      type: "pulse",
    });
    expect(screen.getByRole("button", { name: "暂停动画预览" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "暂停动画预览" }));
    expect(screen.getByRole("button", { name: "播放动画预览" })).toBeVisible();
    fireEvent.change(screen.getByRole("slider", { name: "全局时间轴" }), {
      target: { value: "750" },
    });
    expect(canvas).toHaveAttribute("data-animation-time", "750");
    expect(canvas).toHaveAttribute("data-animation-time", "750");

    fireEvent.change(screen.getByLabelText("全局动画时长"), {
      target: { value: "5200" },
    });
    expect(canvas).toHaveAttribute("data-motion-duration", "5200");
    expect(screen.getByRole("slider", { name: "全局时间轴" }))
      .toHaveAttribute("max", "5200");
  });

  test("publishes RAF preview time at most once every 30fps interval", async () => {
    const user = userEvent.setup();
    const callbacks = [];
    const cancelFrame = vi.fn();
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);

    try {
      renderDemo();
      const canvas = screen.getByRole("application", { name: "标注画布" });
      await user.selectOptions(screen.getByLabelText("动画类型"), "pulse");

      expect(callbacks).toHaveLength(1);
      await act(async () => {
        callbacks[0](1000);
      });
      await act(async () => {
        callbacks[1](1016);
        callbacks[2](1032);
      });
      expect(canvas).toHaveAttribute("data-animation-time", "0");

      await act(async () => {
        callbacks[3](1034);
      });
      expect(canvas).toHaveAttribute("data-animation-time", "34");

      await user.click(screen.getByRole("button", { name: "暂停动画预览" }));
      expect(cancelFrame).toHaveBeenCalled();
      expect(canvas).toHaveAttribute("data-animation-time", "34");

      fireEvent.change(screen.getByRole("slider", { name: "全局时间轴" }), {
        target: { value: "750" },
      });
      expect(canvas).toHaveAttribute("data-animation-time", "750");

      await user.click(screen.getByRole("button", { name: "重新开始动画预览" }));
      expect(canvas).toHaveAttribute("data-animation-time", "0");
    } finally {
      now.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  test("does not auto-play a new animation when the operating system requests reduced motion", () => {
    const media = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", vi.fn(() => media));
    try {
      renderDemo();
      fireEvent.change(screen.getByLabelText("动画类型"), {
        target: { value: "glitch" },
      });
      expect(screen.getByRole("button", { name: "播放动画预览" }))
        .toBeVisible();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("provides an accessible desktop separator for expanding the layer work area", () => {
    renderDemo();

    const separator = screen.getByRole("separator", {
      name: "调整右侧工作区宽度",
    });
    fireEvent.keyDown(separator, { key: "End" });

    expect(screen.getByLabelText("高级检查器").parentElement).toHaveStyle(
      "--reki-panel-preference: 520px",
    );
  });
});
