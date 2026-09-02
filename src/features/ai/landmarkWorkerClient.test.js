import { describe, expect, test, vi } from "vitest";
import { createWorkerScanner } from "./landmarkWorkerClient.js";

class FakeWorker {
  constructor() {
    this.postMessage = vi.fn();
    this.terminate = vi.fn();
  }

  emit(data) {
    this.onmessage?.({ data });
  }
}

describe("landmark worker client", () => {
  test("clones the source and transfers only the owned ImageBitmap", async () => {
    const worker = new FakeWorker();
    const source = { projectOwned: true };
    const bitmap = { close: vi.fn() };
    const workerFactory = vi.fn(() => worker);
    const scanner = createWorkerScanner({
      workerFactory,
      bitmapFactory: vi.fn().mockResolvedValue(bitmap),
    });

    const pending = scanner.scan(source, ["face"]);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    const [message, transfer] = worker.postMessage.mock.calls[0];
    expect(message).toMatchObject({
      type: "scan",
      imageBitmap: bitmap,
      modes: ["face"],
    });
    expect(transfer).toEqual([bitmap]);
    expect(transfer).not.toContain(source);

    worker.emit({ type: "result", id: message.id, raw: { face: {} } });
    await expect(pending).resolves.toEqual({ ok: true, raw: { face: {} } });
    expect(workerFactory).toHaveBeenCalledWith();
  });

  test("abort terminates the worker immediately and a retry gets a fresh worker", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const scanner = createWorkerScanner({
      workerFactory: vi.fn(() => workers.shift()),
      bitmapFactory: vi.fn().mockImplementation(async () => ({ close: vi.fn() })),
    });
    const controller = new AbortController();

    const first = scanner.scan({}, ["pose"], { signal: controller.signal });
    await vi.waitFor(() =>
      expect(firstWorker.postMessage).toHaveBeenCalledTimes(1),
    );
    controller.abort();
    await expect(first).resolves.toMatchObject({ code: "CANCELLED" });
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);

    const second = scanner.scan({}, ["pose"]);
    await vi.waitFor(() =>
      expect(secondWorker.postMessage).toHaveBeenCalledTimes(1),
    );
    const message = secondWorker.postMessage.mock.calls[0][0];
    secondWorker.emit({ type: "result", id: message.id, raw: { pose: {} } });
    await expect(second).resolves.toMatchObject({ ok: true });
  });
});
