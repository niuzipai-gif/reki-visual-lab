import React, { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BackgroundLayer } from "./BackgroundLayer.jsx";

const canvasSize = { width: 1080, height: 1350 };
const filters = {
  brightness: 0.9,
  contrast: 1.2,
  saturation: 0.8,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BackgroundLayer", () => {
  test("uses an img for URL sources and keeps preview filters on its own layer", () => {
    render(
      <BackgroundLayer
        image="blob:reki-preview"
        canvasSize={canvasSize}
        filters={filters}
      />,
    );

    const background = screen.getByTestId("canvas-background");
    const image = screen.getByTestId("background-image");

    expect(image.tagName).toBe("IMG");
    expect(image).toHaveAttribute("src", "blob:reki-preview");
    expect(background).toHaveStyle({
      filter: "brightness(0.9) contrast(1.2) saturate(0.8)",
    });
  });

  test.each([
    ["ImageBitmap-like value", { width: 800, height: 1000 }],
    ["HTMLCanvasElement", document.createElement("canvas")],
    ["HTMLImageElement", document.createElement("img")],
  ])("draws a %s into a project-sized background canvas", (_name, drawable) => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
    });

    render(
      <BackgroundLayer
        image={drawable}
        canvasSize={canvasSize}
        filters={filters}
      />,
    );

    const canvas = screen.getByTestId("background-image");
    expect(canvas.tagName).toBe("CANVAS");
    expect(canvas).toHaveAttribute("width", "1080");
    expect(canvas).toHaveAttribute("height", "1350");
    expect(drawImage).toHaveBeenCalledWith(drawable, 0, 0, 1080, 1350);
  });

  test("keeps the visible canvas mounted when drawImage rejects a drawable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(() => {
        throw new DOMException("Image is not ready");
      }),
    });

    expect(() =>
      render(
        <BackgroundLayer
          image={{ width: 800, height: 1000 }}
          canvasSize={canvasSize}
          filters={filters}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByTestId("background-image").tagName).toBe("CANVAS");
  });

  test("keeps decoded sources borrowed across StrictMode remount and final unmount", () => {
    const drawable = {
      width: 800,
      height: 1000,
      closed: false,
      close: vi.fn(() => {
        drawable.closed = true;
      }),
    };
    const drawImage = vi.fn((source) => {
      if (source.closed) throw new DOMException("ImageBitmap is closed");
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
    });
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const revokeObjectURL = vi.fn();
    URL.revokeObjectURL = revokeObjectURL;

    const bitmapView = render(
      <StrictMode>
        <BackgroundLayer
          image={{ bitmap: drawable, owned: true }}
          canvasSize={canvasSize}
          filters={filters}
        />
      </StrictMode>,
    );

    try {
      expect(drawImage).toHaveBeenCalledTimes(2);
      expect(drawable.closed).toBe(false);
      expect(drawable.close).not.toHaveBeenCalled();

      bitmapView.unmount();
      expect(drawable.closed).toBe(false);
      expect(drawable.close).not.toHaveBeenCalled();

      const urlView = render(
        <StrictMode>
          <BackgroundLayer
            image={{ url: "blob:reki-owned-upstream", owned: true }}
            canvasSize={canvasSize}
            filters={filters}
          />
        </StrictMode>,
      );

      expect(revokeObjectURL).not.toHaveBeenCalled();
      urlView.unmount();
      expect(revokeObjectURL).not.toHaveBeenCalled();
    } finally {
      if (originalRevokeObjectURL) {
        URL.revokeObjectURL = originalRevokeObjectURL;
      } else {
        delete URL.revokeObjectURL;
      }
    }
  });

  test("uses the CSS demo path without creating a media element", () => {
    render(
      <BackgroundLayer
        image={{ demo: true }}
        canvasSize={canvasSize}
        filters={filters}
      />,
    );

    expect(screen.getByTestId("canvas-background")).toHaveClass("demo-canvas");
    expect(screen.queryByTestId("background-image")).not.toBeInTheDocument();
  });
});
