import React, { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  test("uses a URL image source with a dedicated filtered output canvas", () => {
    render(
      <BackgroundLayer
        image="blob:reki-preview"
        canvasSize={canvasSize}
        filters={filters}
      />,
    );

    const background = screen.getByTestId("canvas-background");
    const image = screen.getByTestId("background-image-source");
    const canvas = screen.getByTestId("background-image");

    expect(image.tagName).toBe("IMG");
    expect(image).toHaveAttribute("src", "blob:reki-preview");
    expect(canvas.tagName).toBe("CANVAS");
    expect(background).toHaveStyle({
      filter: "brightness(0.9) contrast(1.2) saturate(0.8)",
    });
  });

  test.each([
    ["ImageBitmap-like value", { width: 800, height: 1000 }],
    ["HTMLCanvasElement", document.createElement("canvas")],
    ["HTMLImageElement", document.createElement("img")],
  ])("draws a %s into a project-sized background canvas", async (_name, drawable) => {
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
    await waitFor(() =>
      expect(drawImage).toHaveBeenCalledWith(drawable, 0, 0, 1080, 1350),
    );
  });

  test("reports only a successfully drawn source as AI-scan ready", async () => {
    const drawable = { width: 800, height: 1000 };
    const onImageSourceReady = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    });

    render(
      <BackgroundLayer
        image={drawable}
        canvasSize={canvasSize}
        filters={{}}
        onImageSourceReady={onImageSourceReady}
      />,
    );

    await waitFor(() =>
      expect(onImageSourceReady).toHaveBeenCalledWith(drawable),
    );
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

  test("keeps decoded sources borrowed across StrictMode remount and final unmount", async () => {
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
      await waitFor(() => expect(drawImage).toHaveBeenCalled());
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

  test("routes the demo asset through the same pixel canvas pipeline", async () => {
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(
        () =>
          new ImageData(
            new Uint8ClampedArray([120, 120, 120, 255]),
            1,
            1,
          ),
      ),
      putImageData,
    });
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const onImageSourceReady = vi.fn();
    render(
      <BackgroundLayer
        image={{ demo: true }}
        canvasSize={{ width: 1, height: 1 }}
        filters={{
          threshold: 128,
          duotone: { dark: [10, 20, 30], light: [240, 220, 170] },
        }}
        onImageSourceReady={onImageSourceReady}
      />,
    );

    expect(screen.getByTestId("canvas-background")).toHaveClass("demo-canvas");
    const source = screen.getByTestId("background-image-source");
    expect(source).toHaveAttribute("src", "/cosplay-reference.png");
    fireEvent.load(source);
    await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(1));
    expect(onImageSourceReady).toHaveBeenCalledWith(source);
    expect(Array.from(putImageData.mock.calls[0][0].data)).toEqual([
      10, 20, 30, 255,
    ]);
  });

  test("writes filtered pixels to the dedicated background canvas", async () => {
    const filteredPixels = new ImageData(
      new Uint8ClampedArray([120, 120, 120, 255]),
      1,
      1,
    );
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => filteredPixels),
      putImageData,
    });
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    render(
      <BackgroundLayer
        image={{ source: { width: 1, height: 1 }, width: 1, height: 1 }}
        canvasSize={{ width: 1, height: 1 }}
        filters={{
          threshold: 128,
          duotone: { dark: [10, 20, 30], light: [240, 220, 170] },
        }}
      />,
    );

    await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(1));
    expect(Array.from(putImageData.mock.calls[0][0].data)).toEqual([
      10, 20, 30, 255,
    ]);
    expect(screen.getByTestId("canvas-background").style.filter).toBe("");
  });

  test("bounds large pixel previews to a 1600px maximum edge", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(
        () => new ImageData(new Uint8ClampedArray(1600 * 800 * 4), 1600, 800),
      ),
      putImageData: vi.fn(),
    });
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    render(
      <BackgroundLayer
        image={{ source: { width: 4000, height: 2000 }, width: 4000, height: 2000 }}
        canvasSize={{ width: 4000, height: 2000 }}
        filters={{ threshold: 128 }}
      />,
    );

    expect(screen.getByTestId("background-image")).toHaveAttribute(
      "width",
      "1600",
    );
    expect(screen.getByTestId("background-image")).toHaveAttribute(
      "height",
      "800",
    );
  });

  test("filters a loaded URL image and keeps a nonfatal unfiltered fallback on taint", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        throw new DOMException("Tainted canvases may not be exported");
      }),
      putImageData: vi.fn(),
    });
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    render(
      <BackgroundLayer
        image="https://images.example/photo.jpg"
        canvasSize={{ width: 800, height: 600 }}
        filters={{ threshold: 128 }}
      />,
    );
    const source = screen.getByTestId("background-image-source");
    Object.defineProperty(source, "naturalWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(source, "naturalHeight", {
      configurable: true,
      value: 600,
    });
    fireEvent.load(source);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "无法应用像素效果，已保留原图",
    );
    expect(screen.getByTestId("background-image")).toBeInTheDocument();
  });

  test("never redraws a previous URL source after the image is replaced", () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
      getImageData: vi.fn(
        () => new ImageData(new Uint8ClampedArray(4), 1, 1),
      ),
      putImageData: vi.fn(),
    });
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const { rerender } = render(
      <BackgroundLayer
        image="blob:first"
        canvasSize={{ width: 1, height: 1 }}
        filters={{ threshold: 128 }}
      />,
    );
    const first = screen.getByTestId("background-image-source");
    fireEvent.load(first);
    expect(drawImage).toHaveBeenCalledWith(first, 0, 0, 1, 1);
    drawImage.mockClear();

    rerender(
      <BackgroundLayer
        image="blob:second"
        canvasSize={{ width: 1, height: 1 }}
        filters={{ threshold: 128 }}
      />,
    );

    expect(drawImage).not.toHaveBeenCalled();
  });

  test("draws without pixel readback when no pixel effect is active", async () => {
    const getImageData = vi.fn();
    const putImageData = vi.fn();
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
      getImageData,
      putImageData,
    });
    const drawable = { width: 800, height: 600 };

    render(
      <BackgroundLayer
        image={{ source: drawable, width: 800, height: 600 }}
        canvasSize={{ width: 800, height: 600 }}
        filters={{ brightness: 0.9, contrast: 1.1 }}
      />,
    );

    await waitFor(() => expect(drawImage).toHaveBeenCalled());
    expect(getImageData).not.toHaveBeenCalled();
    expect(putImageData).not.toHaveBeenCalled();
    expect(
      screen.queryByText("无法应用像素效果，已保留原图"),
    ).not.toBeInTheDocument();
  });

  test("reuses cached source pixels across filter-only updates", async () => {
    const pixels = new ImageData(
      new Uint8ClampedArray([120, 120, 120, 255]),
      1,
      1,
    );
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => pixels);
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
      getImageData,
      putImageData,
    });
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const image = { source: { width: 1, height: 1 }, width: 1, height: 1 };
    const { rerender } = render(
      <BackgroundLayer
        image={image}
        canvasSize={{ width: 1, height: 1 }}
        filters={{ threshold: 128 }}
      />,
    );
    expect(putImageData).toHaveBeenCalledTimes(1);

    rerender(
      <BackgroundLayer
        image={image}
        canvasSize={{ width: 1, height: 1 }}
        filters={{ threshold: 140 }}
      />,
    );

    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(getImageData).toHaveBeenCalledTimes(1);
    expect(putImageData).toHaveBeenCalledTimes(2);
  });

  test("reports a clear URL load error without attempting pixel readback", () => {
    const getImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData,
      putImageData: vi.fn(),
    });
    render(
      <BackgroundLayer
        image="blob:missing"
        canvasSize={{ width: 800, height: 600 }}
        filters={{ threshold: 128 }}
      />,
    );

    fireEvent.error(screen.getByTestId("background-image-source"));

    expect(screen.getByRole("status")).toHaveTextContent(
      "无法加载底图，请重新选择照片",
    );
    expect(getImageData).not.toHaveBeenCalled();
  });
});
