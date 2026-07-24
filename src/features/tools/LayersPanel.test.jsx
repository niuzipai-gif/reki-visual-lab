import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { LayersPanel } from "./LayersPanel.jsx";

const layer = {
  id: "layer-a",
  name: "路径 A",
  type: "path",
  visible: true,
  locked: false,
};

describe("LayersPanel clear-all action", () => {
  test("disables clear-all when there are no layers", () => {
    render(
      <LayersPanel
        layers={[]}
        selectedLayerId={null}
        onSelect={vi.fn()}
        onAction={vi.fn()}
        onClearAll={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "清除全部图层" }),
    ).toBeDisabled();
  });

  test("notifies the workbench when clear-all is clicked", async () => {
    const user = userEvent.setup();
    const onClearAll = vi.fn();
    render(
      <LayersPanel
        layers={[layer]}
        selectedLayerId={layer.id}
        onSelect={vi.fn()}
        onAction={vi.fn()}
        onClearAll={onClearAll}
      />,
    );

    await user.click(screen.getByRole("button", { name: "清除全部图层" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});
