// npm does not publish a stable 0.10.22; this is its exact published RC build.
export const TASKS_VISION_VERSION = "0.10.22-rc.20250304";
export const TASKS_VISION_WASM_BASE_URL =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
export const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
export const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
export const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const MODEL_CONFIG = Object.freeze({
  face: {
    constructor: "FaceLandmarker",
    url: FACE_MODEL_URL,
    countOption: "numFaces",
  },
  hands: {
    constructor: "HandLandmarker",
    url: HAND_MODEL_URL,
    countOption: "numHands",
  },
  pose: {
    constructor: "PoseLandmarker",
    url: POSE_MODEL_URL,
    countOption: "numPoses",
  },
});

function staleGenerationError() {
  const error = new Error("Landmark model generation was reset");
  error.code = "STALE_GENERATION";
  return error;
}

export function createLandmarkRuntime({
  loadVisionTasks = () => import("@mediapipe/tasks-vision"),
} = {}) {
  let tasksPromise = null;
  let filesetPromise = null;
  let generation = 0;
  const records = new Map();

  function tasks() {
    if (!tasksPromise) {
      tasksPromise = Promise.resolve()
        .then(loadVisionTasks)
        .catch((error) => {
          tasksPromise = null;
          throw error;
        });
    }
    return tasksPromise;
  }

  function fileset() {
    if (!filesetPromise) {
      filesetPromise = tasks()
        .then(({ FilesetResolver }) =>
          FilesetResolver.forVisionTasks(TASKS_VISION_WASM_BASE_URL),
        )
        .catch((error) => {
          filesetPromise = null;
          throw error;
        });
    }
    return filesetPromise;
  }

  async function closeRecord(record) {
    if (!record.instance || record.closeStarted) return record.closePromise;
    record.closeStarted = true;
    record.closePromise = Promise.resolve()
      .then(() => record.instance.close?.())
      .catch(() => undefined);
    return record.closePromise;
  }

  function getModel(mode) {
    const config = MODEL_CONFIG[mode];
    if (!config) return Promise.reject(new Error(`不支持的扫描模式：${mode}`));
    const existing = records.get(mode);
    if (existing && !existing.stale) return existing.promise;

    const record = {
      generation: ++generation,
      stale: false,
      instance: null,
      closeStarted: false,
      closePromise: null,
      promise: null,
    };
    record.promise = Promise.all([tasks(), fileset()])
      .then(([vision, resolvedFileset]) =>
        vision[config.constructor].createFromOptions(resolvedFileset, {
          baseOptions: { modelAssetPath: config.url },
          runningMode: "IMAGE",
          [config.countOption]: 1,
        }),
      )
      .then(async (instance) => {
        record.instance = instance;
        if (record.stale || records.get(mode) !== record) {
          await closeRecord(record);
          throw staleGenerationError();
        }
        return instance;
      })
      .catch((error) => {
        if (records.get(mode) === record) records.delete(mode);
        throw error;
      });
    records.set(mode, record);
    return record.promise;
  }

  async function reset(modes) {
    const selected = modes ? new Set(modes) : null;
    const invalidated = [];
    for (const [mode, record] of records) {
      if (selected && !selected.has(mode)) continue;
      record.stale = true;
      if (records.get(mode) === record) records.delete(mode);
      invalidated.push(record);
    }
    if (!modes) {
      tasksPromise = null;
      filesetPromise = null;
    }
    await Promise.allSettled(
      invalidated.map((record) =>
        record.promise.then(() => closeRecord(record), () => undefined),
      ),
    );
  }

  async function detect(imageSource, modes) {
    let loaded = [];
    try {
      loaded = await Promise.all(
        modes.map(async (mode) => [mode, await getModel(mode)]),
      );
    } catch (error) {
      if (!error.stage) error.stage = "model-load";
      throw error;
    }

    try {
      return Object.fromEntries(
        loaded.map(([mode, model]) => [mode, model.detect(imageSource)]),
      );
    } catch (error) {
      await Promise.allSettled(loaded.map(([mode]) => reset([mode])));
      if (!error.stage) error.stage = "inference";
      throw error;
    }
  }

  return { detect, getModel, reset };
}
