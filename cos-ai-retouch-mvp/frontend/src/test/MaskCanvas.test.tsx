// @vitest-environment jsdom
import "./setup";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AnalysisPanel, { buildEditPlan } from "../components/AnalysisPanel";
import MaskCanvas, { type MaskStroke } from "../components/MaskCanvas";
import type { AnalysisCard, TaskView } from "../domain/task";

type CanvasContext = Record<string, ReturnType<typeof vi.fn>>;

const observers: Array<(entries: ResizeObserverEntry[]) => void> = [];
let displayRect = { left: 10, top: 20, width: 200, height: 100 };
let contexts = new WeakMap<HTMLCanvasElement, CanvasContext>();

function makeContext(): CanvasContext {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    closePath: vi.fn(),
  };
}

class TestResizeObserver {
  private readonly callback: (entries: ResizeObserverEntry[]) => void;

  constructor(callback: (entries: ResizeObserverEntry[]) => void) {
    this.callback = callback;
    observers.push(callback);
  }

  observe(): void {}

  disconnect(): void {}

  trigger(): void {
    this.callback([{ contentRect: displayRect } as ResizeObserverEntry]);
  }
}

function makeCard(overrides: Partial<AnalysisCard> = {}): AnalysisCard {
  return {
    id: "face-card",
    category: "face",
    title: "面部细节",
    summary: "保留面部身份。",
    confidence: 0.9,
    risk: "不要改变身份。",
    enabled: false,
    regions: [
      {
        id: "face-1",
        label: "脸部",
        x: 0.2,
        y: 0.2,
        width: 0.3,
        height: 0.3,
      },
    ],
    ...overrides,
  };
}

function makeTask(card: AnalysisCard = makeCard()): TaskView {
  return {
    taskId: "task-123",
    status: "awaiting_confirmation",
    analysis: [card],
    originalAssetUrl: null,
    maskAssetUrl: null,
    plan: null,
    versions: [],
    error: null,
  };
}

function dispatchPointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { clientX: number; clientY: number; pointerId: number },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    pointerId: { value: init.pointerId },
  });
  target.dispatchEvent(event);
}

beforeEach(() => {
  observers.length = 0;
  contexts = new WeakMap<HTMLCanvasElement, CanvasContext>();
  displayRect = { left: 10, top: 20, width: 200, height: 100 };
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    ...displayRect,
    right: displayRect.left + displayRect.width,
    bottom: displayRect.top + displayRect.height,
    x: displayRect.left,
    y: displayRect.top,
    toJSON: () => ({}),
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    let context = contexts.get(this);
    if (!context) {
      context = makeContext();
      contexts.set(this, context);
    }
    return context as unknown as CanvasRenderingContext2D;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MaskCanvas", () => {
  it("normalizes pointer coordinates and preserves the exact add stroke shape", () => {
    const onChange = vi.fn<(strokes: MaskStroke[]) => void>();
    render(
      <MaskCanvas
        originalImageUrl="https://example.test/original.jpg"
        regions={[]}
        strokes={[]}
        onChange={onChange}
      />,
    );

    const canvas = screen.getByTestId("mask-canvas-user");
    expect(canvas.getBoundingClientRect()).toMatchObject(displayRect);
    dispatchPointer(canvas, "pointerdown", { clientX: 60, clientY: 45, pointerId: 1 });
    dispatchPointer(canvas, "pointermove", { clientX: 110, clientY: 70, pointerId: 1 });
    dispatchPointer(canvas, "pointerup", { clientX: 110, clientY: 70, pointerId: 1 });

    expect(onChange).toHaveBeenLastCalledWith([
      {
        mode: "add",
        width: expect.any(Number),
        points: [
          { x: 0.25, y: 0.25 },
          { x: 0.5, y: 0.5 },
        ],
      },
    ]);
  });

  it("stores erase mode and undo removes only the last stroke", () => {
    const firstStroke: MaskStroke = {
      mode: "add",
      width: 20,
      points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
    };
    const onChange = vi.fn<(strokes: MaskStroke[]) => void>();
    const { rerender } = render(
      <MaskCanvas
        originalImageUrl="https://example.test/original.jpg"
        regions={[]}
        strokes={[firstStroke]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "擦除笔画" }));
    const canvas = screen.getByTestId("mask-canvas-user");
    dispatchPointer(canvas, "pointerdown", { clientX: 60, clientY: 45, pointerId: 2 });
    dispatchPointer(canvas, "pointerup", { clientX: 60, clientY: 45, pointerId: 2 });

    expect(onChange).toHaveBeenLastCalledWith([
      firstStroke,
      {
        mode: "erase",
        width: expect.any(Number),
        points: [{ x: 0.25, y: 0.25 }],
      },
    ]);

    rerender(
      <MaskCanvas
        originalImageUrl="https://example.test/original.jpg"
        regions={[]}
        strokes={[firstStroke, { mode: "add", width: 20, points: [{ x: 0.8, y: 0.8 }] }]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "撤销最后一笔" }));

    expect(onChange).toHaveBeenLastCalledWith([firstStroke]);
  });

  it("redraws normalized geometry at the new responsive size", () => {
    const stroke: MaskStroke = {
      mode: "add",
      width: 12,
      points: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }],
    };
    render(
      <MaskCanvas
        originalImageUrl="https://example.test/original.jpg"
        regions={[]}
        strokes={[stroke]}
        onChange={vi.fn()}
      />,
    );

    displayRect = { left: 10, top: 20, width: 400, height: 200 };
    act(() => {
      observers[0]([{ contentRect: displayRect } as ResizeObserverEntry]);
    });

    const canvas = screen.getByTestId("mask-canvas-user") as HTMLCanvasElement;
    const context = contexts.get(canvas);
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(200);
    expect(context?.moveTo).toHaveBeenLastCalledWith(100, 50);
    expect(context?.lineTo).toHaveBeenLastCalledWith(300, 150);
  });
});

