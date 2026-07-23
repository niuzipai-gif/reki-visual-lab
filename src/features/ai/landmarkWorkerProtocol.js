function errorMessage(error) {
  return error instanceof Error && error.message
    ? error.message
    : "AI 关键点模型不可用";
}

export function installModuleWorkerImportScripts(
  scope,
  {
    createRequest = () => new XMLHttpRequest(),
    evaluate = (source) => scope.eval(source),
  } = {},
) {
  scope.importScripts = (...urls) => {
    for (const value of urls) {
      const url = new URL(value, scope.location?.href).href;
      const request = createRequest();
      request.open("GET", url, false);
      request.send();
      if (request.status < 200 || request.status >= 300) {
        throw new Error(
          `Unable to load worker script (${request.status}): ${url}`,
        );
      }
      evaluate(`${request.responseText}\n//# sourceURL=${url}`);
    }
  };
}

export function createLandmarkWorkerHandler({ runtime, postMessage }) {
  return async ({ data }) => {
    if (data?.type === "reset") {
      await runtime.reset();
      postMessage({ type: "reset-complete", id: data.id });
      return;
    }
    if (data?.type !== "scan") return;

    try {
      const raw = await runtime.detect(data.imageBitmap, data.modes);
      postMessage({ type: "result", id: data.id, raw });
    } catch (error) {
      postMessage({
        type: "error",
        id: data.id,
        code:
          error?.stage === "model-load"
            ? "MODEL_LOAD_FAILED"
            : "INFERENCE_FAILED",
        message: errorMessage(error),
      });
    } finally {
      data.imageBitmap?.close?.();
    }
  };
}
