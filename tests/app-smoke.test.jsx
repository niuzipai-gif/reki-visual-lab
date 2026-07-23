import fs from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App.jsx";

vi.mock("../src/Workbench.jsx", () => ({
  default: () => (
    <main role="region" aria-label="编辑工作台">
      lazy workbench
    </main>
  ),
}));

describe("Reki upload entry", () => {
  it("presents the browser-local photo entry without authentication", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "REKI" })).toBeInTheDocument();
    expect(screen.getByText("视觉标注实验室")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择照片" })).toBeInTheDocument();
    expect(screen.queryByText(/登录|注册/)).not.toBeInTheDocument();
  });

  it("keeps the entry module free of static editor and canvas imports", () => {
    const source = fs.readFileSync("src/App.jsx", "utf8");

    expect(source).toMatch(
      /lazy\(\(\)\s*=>\s*import\(["']\.\/Workbench\.jsx["']\)\)/,
    );
    expect(source).not.toMatch(
      /EditorCanvas|features\/tools\/presets|react-konva/,
    );
  });

  it("loads the demo workbench behind a suspense boundary", async () => {
    render(<App initialDemoProject />);

    expect(
      screen.queryByRole("region", { name: "编辑工作台" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("region", { name: "编辑工作台" }),
    ).toBeInTheDocument();
  });
});
