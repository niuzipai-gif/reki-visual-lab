import { describe, expect, test, vi } from "vitest";
import {
  createLandmarkWorkerHandler,
  installModuleWorkerImportScripts,
} from "./landmarkWorkerProtocol.js";

describe("landmark worker protocol", () => {
  test("bridges MediaPipe importScripts inside a module worker", () => {
    const evaluate = vi.fn();
    const request = {
      open: vi.fn(),
      send: vi.fn(),
      status: 200,
      responseText: "self.Module = {};",
    };
    const scope = {};

    installModuleWorkerImportScripts(scope, {
      createRequest: () => request,
      evaluate,
    });
    scope.importScripts("https://cdn.example/vision_wasm_internal.js");

    expect(request.open).toHaveBeenCalledWith(
      "GET",
      "https://cdn.example/vision_wasm_internal.js",
      false,
    );
    expect(evaluate).toHaveBeenCalledWith(
      expect.stringContaining("self.Module = {};"),
    );
  });

  test("detects in the worker, posts raw results, and releases its bitmap", async () => {
    const close = vi.fn();
    const runtime = {
      detect: vi.fn().mockResolvedValue({ face: { faceLandmarks: [] } }),
      reset: vi.fn(),
    };
    const postMessage = vi.fn();
    const handle = createLandmarkWorkerHandler({ runtime, postMessage });

    await handle({
      data: {
        type: "scan",
        id: 7,
        imageBitmap: { close },
        modes: ["face"],
      },
    });

    expect(runtime.detect).toHaveBeenCalledWith(
      expect.objectContaining({ close }),
      ["face"],
    );
    expect(postMessage).toHaveBeenCalledWith({
      type: "result",
      id: 7,
      raw: { face: { faceLandmarks: [] } },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("reset releases cached worker models and acknowledges completion", async () => {
    const runtime = { detect: vi.fn(), reset: vi.fn().mockResolvedValue() };
    const postMessage = vi.fn();
    const handle = createLandmarkWorkerHandler({ runtime, postMessage });

    await handle({ data: { type: "reset", id: 9 } });

    expect(runtime.reset).toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({ type: "reset-complete", id: 9 });
  });
});
