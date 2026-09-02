import { describe, expect, test, vi } from "vitest";

vi.mock("mp4-muxer", () => ({
  ArrayBufferTarget: class { buffer = new ArrayBuffer(0); },
  Muxer: class { addVideoChunk() {} finalize() {} },
}));
import {
  createLivePhotoBundle,
  createMotionPlan,
  renderMotion,
  selectVideoEncoder,
} from "./motionRenderer.js";

describe("motionRenderer", () => {
  test("bounds the default motion plan to 24fps and a 720p edge", () => {
    const plan = createMotionPlan({ width: 2400, height: 1200 }, { durationMs: 4000 });
    expect(plan).toMatchObject({ width: 720, height: 360, fps: 24, durationMs: 4000, frameCount: 96 });
  });

  test("prefers MP4 only when WebCodecs H.264 is available", async () => {
    const supportedEncoder = {
      isConfigSupported: vi.fn(async () => ({ supported: true })),
    };
    await expect(selectVideoEncoder({ VideoEncoder: supportedEncoder, MediaRecorder: class {} }))
      .resolves.toMatchObject({ container: "mp4", extension: "mp4" });
  });

  test("falls back to WebM instead of lying about an MP4 extension", async () => {
    await expect(selectVideoEncoder({ MediaRecorder: class {} }))
      .resolves.toMatchObject({ container: "webm", extension: "webm" });
  });

  test("returns a cover plus a video in a conversion bundle", async () => {
    const archive = await createLivePhotoBundle({
      cover: new Blob(["cover"], { type: "image/jpeg" }),
      video: new Blob(["movie"], { type: "video/mp4" }),
      videoExtension: "mp4",
    });
    const { unzipSync } = await import("fflate");
    expect(Object.keys(unzipSync(new Uint8Array(await archive.arrayBuffer()))).sort())
      .toEqual(["README.txt", "cover.jpg", "motion.mp4"]);
  });

  test("does not render another frame after cancellation", async () => {
    const controller = new AbortController();
    const renderFrame = vi.fn(async ({ frameIndex }) => {
      if (frameIndex === 0) controller.abort();
      return new Blob(["frame"], { type: "image/png" });
    });
    await expect(renderMotion({
      project: { canvas: { width: 100, height: 100 }, motion: { durationMs: 1000 } },
      sourceBitmap: {},
      kind: "gif",
      signal: controller.signal,
      renderFrame,
      canvasFactory: () => ({ getContext: () => ({}) }),
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(renderFrame).toHaveBeenCalledTimes(1);
  });

  test("paces WebM frame requests at 24fps instead of stopping after a burst", async () => {
    const waitForFrame = vi.fn(async () => {});
    const requestFrame = vi.fn();
    const recorderInstances = [];
    class Recorder {
      static isTypeSupported() { return true; }
      constructor() { recorderInstances.push(this); }
      start() {}
      stop() {
        this.ondataavailable?.({ data: new Blob(["webm"], { type: "video/webm" }) });
        this.onstop?.();
      }
    }
    const canvasFactory = vi.fn(() => ({
      getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }),
      captureStream: vi.fn((frameRate) => ({ getVideoTracks: () => [{ requestFrame }] , frameRate })),
    }));
    const progress = vi.fn();
    const result = await renderMotion({
      project: { canvas: { width: 100, height: 100 }, motion: { durationMs: 1000 } },
      sourceBitmap: {},
      environment: { MediaRecorder: Recorder },
      canvasFactory,
      decodeFrame: async () => ({ close: vi.fn() }),
      waitForFrame,
      onProgress: progress,
      renderFrame: async () => new Blob(["frame"], { type: "image/png" }),
    });
    expect(result).toMatchObject({ extension: "webm", plan: { frameCount: 24, fps: 24 } });
    expect(canvasFactory.mock.results[0].value.captureStream).toHaveBeenCalledWith(0);
    expect(requestFrame).toHaveBeenCalledTimes(24);
    expect(waitForFrame).toHaveBeenCalledTimes(24);
    expect(waitForFrame).toHaveBeenLastCalledWith(1000 / 24, undefined);
    expect(progress).toHaveBeenLastCalledWith(24, 24);
    expect(recorderInstances).toHaveLength(1);
  });

  test("falls back to WebM when a supported MP4 encoder fails to configure", async () => {
    const recorderInstances = [];
    class Recorder {
      static isTypeSupported() { return true; }
      constructor() { recorderInstances.push(this); }
      start() {}
      stop() {
        this.ondataavailable?.({ data: new Blob(["webm"], { type: "video/webm" }) });
        this.onstop?.();
      }
    }
    class BrokenVideoEncoder {
      static async isConfigSupported() { return { supported: true }; }
      configure() { throw new Error("H.264 configuration failed"); }
      close() {}
    }
    const result = await renderMotion({
      project: { canvas: { width: 100, height: 100 }, motion: { durationMs: 1000 } },
      sourceBitmap: {},
      environment: { VideoEncoder: BrokenVideoEncoder, MediaRecorder: Recorder },
      canvasFactory: () => ({
        getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }),
        captureStream: () => ({ getVideoTracks: () => [{ requestFrame: vi.fn() }] }),
      }),
      decodeFrame: async () => ({ close: vi.fn() }),
      waitForFrame: async () => {},
      renderFrame: async () => new Blob(["frame"], { type: "image/png" }),
    });
    expect(result).toMatchObject({ extension: "webm", container: "webm" });
    expect(recorderInstances).toHaveLength(1);
  });

  test("closes a successful MP4 encoder after finalizing", async () => {
    const close = vi.fn();
    class VideoEncoder {
      static async isConfigSupported() { return { supported: true }; }
      constructor() {}
      configure() {}
      encode() {}
      async flush() {}
      close = close;
    }
    class VideoFrame {
      constructor() {}
      close() {}
    }
    const result = await renderMotion({
      project: { canvas: { width: 100, height: 100 }, motion: { durationMs: 1000 } },
      sourceBitmap: {},
      environment: { VideoEncoder, VideoFrame },
      decodeFrame: async () => ({ close: vi.fn() }),
      renderFrame: async () => new Blob(["frame"], { type: "image/png" }),
    });
    expect(result.extension).toBe("mp4");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
