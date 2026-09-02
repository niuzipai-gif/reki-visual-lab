import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TopBar } from "./TopBar.jsx";

describe("TopBar branding", () => {
  test("uses the canonical transparent character mark asset", () => {
    render(
      <TopBar
        canUndo={false}
        canRedo={false}
        backgroundVisible
        canvas={{ width: 1080, height: 1350 }}
        onUndo={() => {}}
        onRedo={() => {}}
        onToggleBackground={() => {}}
        onExport={() => {}}
      />,
    );

    expect(document.querySelector(".brand-icon img")).toHaveAttribute(
      "src",
      "/brand/reki-character-mark.png",
    );
  });

  test("uses a generic export entry label", () => {
    render(
      <TopBar
        canUndo={false}
        canRedo={false}
        backgroundVisible
        canvas={{ width: 1080, height: 1350 }}
        onUndo={() => {}}
        onRedo={() => {}}
        onToggleBackground={() => {}}
        onExport={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "导出" })).toBeVisible();
  });
});
