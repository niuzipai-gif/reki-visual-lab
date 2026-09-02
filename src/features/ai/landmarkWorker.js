import { createLandmarkRuntime } from "./landmarkRuntime.js";
import {
  createLandmarkWorkerHandler,
  installModuleWorkerImportScripts,
} from "./landmarkWorkerProtocol.js";

installModuleWorkerImportScripts(self);
const runtime = createLandmarkRuntime();
const handleMessage = createLandmarkWorkerHandler({
  runtime,
  postMessage: (message) => self.postMessage(message),
});

self.onmessage = handleMessage;
