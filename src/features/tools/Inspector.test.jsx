import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { createAnnotation } from "../../domain/project.js";
import { Inspector } from "./Inspector.jsx";

describe("Inspector layer type badge", () => {
  test("uses the shared human-facing Chinese type label", () => {
    render(
      <Inspector
        layer={createAnnotation("path", [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }])}
        onPatch={vi.fn()}
        onBatchLabel={vi.fn()}
        onApplyStyle={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("节点路径", { selector: ".type-badge" })).toBeVisible();
  });
});
