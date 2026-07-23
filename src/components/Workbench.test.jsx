import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { Workbench } from "../Workbench.jsx";
import { createAnnotation, createProject } from "../domain/project.js";
import { TOOL_DEFINITIONS } from "../features/tools/toolDefinitions.js";

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
    }) {
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
        </div>
      );
    },
  };
});

function renderDemo() {
  return render(<Workbench initialDemoProject />);
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
    expect(screen.getByRole("button", { name: "导出图片" })).toBeVisible();
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

    await user.clear(screen.getByRole("textbox", { name: "批量标签内容" }));
    await user.type(
      screen.getByRole("textbox", { name: "批量标签内容" }),
      "batch",
    );
    await user.click(
      screen.getByRole("button", { name: "批量更新同类标签" }),
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

    fireEvent.change(screen.getByLabelText("线条颜色"), {
      target: { value: "#123456" },
    });
    await user.click(screen.getByRole("button", { name: "应用样式到全部" }));
    expect(JSON.parse(canvas.dataset.layerLineColors)).toEqual([
      "#123456",
      "#123456",
      "#123456",
    ]);

    await user.click(screen.getByRole("button", { name: "撤销" }));
    expect(JSON.parse(canvas.dataset.layerLineColors)).toEqual([
      "#123456",
      "#efbe3b",
      "#efbe3b",
    ]);
  });

  test("wires zoom, grid, preset filters, and demo comparison to visible canvas props", async () => {
    const user = userEvent.setup();
    renderDemo();
    const canvas = screen.getByRole("application", { name: "标注画布" });

    fireEvent.change(screen.getByRole("slider", { name: "画布缩放" }), {
      target: { value: "125" },
    });
    expect(canvas).toHaveAttribute("data-zoom", "125");

    await user.click(screen.getByRole("button", { name: /网格开启/ }));
    expect(canvas).toHaveAttribute("data-grid", "false");

    const beforeFilters = canvas.dataset.filters;
    await user.click(screen.getByRole("button", { name: /档案扫描/ }));
    expect(canvas.dataset.filters).not.toBe(beforeFilters);

    expect(document.querySelector(".canvas-stage-wrap")).toHaveClass(
      "demo-canvas",
    );
    await user.click(screen.getByRole("button", { name: /原图对比/ }));
    expect(document.querySelector(".canvas-stage-wrap")).not.toHaveClass(
      "demo-canvas",
    );
  });

  test("edits selected-layer inspector values and applies style scopes", async () => {
    const user = userEvent.setup();
    renderDemo();

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

  test("routes every mobile dock entry to its matching sheet content", async () => {
    const user = userEvent.setup();
    renderDemo();

    await user.click(screen.getByRole("button", { name: "打开工具面板" }));
    expect(screen.getByRole("heading", { name: "工具" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭面板" }));

    await user.click(screen.getByRole("button", { name: "打开预设面板" }));
    expect(screen.getByRole("heading", { name: "预设" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭面板" }));

    await user.click(screen.getByRole("button", { name: "打开 AI 扫描面板" }));
    expect(screen.getByRole("heading", { name: "AI 扫描" })).toBeInTheDocument();
    expect(screen.getByText(/模型功能将在后续阶段接入/)).toBeInTheDocument();
  });

  test("exposes a modal export placeholder with focus and Escape close", async () => {
    const user = userEvent.setup();
    renderDemo();

    await user.click(screen.getByRole("button", { name: "导出图片" }));
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
});
