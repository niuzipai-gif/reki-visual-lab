import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { AiStylePanel } from "./AiStylePanel.jsx";

const recommendations = [
  { id: "one", name: "第一方案", description: "desc", filters: { contrast: 1.1 }, annotationType: "path", density: 60, labelMode: "single", risk: "risk" },
  { id: "two", name: "第二方案", description: "desc", filters: { contrast: 1.2 }, annotationType: "orbit", density: 60, labelMode: "single", risk: "risk" },
  { id: "three", name: "第三方案", description: "desc", filters: { contrast: 1.3 }, annotationType: "nodeCloud", density: 60, labelMode: "single", risk: "risk" },
];

describe("AI style panel", () => {
  test("analyzes locally, sends summary for advice, and renders exactly three cards", async () => {
    const user = userEvent.setup();
    const analyzeFeatures = vi.fn().mockReturnValue({ width: 100, height: 120 });
    const getAdvice = vi.fn().mockResolvedValue({ source: "remote", recommendations });

    render(<AiStylePanel imageSource={{ width: 100 }} analyzeFeatures={analyzeFeatures} getAdvice={getAdvice} />);
    await user.click(screen.getByRole("button", { name: "获取 AI 风格建议" }));

    expect(analyzeFeatures).toHaveBeenCalledWith({ width: 100 });
    expect(getAdvice).toHaveBeenCalledWith({ width: 100, height: 120 });
    expect(screen.getAllByRole("article", { name: /风格方案/ })).toHaveLength(3);
    expect(screen.getByText("来自云端 AI 建议")).toBeInTheDocument();
  });

  test("falls back to offline advice and dispatches one atomic style/apply action", async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    const getAdvice = vi.fn().mockResolvedValue({ source: "offline", error: "TIMEOUT", recommendations });

    render(<AiStylePanel imageSource={{ width: 100 }} getAdvice={getAdvice} dispatch={dispatch} />);
    await user.click(screen.getByRole("button", { name: "获取 AI 风格建议" }));

    expect(screen.getByText(/离线风格建议/)).toBeInTheDocument();
    const cards = screen.getAllByRole("article", { name: /风格方案/ });
    await user.click(within(cards[0]).getByRole("button", { name: "应用此方案" }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "style/apply", recommendation: expect.objectContaining({ id: "one" }) }));
  });
});
