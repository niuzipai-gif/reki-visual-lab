import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import App from "../src/App.jsx";

vi.mock("../src/features/canvas/EditorCanvas.jsx", () => ({
  EditorCanvas({ project, selectedLayerId, activeTool }) {
    const selected = project.layers.find(({ id }) => id === selectedLayerId);
    return (
      <div
        role="application"
        aria-label="标注画布"
        data-active-tool={activeTool}
        data-selected-label={selected?.label ?? ""}
        data-layer-labels={JSON.stringify(project.layers.map(({ label }) => label))}
        data-layer-line-colors={JSON.stringify(project.layers.map(({ style }) => style.lineColor))}
      />
    );
  },
}));

test("exposes every competitor-baseline editing control", async () => {
  const user = userEvent.setup();
  render(<App initialDemoProject />);

  for (const name of [
    "点框工具",
    "叠框工具",
    "节点路径",
    "单侧引线",
    "全局节点",
    "随机节点",
    "轨道圆环",
    "标签文字",
    "底图效果",
  ]) {
    expect(await screen.findByRole("button", { name })).toBeInTheDocument();
  }

  expect(screen.queryByLabelText("线条颜色")).not.toBeInTheDocument();
  const advanced = screen.getByRole("button", { name: "高级设置" });
  expect(advanced).toHaveAttribute("aria-expanded", "false");
  const advancedPanelId = advanced.getAttribute("aria-controls");
  expect(advancedPanelId).toBeTruthy();
  expect(document.getElementById(advancedPanelId)).toBeInTheDocument();
  await user.click(advanced);
  expect(advanced).toHaveAttribute("aria-expanded", "true");
  for (const label of [
    "线条颜色",
    "文字颜色",
    "锚点颜色",
    "线条粗细",
    "文字大小",
    "锚点大小",
    "虚线",
    "透明度",
    "曲线张力",
    "显示标签",
    "当前标签",
    "数值格式",
    "批量标签内容",
  ]) {
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  }
  expect(screen.getByRole("button", { name: "原图对比" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "应用样式到同类" })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "批量修改标签" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "将当前样式应用到全部" })).toHaveLength(1);

  await user.click(screen.getByRole("button", { name: "打开样式面板" }));
  const advancedButtons = screen.getAllByRole("button", { name: "高级设置" });
  expect(advancedButtons).toHaveLength(2);
  const advancedIds = advancedButtons.map((button) => button.getAttribute("aria-controls"));
  expect(new Set(advancedIds).size).toBe(2);
  for (const id of advancedIds) expect(document.getElementById(id)).toBeInTheDocument();
});

test("applies batch labels to same-type layers and styles to every layer", async () => {
  const user = userEvent.setup();
  render(<App initialDemoProject />);
  const canvas = await screen.findByRole("application", { name: "标注画布" });
  await user.click(await screen.findByRole("button", { name: "高级设置" }));

  const layers = screen.getByRole("region", { name: "图层" });
  const first = within(layers).getAllByRole("listitem")[0];
  await user.click(within(first).getByRole("button", { name: /复制/ }));

  const batchInput = screen.getByRole("textbox", { name: "批量标签内容" });
  await user.clear(batchInput);
  await user.type(batchInput, "BATCH_NODE");
  await user.click(screen.getByRole("button", { name: "批量修改标签" }));
  const labels = JSON.parse(canvas.dataset.layerLabels);
  expect(labels.filter((label) => label === "BATCH_NODE")).toHaveLength(2);

  fireEvent.change(screen.getByLabelText("线条颜色"), {
    target: { value: "#123456" },
  });
  await user.click(screen.getByRole("button", { name: "将当前样式应用到全部" }));
  expect(JSON.parse(canvas.dataset.layerLineColors).every((color) => color === "#123456")).toBe(true);
});

test("keeps layer visibility, lock, ordering, duplication, and delete operations accessible", async () => {
  const user = userEvent.setup();
  render(<App initialDemoProject />);
  const layers = await screen.findByRole("region", { name: "图层" });
  const first = within(layers).getAllByRole("listitem")[0];

  expect(within(first).getByRole("button", { name: /隐藏/ })).toBeInTheDocument();
  expect(within(first).getByRole("button", { name: /锁定/ })).toBeInTheDocument();
  for (const action of ["复制", "置顶", "上移", "下移", "置底", "删除"]) {
    expect(within(first).getByRole("button", { name: new RegExp(action) })).toBeInTheDocument();
  }
  await user.click(within(first).getByRole("button", { name: /隐藏/ }));
  expect(within(first).getByRole("button", { name: /显示/ })).toBeInTheDocument();
});

test("keeps motion export choices available alongside the competitor editing tools", async () => {
  const user = userEvent.setup();
  render(<App initialDemoProject />);
  await user.click(await screen.findByRole("button", { name: "导出图片" }));
  await user.click(screen.getByLabelText("动画视频"));
  expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled();
});
