import { describe, expect, test, vi } from "vitest";
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
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(renderFrame).toHaveBeenCalledTimes(1);
  });
});
