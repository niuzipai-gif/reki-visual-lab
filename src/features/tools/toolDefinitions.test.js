import { expect, test } from "vitest";
import { TOOL_DEFINITIONS } from "./toolDefinitions.js";

test("registers the complete competitor-parity tool baseline", () => {
  expect(TOOL_DEFINITIONS).toEqual([
    { id: "select", label: "选择", objectType: null },
    { id: "point-box", label: "点框工具", objectType: "box" },
    { id: "stack-box", label: "叠框工具", objectType: "stackBox" },
    { id: "node-path", label: "节点路径", objectType: "path" },
    { id: "leader", label: "单侧引线", objectType: "leader" },
    { id: "global-nodes", label: "全局节点", objectType: "nodeCloud" },
    { id: "random-nodes", label: "随机节点", objectType: "randomNodes" },
    { id: "orbit", label: "轨道圆环", objectType: "orbit" },
    { id: "label", label: "标签文字", objectType: "label" },
    { id: "filter", label: "底图效果", objectType: null },
  ]);
});
