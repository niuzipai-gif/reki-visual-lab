import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { OriginalComparisonPane } from "./OriginalComparisonPane.jsx";

vi.mock("./BackgroundLayer.jsx", () => ({
  BackgroundLayer: ({ image, canvasSize, filters, effectStack, showOriginal }) => (
    <div
      data-testid="original-comparison-background"
      data-image-id={image?.originalFile?.name ?? image?.source?.name ?? "unknown"}
      data-canvas-size={`${canvasSize.width}x${canvasSize.height}`}
      data-filters={JSON.stringify(filters)}
      data-effect-stack={JSON.stringify(effectStack)}
      data-original={String(showOriginal)}
    />
  ),
}));

describe("OriginalComparisonPane", () => {
  test("shows the original source in an unfiltered sibling surface", () => {
    render(
      <OriginalComparisonPane
        image={{
          source: { name: "working-preview" },
          originalFile: { name: "camera-original" },
        }}
        canvasSize={{ width: 1080, height: 1350 }}
        zoom={125}
        presentationSize={{ width: 540, height: 600 }}
      />,
    );

    const pane = screen.getByLabelText("原图实时对照");
    const background = screen.getByTestId("original-comparison-background");

    expect(pane).toHaveAttribute("data-effect-count", "0");
    expect(pane).toHaveAttribute("data-animation", "none");
    expect(pane).toHaveAttribute("data-zoom", "125");
    expect(background).toHaveAttribute("data-image-id", "camera-original");
    expect(background).toHaveAttribute("data-canvas-size", "1080x1350");
    expect(background).toHaveAttribute("data-filters", "{}");
    expect(background).toHaveAttribute("data-effect-stack", "[]");
    expect(background).toHaveAttribute("data-original", "true");
  });

  test("keeps its source-and-size cache key stable until either changes", () => {
    const image = { originalFile: { name: "camera-original" } };
    const { rerender } = render(
      <OriginalComparisonPane
        image={image}
        canvasSize={{ width: 1080, height: 1350 }}
        presentationSize={{ width: 540, height: 600 }}
      />,
    );

    const pane = screen.getByLabelText("原图实时对照");
    const firstKey = pane.getAttribute("data-cache-key");

    rerender(
      <OriginalComparisonPane
        image={image}
        canvasSize={{ width: 1080, height: 1350 }}
        presentationSize={{ width: 540, height: 600 }}
      />,
    );
    expect(pane).toHaveAttribute("data-cache-key", firstKey);

    rerender(
      <OriginalComparisonPane
        image={image}
        canvasSize={{ width: 1080, height: 1350 }}
        presentationSize={{ width: 480, height: 600 }}
      />,
    );
    expect(pane).not.toHaveAttribute("data-cache-key", firstKey);
  });
});
