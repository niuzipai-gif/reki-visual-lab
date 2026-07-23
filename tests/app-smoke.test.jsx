import fs from "node:fs";
import React, { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App, useOwnedImageResource } from "../src/App.jsx";

vi.mock("../src/Workbench.jsx", () => ({
  default: ({ initialDemoProject }) => (
    <main
      role="region"
      aria-label="编辑工作台"
      data-width={initialDemoProject?.canvas?.width}
      data-height={initialDemoProject?.canvas?.height}
      data-file-name={initialDemoProject?.image?.fileName}
    >
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

  it("decodes a selected local file and opens the lazy workbench at exact dimensions", async () => {
    const source = { width: 2400, height: 1600 };
    const decode = vi.fn().mockResolvedValue({
      source,
      width: 2400,
      height: 1600,
      kind: "bitmap",
      dispose: vi.fn(),
    });
    render(<App decode={decode} />);
    const file = new File(["photo"], "cosplay.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("选择照片"), {
      target: { files: [file] },
    });

    const workbench = await screen.findByRole("region", {
      name: "编辑工作台",
    });
    expect(decode).toHaveBeenCalledWith(file);
    expect(workbench).toHaveAttribute("data-width", "2400");
    expect(workbench).toHaveAttribute("data-height", "1600");
    expect(workbench).toHaveAttribute("data-file-name", "cosplay.png");
  });

  it("defers owner disposal through StrictMode and releases the resource once on unmount", async () => {
    const dispose = vi.fn();
    const decode = vi.fn().mockResolvedValue({
      source: { width: 800, height: 600 },
      width: 800,
      height: 600,
      kind: "bitmap",
      dispose,
    });
    const view = render(
      <StrictMode>
        <App decode={decode} />
      </StrictMode>,
    );

    fireEvent.change(screen.getByLabelText("选择照片"), {
      target: {
        files: [new File(["photo"], "owned.webp", { type: "image/webp" })],
      },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "编辑工作台" }),
      ).toBeInTheDocument(),
    );

    expect(dispose).not.toHaveBeenCalled();
    view.unmount();
    expect(dispose).not.toHaveBeenCalled();
    await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
  });

  it("releases a replaced decoded resource once while retaining the current one", async () => {
    function OwnerHarness({ image }) {
      useOwnedImageResource(image);
      return null;
    }
    const first = { dispose: vi.fn() };
    const second = { dispose: vi.fn() };
    const view = render(
      <StrictMode>
        <OwnerHarness image={first} />
      </StrictMode>,
    );

    view.rerender(
      <StrictMode>
        <OwnerHarness image={second} />
      </StrictMode>,
    );

    await waitFor(() => expect(first.dispose).toHaveBeenCalledTimes(1));
    expect(second.dispose).not.toHaveBeenCalled();
    view.unmount();
    await waitFor(() => expect(second.dispose).toHaveBeenCalledTimes(1));
  });
});
