const cancelled = () => ({
  ok: false,
  code: "CANCELLED",
  message: "扫描已取消",
});

export function createWorkerScanner({
  workerFactory,
  bitmapFactory = (source) => createImageBitmap(source),
} = {}) {
  let worker = null;
  let nextId = 0;
  const pending = new Map();

  function terminate(result = cancelled()) {
    worker?.terminate();
    worker = null;
    for (const request of pending.values()) {
      request.cleanup();
      request.resolve(result);
    }
    pending.clear();
  }

  function getWorker() {
    if (worker) return worker;
    worker = workerFactory
      ? workerFactory()
      : new Worker(new URL("./landmarkWorker.js", import.meta.url), {
          type: "module",
        });
    worker.onmessage = ({ data }) => {
      const request = pending.get(data?.id);
      if (!request) return;
      pending.delete(data.id);
      request.cleanup();
      if (data.type === "result") {
        request.resolve({ ok: true, raw: data.raw });
      } else if (data.type === "error") {
        request.resolve({
          ok: false,
          code: data.code ?? "INFERENCE_FAILED",
          message: data.message ?? "AI 关键点模型不可用",
        });
      }
    };
    worker.onerror = () => {
      terminate({
        ok: false,
        code: "INFERENCE_FAILED",
        message: "AI Worker 运行失败",
      });
    };
    return worker;
  }

  async function scan(source, modes, { signal } = {}) {
    if (signal?.aborted) return cancelled();
    let bitmap;
    try {
      bitmap = await bitmapFactory(source);
    } catch (error) {
      return {
        ok: false,
        code: "INFERENCE_FAILED",
        message: error?.message ?? "无法读取图片",
      };
    }
    if (signal?.aborted) {
      bitmap.close?.();
      return cancelled();
    }

    const id = ++nextId;
    return new Promise((resolve) => {
      const onAbort = () => terminate();
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      pending.set(id, { resolve, cleanup });
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        getWorker().postMessage(
          { type: "scan", id, imageBitmap: bitmap, modes },
          [bitmap],
        );
      } catch (error) {
        pending.delete(id);
        cleanup();
        bitmap.close?.();
        resolve({
          ok: false,
          code: "INFERENCE_FAILED",
          message: error?.message ?? "AI Worker 启动失败",
        });
      }
    });
  }

  function reset() {
    terminate();
  }

  return { reset, scan };
}
