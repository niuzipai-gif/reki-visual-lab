import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.jsx";

describe("Reki upload entry", () => {
  it("presents the browser-local photo entry without authentication", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "REKI" })).toBeInTheDocument();
    expect(screen.getByText("视觉标注实验室")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择照片" })).toBeInTheDocument();
    expect(screen.queryByText(/登录|注册/)).not.toBeInTheDocument();
  });
});
