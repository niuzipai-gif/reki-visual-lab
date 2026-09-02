import { afterEach, describe, expect, test, vi } from "vitest";
import {
  SUPPORTED_IMAGE_TYPES,
  MAX_DECODED_PIXELS,
  decodeImage,
  previewSize,
  validateImageFile,
} from "./decodeImage.js";

const originalCreateImageBitmap = globalThis.createImageBitmap;
const OriginalImage = globalThis.Image;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

afterEach(() => {
  if (originalCreateImageBitmap) {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  } else {
    delete globalThis.createImageBitmap;
  }
  globalThis.Image = OriginalImage;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.restoreAllMocks();
});

describe("image import validation", () => {
  test("accepts JPG, PNG, and WebP files up to 40 MB", () => {
    expect(SUPPORTED_IMAGE_TYPES).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);

    for (const type of SUPPORTED_IMAGE_TYPES) {
      expect(
        validateImageFile({ type, size: 40 * 1024 * 1024 }),
      ).toEqual({ ok: true });
    }
  });

  test("rejects video and other image types with a friendly message", () => {
    expect(validateImageFile({ type: "video/mp4", size: 100 })).toEqual({
      ok: false,
      message: "请选择 JPG、PNG 或 WebP 图片",
    });
    expect(validateImageFile({ type: "image/gif", size: 100 })).toEqual({
      ok: false,
      message: "请选择 JPG、PNG 或 WebP 图片",
    });
  });

  test("rejects images over 40 MB", () => {
    expect(
      validateImageFile({
        type: "image/png",
        size: 40 * 1024 * 1024 + 1,
      }),
    ).toEqual({ ok: false, message: "图片不能超过 40 MB" });
  });

  test("bounds preview dimensions while preserving aspect ratio", () => {
    expect(previewSize(4000, 2000)).toEqual({ width: 1600, height: 800 });
    expect(previewSize(600, 900)).toEqual({ width: 600, height: 900 });
    expect(previewSize(2000, 4000, 1000)).toEqual({
      width: 500,
      height: 1000,
    });
  });

  test.each([
    [0, 400],
    [-1, 400],
    [400, Number.NaN],
    [Number.POSITIVE_INFINITY, 400],
    [400, 400, 0],
  ])("returns a safe empty preview for invalid dimensions", (width, height, maxEdge) => {
    expect(previewSize(width, height, maxEdge)).toEqual({
      width: 0,
      height: 0,
    });
  });
});

describe("decodeImage", () => {
  test("prefers orientation-aware ImageBitmap decoding", async () => {
    const bitmap = { width: 1200, height: 900, close: vi.fn() };
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bitmap);
    const file = new File(["photo"], "portrait.jpg", { type: "image/jpeg" });

    const decoded = await decodeImage(file);

    expect(globalThis.createImageBitmap).toHaveBeenCalledWith(file, {
      imageOrientation: "from-image",
    });
    expect(decoded).toMatchObject({
      source: bitmap,
      width: 1200,
      height: 900,
      kind: "bitmap",
    });
    expect(bitmap.close).not.toHaveBeenCalled();
  });

  test("closes an ImageBitmap exactly once through its owner contract", async () => {
    const bitmap = { width: 800, height: 600, close: vi.fn() };
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bitmap);

    const decoded = await decodeImage(
      new File(["photo"], "photo.webp", { type: "image/webp" }),
    );
    decoded.dispose();
    decoded.dispose();

    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  test.each(["unavailable", "rejected"])(
    "falls back to an object URL when ImageBitmap is %s",
    async (mode) => {
      if (mode === "unavailable") {
        delete globalThis.createImageBitmap;
      } else {
        globalThis.createImageBitmap = vi
          .fn()
          .mockRejectedValue(new DOMException("decode failed"));
      }
      const revokeObjectURL = vi.fn();
      URL.createObjectURL = vi.fn(() => "blob:reki-fallback");
      URL.revokeObjectURL = revokeObjectURL;
      globalThis.Image = class FakeImage {
        set src(value) {
          this.currentSrc = value;
          this.naturalWidth = 1200;
          this.naturalHeight = 900;
          queueMicrotask(() => this.onload?.());
        }
      };

      const decoded = await decodeImage(
        new File(["photo"], "photo.png", { type: "image/png" }),
      );

      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(decoded).toMatchObject({
        width: 1200,
        height: 900,
        kind: "image",
      });
      expect(decoded.source.currentSrc).toBe("blob:reki-fallback");
      expect(revokeObjectURL).not.toHaveBeenCalled();

      decoded.dispose();
      decoded.dispose();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:reki-fallback");
    },
  );

  test("revokes the fallback URL and rejects when the image cannot decode", async () => {
    delete globalThis.createImageBitmap;
    URL.createObjectURL = vi.fn(() => "blob:reki-broken");
    URL.revokeObjectURL = vi.fn();
    globalThis.Image = class BrokenImage {
      set src(_value) {
        queueMicrotask(() => this.onerror?.(new Event("error")));
      }
    };

    await expect(
      decodeImage(new File(["bad"], "bad.png", { type: "image/png" })),
    ).rejects.toThrow("无法读取这张图片");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:reki-broken");
  });

  test("rejects oversized decoded bitmaps and closes them immediately", async () => {
    expect(MAX_DECODED_PIXELS).toBe(40_000_000);
    const bitmap = { width: 10000, height: 5000, close: vi.fn() };
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bitmap);
    URL.createObjectURL = vi.fn(() => "blob:should-not-fallback");

    await expect(
      decodeImage(new File(["huge"], "huge.jpg", { type: "image/jpeg" })),
    ).rejects.toThrow("图片像素不能超过 4000 万");
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  test("retains original metadata and creates a bounded working canvas", async () => {
    const bitmap = { width: 4000, height: 2000, close: vi.fn() };
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bitmap);
    const drawImage = vi.fn();
    const workingCanvas = document.createElement("canvas");
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") return workingCanvas;
      return createElement(tagName);
    });
    vi.spyOn(workingCanvas, "getContext").mockReturnValue({ drawImage });
    const file = new File(["photo"], "large.webp", { type: "image/webp" });

    const decoded = await decodeImage(file);

    expect(decoded).toMatchObject({
      source: workingCanvas,
      width: 4000,
      height: 2000,
      originalWidth: 4000,
      originalHeight: 2000,
      workingWidth: 1600,
      workingHeight: 800,
      originalFile: file,
      kind: "canvas",
    });
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1600, 800);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    decoded.dispose();
    decoded.dispose();
    expect(workingCanvas.width).toBe(0);
    expect(workingCanvas.height).toBe(0);
  });
});