describe("structured edit plan", () => {
  it.each([
    [25, "自然"],
    [55, "标准"],
    [80, "明显"],
  ])("maps %s intensity exactly for the %s option", (value) => {
    const plan = buildEditPlan(
      [makeCard()],
      new Set(["face-card"]),
      "natural_retouch",
      value,
    );

    expect(plan.intensity).toBe(value);
    expect(plan.operations[0].intensity).toBe(value);
  });

  it("maps selected cards, strokes, intensity and protection rules into a plan", () => {
    const stroke: MaskStroke = {
      mode: "erase",
      width: 16,
      points: [{ x: 0.4, y: 0.4 }],
    };
    const plan = buildEditPlan(
      [makeCard()],
      new Set(["face-card"]),
      "natural_retouch",
      80,
      [stroke],
      "only clean the confirmed face area",
    );

    expect(plan).toMatchObject({
      goals: ["natural_retouch"],
      intensity: 80,
      maskStrokes: [stroke],
      preserve: expect.arrayContaining([
        "face identity",
        "costume design",
        "main pose",
        "composition",
        "background structure",
        "original light direction",
        "perspective",
        "noise consistency",
      ]),
      integration: expect.any(Array),
      validation: expect.any(Array),
      notes: "only clean the confirmed face area",
    });
    expect(plan.operations).toEqual([
      expect.objectContaining({
        kind: "skin_retouch",
        regionIds: ["face-1"],
        intensity: 80,
        enabled: true,
      }),
    ]);
  });

  it("keeps all eight protection rules and caps notes without dropping structured fields", async () => {
    const savePlan = vi.fn().mockResolvedValue(undefined);
    const getTask = vi.fn().mockResolvedValue(makeTask());
    render(
      <AnalysisPanel
        task={makeTask()}
        inviteToken="invite-in-memory"
        onTaskUpdate={vi.fn()}
        apiClient={{
          createTask: vi.fn(),
          uploadOriginal: vi.fn(),
          startAnalysis: vi.fn(),
          getTask,
          savePlan,
          startGeneration: vi.fn(),
          getDownloadUrl: vi.fn(),
        }}
      />,
    );

    for (const label of [
      "脸部身份",
      "服装设计",
      "主体姿势",
      "构图",
      "背景结构",
      "光线方向",
      "透视关系",
      "噪点一致性",
    ]) {
      expect(screen.getByText(label, { exact: true })).toBeVisible();
    }
    fireEvent.click(screen.getByRole("switch", { name: "面部处理开关" }));
    fireEvent.change(screen.getByLabelText("补充说明"), {
      target: { value: "x".repeat(501) },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修图计划" }));

    await waitFor(() => expect(savePlan).toHaveBeenCalledTimes(1));
    const submitted = savePlan.mock.calls[0][1];
    expect(submitted.notes).toHaveLength(500);
    expect(submitted.goals).toEqual(["natural_retouch"]);
    expect(submitted.operations).toHaveLength(1);
    expect(submitted.preserve).toEqual(
      expect.arrayContaining([
        "face identity",
        "costume design",
        "main pose",
        "composition",
        "background structure",
        "original light direction",
        "perspective",
        "noise consistency",
      ]),
    );
  });

  it("does not save a structure-repair plan when the mask is empty", async () => {
    const savePlan = vi.fn().mockResolvedValue(undefined);
    const getTask = vi.fn().mockResolvedValue(makeTask());
    const card = makeCard({
      id: "body-card",
      category: "body_pose",
      title: "姿态连接",
    });
    const client = {
      createTask: vi.fn(),
      uploadOriginal: vi.fn(),
      startAnalysis: vi.fn(),
      getTask,
      savePlan,
      startGeneration: vi.fn(),
      getDownloadUrl: vi.fn(),
    };

    render(
      <AnalysisPanel
        task={makeTask(card)}
        inviteToken="invite-in-memory"
        onTaskUpdate={vi.fn()}
        apiClient={client}
      />,
    );

    fireEvent.click(screen.getByLabelText("结构修复"));
    fireEvent.click(screen.getByRole("switch", { name: "身体 / 姿态处理开关" }));
    fireEvent.click(screen.getByRole("button", { name: "保存修图计划" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "结构修复需要至少绘制一笔局部蒙版",
    );
    expect(savePlan).not.toHaveBeenCalled();
    expect(getTask).not.toHaveBeenCalled();
  });
});
