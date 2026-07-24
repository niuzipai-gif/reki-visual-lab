import React, { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BackgroundLayer } from "./BackgroundLayer.jsx";
import { analyzeImageFeatures } from "../ai/styleAdvisor.js";

const canvasSize = { width: 1080, height: 1350 };
const filters = {
  brightness: 0.9,
  contrast: 1.2,
  saturation: 0.8,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  test("passes a bounded local pixel sample for nonzero style feature analysis", async () => {
    const drawable = { width: 800, height: 1000 };
    const onImageSourceReady = vi.fn();
    const sample = {
      width: 64,
      height: 64,
      data: new Uint8ClampedArray(Array.from({ length: 64 * 64 * 4 }, (_, index) => index % 4 === 3 ? 255 : index % 4 === 0 ? 220 : 30)),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => sample),
    });

    render(
      <BackgroundLayer
        image={drawable}
        canvasSize={canvasSize}
        filters={{}}
        onImageSourceReady={onImageSourceReady}
      />,
    );

    await waitFor(() => expect(onImageSourceReady).toHaveBeenCalledWith(
      drawable,
      expect.objectContaining({ imageData: sample, width: 800, height: 1000 }),
    ));
    const features = analyzeImageFeatures(onImageSourceReady.mock.calls[0][1]);
    expect(features.saturation).toBeGreaterThan(0);
    expect(features.luminance).toBeGreaterThan(0);
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

  test("redraws from originalFile and restores the working preview after toggling", async () => {
    const workingSource = { width: 2, height: 1, name: "working-preview" };
    const originalSource = { width: 8, height: 4, name: "original-file" };
    const originalFile = new Blob(["original"], { type: "image/png" });
    const drawImage = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(originalSource));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
      getImageData: vi.fn(
        () => new ImageData(new Uint8ClampedArray([120, 120, 120, 255]), 1, 1),
      ),
      putImageData: vi.fn(),
    });
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    const image = { source: workingSource, originalFile };
    const { rerender } = render(
      <BackgroundLayer
        image={image}
        canvasSize={{ width: 1, height: 1 }}
        filters={{ threshold: 128 }}
      />,
    );
    await waitFor(() =>
      expect(drawImage).toHaveBeenCalledWith(workingSource, 0, 0, 1, 1),
    );

    drawImage.mockClear();
    rerender(
      <BackgroundLayer
        image={image}
        canvasSize={{ width: 1, height: 1 }}
        filters={{ threshold: 128 }}
        showOriginal
      />,
    );
    await waitFor(() =>
      expect(drawImage).toHaveBeenCalledWith(originalSource, 0, 0, 1, 1),
    );

    drawImage.mockClear();
    rerender(
      <BackgroundLayer
        image={image}
        canvasSize={{ width: 1, height: 1 }}
        filters={{ threshold: 128 }}
      />,
    );
    await waitFor(() =>
      expect(drawImage).toHaveBeenCalledWith(workingSource, 0, 0, 1, 1),
    );
  });

  test.each([
    ["URL", "blob:original-url"],
    ["ImageBitmap", { width: 8, height: 4, name: "original-bitmap" }],
    ["HTMLImageElement", document.createElement("img")],
  ])("uses an %s originalFile instead of the processed source", async (_name, originalFile) => {
    const workingSource = { width: 2, height: 1, name: "working-preview" };
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
    });
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    render(
      <BackgroundLayer
        image={{ source: workingSource, originalFile }}
        canvasSize={{ width: 1, height: 1 }}
        filters={{}}
        showOriginal
      />,
    );

    if (typeof originalFile === "string") {
      const source = screen.getByTestId("background-image-source");
      fireEvent.load(source);
    }

    await waitFor(() =>
      expect(drawImage).toHaveBeenCalledWith(
        typeof originalFile === "string"
          ? screen.getByTestId("background-image-source")
          : originalFile,
        0,
        0,
        1,
        1,
      ),
    );
  });

  test("reports original decode failure after ImageBitmap and object-URL fallback fail", async () => {
    const originalFile = new Blob(["invalid"], { type: "image/png" });
    const createImageBitmap = vi.fn().mockRejectedValue(new Error("decode failed"));
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue(
      "blob:original-fallback",
    );
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const fallbackImage = { onload: null, onerror: null };
    Object.defineProperty(fallbackImage, "src", {
      configurable: true,
      set() {
        queueMicrotask(() => fallbackImage.onerror?.());
      },
    });
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    vi.stubGlobal("Image", vi.fn(() => fallbackImage));

    render(
      <BackgroundLayer
        image={{ source: { width: 1, height: 1 }, originalFile }}
        canvasSize={{ width: 1, height: 1 }}
        filters={{}}
        showOriginal
      />,
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "原图不可用，请重新导入",
    );
    expect(createImageBitmap).toHaveBeenCalledWith(originalFile, {
      imageOrientation: "from-image",
    });
    expect(createObjectURL).toHaveBeenCalledWith(originalFile);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:original-fallback");
  });

  test("ignores a stale original decode when a newer source generation wins", async () => {
    const firstFile = new Blob(["first"], { type: "image/png" });
    const secondFile = new Blob(["second"], { type: "image/png" });
    const firstOriginal = { width: 8, height: 4, name: "first-original" };
    const secondOriginal = { width: 16, height: 8, name: "second-original" };
    const decodeResolvers = [];
    const drawImage = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(
        () =>
          new Promise((resolve) => {
            decodeResolvers.push(resolve);
          }),
      ),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
    });
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    const firstImage = {
      source: { width: 1, height: 1, name: "working-first" },
      originalFile: firstFile,
    };
    const secondImage = {
      source: { width: 1, height: 1, name: "working-second" },
      originalFile: secondFile,
    };
    const { rerender } = render(
      <BackgroundLayer
        image={firstImage}
        canvasSize={{ width: 1, height: 1 }}
        filters={{}}
        showOriginal
      />,
    );
    await waitFor(() => expect(decodeResolvers).toHaveLength(1));

    rerender(
      <BackgroundLayer
        image={secondImage}
        canvasSize={{ width: 1, height: 1 }}
        filters={{}}
        showOriginal
      />,
    );
    await waitFor(() => expect(decodeResolvers).toHaveLength(2));

    decodeResolvers[0](firstOriginal);
    await Promise.resolve();
    expect(drawImage).not.toHaveBeenCalledWith(firstOriginal, 0, 0, 1, 1);

    decodeResolvers[1](secondOriginal);
    await waitFor(() =>
      expect(drawImage).toHaveBeenCalledWith(secondOriginal, 0, 0, 1, 1),
    );
  });

  test("cancels a queued frame when comparison mode changes", async () => {
    const frames = [];
    const cancelAnimationFrame = vi.fn();
    const workingSource = { width: 1, height: 1, name: "working" };
    const originalSource = { width: 1, height: 1, name: "original" };
    const drawImage = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      const handle = frames.length + 1;
      frames.push({ handle, callback });
      return handle;
    });
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
    });

    const image = { source: workingSource, originalFile: originalSource };
    const { rerender } = render(
      <BackgroundLayer
        image={image}
        canvasSize={{ width: 1, height: 1 }}
        filters={{}}
      />,
    );
    await waitFor(() => expect(frames).toHaveLength(1));

    rerender(
      <BackgroundLayer
        image={image}
        canvasSize={{ width: 1, height: 1 }}
        filters={{}}
        showOriginal
      />,
    );
    await waitFor(() => expect(frames).toHaveLength(2));
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);

    frames[0].callback(0);
    expect(drawImage).not.toHaveBeenCalled();
    frames[1].callback(0);
    expect(drawImage).toHaveBeenCalledWith(originalSource, 0, 0, 1, 1);
  });
});
