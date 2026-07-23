import { describe, expect, test, vi } from "vitest";
import { createLandmarkRuntime } from "./landmarkRuntime.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeTasks(createFromOptions) {
  return {
    FilesetResolver: { forVisionTasks: vi.fn().mockResolvedValue({}) },
    FaceLandmarker: { createFromOptions },
    HandLandmarker: { createFromOptions },
    PoseLandmarker: { createFromOptions },
  };
}

describe("landmark runtime generations", () => {
  test("initializes selected models concurrently", async () => {
    const creates = [];
    const createFromOptions = vi.fn(() => {
      const item = deferred();
      creates.push(item);
      return item.promise;
    });
    const runtime = createLandmarkRuntime({
      loadVisionTasks: vi.fn().mockResolvedValue(fakeTasks(createFromOptions)),
    });

    const pending = runtime.detect({}, ["face", "hands"]);
    await vi.waitFor(() => expect(createFromOptions).toHaveBeenCalledTimes(2));
    creates[0].resolve({ detect: () => ({ faceLandmarks: [] }), close: vi.fn() });
    creates[1].resolve({ detect: () => ({ landmarks: [] }), close: vi.fn() });

    await expect(pending).resolves.toEqual({
      face: { faceLandmarks: [] },
      hands: { landmarks: [] },
    });
  });

  test("reset invalidates pending generations, closes stale resolution once, and permits concurrent recreate", async () => {
    const firstCreate = deferred();
    const secondCreate = deferred();
    const createFromOptions = vi
      .fn()
      .mockReturnValueOnce(firstCreate.promise)
      .mockReturnValueOnce(secondCreate.promise);
    const runtime = createLandmarkRuntime({
      loadVisionTasks: vi.fn().mockResolvedValue(fakeTasks(createFromOptions)),
    });
    const staleClose = vi.fn();
    const freshClose = vi.fn();

    const stale = runtime.getModel("face");
    await vi.waitFor(() => expect(createFromOptions).toHaveBeenCalledTimes(1));
    const resetting = runtime.reset(["face"]);
    const fresh = runtime.getModel("face");
    await vi.waitFor(() => expect(createFromOptions).toHaveBeenCalledTimes(2));

    firstCreate.resolve({ detect: vi.fn(), close: staleClose });
    secondCreate.resolve({ detect: vi.fn(), close: freshClose });

    await expect(stale).rejects.toMatchObject({ code: "STALE_GENERATION" });
    await expect(fresh).resolves.toMatchObject({ close: freshClose });
    await resetting;
    expect(staleClose).toHaveBeenCalledTimes(1);
    expect(freshClose).not.toHaveBeenCalled();
    await expect(runtime.getModel("face")).resolves.toMatchObject({
      close: freshClose,
    });
  });

  test("reset covers pending and realized records and close failures are best effort", async () => {
    const pendingCreate = deferred();
    const realizedClose = vi.fn(() => {
      throw new Error("close failed");
    });
    const pendingClose = vi.fn();
    const createFromOptions = vi
      .fn()
      .mockResolvedValueOnce({ detect: vi.fn(), close: realizedClose })
      .mockReturnValueOnce(pendingCreate.promise);
    const runtime = createLandmarkRuntime({
      loadVisionTasks: vi.fn().mockResolvedValue(fakeTasks(createFromOptions)),
    });

    await runtime.getModel("face");
    const pending = runtime.getModel("hands");
    await vi.waitFor(() => expect(createFromOptions).toHaveBeenCalledTimes(2));
    const resetting = runtime.reset();
    pendingCreate.resolve({ detect: vi.fn(), close: pendingClose });

    await expect(pending).rejects.toMatchObject({ code: "STALE_GENERATION" });
    await expect(resetting).resolves.toBeUndefined();
    expect(realizedClose).toHaveBeenCalledTimes(1);
    expect(pendingClose).toHaveBeenCalledTimes(1);
  });
});
