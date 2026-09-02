import { createAnnotation } from "../../domain/project.js";
import {
  createLandmarkRuntime,
  FACE_MODEL_URL,
  HAND_MODEL_URL,
  POSE_MODEL_URL,
  TASKS_VISION_VERSION,
  TASKS_VISION_WASM_BASE_URL,
} from "./landmarkRuntime.js";
import { createWorkerScanner } from "./landmarkWorkerClient.js";

export {
  FACE_MODEL_URL,
  HAND_MODEL_URL,
  POSE_MODEL_URL,
  TASKS_VISION_VERSION,
  TASKS_VISION_WASM_BASE_URL,
};

const SUPPORTED_MODES = new Set(["face", "hands", "pose"]);
const directRuntime = createLandmarkRuntime();
let workerScanner = null;

const REGION_INDEXES = Object.freeze({
  face: Object.freeze({
    // MediaPipe Face Mesh left/right eye and iris landmark indexes.
    eyes: new Set([
      7, 33, 133, 144, 145, 153, 154, 155, 157, 158, 159, 160, 161, 163,
      173, 246, 249, 263, 362, 373, 374, 380, 381, 382, 384, 385, 386, 387,
      388, 390, 398, 466, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477,
    ]),
    // MediaPipe FACEMESH_FACE_OVAL landmark indexes.
    "face-outline": new Set([
      10, 21, 54, 58, 67, 93, 103, 109, 127, 132, 136, 148, 149, 150,
      152, 162, 172, 176, 234, 251, 284, 288, 297, 323, 332, 338, 356,
      361, 365, 377, 378, 379, 389, 397, 400, 454,
    ]),
  }),
  hands: Object.freeze({
    // MediaPipe Hand Landmarker indexes 1–20 are thumb/finger joints.
    fingers: new Set(Array.from({ length: 20 }, (_, index) => index + 1)),
  }),
  pose: Object.freeze({
    // MediaPipe Pose indexes 0–22 cover head, torso, shoulders, arms and hands.
    "upper-body": new Set(Array.from({ length: 23 }, (_, index) => index)),
    // MediaPipe Pose Landmarker exposes 33 normalized landmarks.
    "full-pose": new Set(Array.from({ length: 33 }, (_, index) => index)),
  }),
});

const ANATOMICAL_CONNECTIONS = Object.freeze({
  face: Object.freeze([
    // Face oval.
    [10, 338], [338, 297], [297, 332], [332, 284], [284, 251],
    [251, 389], [389, 356], [356, 454], [454, 323], [323, 361],
    [361, 288], [288, 397], [397, 365], [365, 379], [379, 378],
    [378, 400], [400, 377], [377, 152], [152, 148], [148, 176],
    [176, 149], [149, 150], [150, 136], [136, 172], [172, 58],
    [58, 132], [132, 93], [93, 234], [234, 127], [127, 162],
    [162, 21], [21, 54], [54, 103], [103, 67], [67, 109], [109, 10],
    // Left and right eye loops.
    [33, 7], [7, 163], [163, 144], [144, 145], [145, 153],
    [153, 154], [154, 155], [155, 133], [33, 246], [246, 161],
    [161, 160], [160, 159], [159, 158], [158, 157], [157, 173],
    [173, 133], [263, 249], [249, 390], [390, 373], [373, 374],
    [374, 380], [380, 381], [381, 382], [382, 362], [263, 466],
    [466, 388], [388, 387], [387, 386], [386, 385], [385, 384],
    [384, 398], [398, 362],
  ]),
  hands: Object.freeze([
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
  ]),
  pose: Object.freeze([
    [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
    [17, 19], [12, 14], [14, 16], [16, 18], [16, 20], [16, 22],
    [18, 20], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26],
    [25, 27], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32],
    [27, 31], [28, 32],
  ]),
});

function finiteCoordinate(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function errorMessage(error) {
  return error instanceof Error && error.message
    ? error.message
    : "AI 关键点模型不可用";
}

function cancelledResult() {
  return {
    ok: false,
    code: "CANCELLED",
    message: "扫描已取消",
  };
}

function normalizedMode(mode) {
  return mode === "hand" ? "hands" : mode;
}

function normalizedDetections(mode, result) {
  const groups =
    mode === "face" ? result?.faceLandmarks ?? [] : result?.landmarks ?? [];
  return groups.map((points, index) => {
    const detection = {
      landmarks: normalizeLandmarks(points, mode),
    };
    if (mode === "hands" && result?.handedness?.[index]) {
      detection.handedness = result.handedness[index];
    }
    return detection;
  });
}

function subsample(points, density) {
  const percentage = Number.isFinite(Number(density))
    ? Math.max(1, Math.min(100, Number(density)))
    : 100;
  const target = Math.max(
    1,
    Math.min(points.length, Math.round((points.length * percentage) / 100)),
  );
  if (target >= points.length) return points;
  if (target === 1) return [points[0]];

  return Array.from({ length: target }, (_, index) =>
    points[Math.round((index * (points.length - 1)) / (target - 1))],
  );
}

function anatomicalPaths(points, mode) {
  const pointByIndex = new Map(points.map((point) => [point.index, point]));
  return (ANATOMICAL_CONNECTIONS[mode] ?? []).flatMap(([from, to]) => {
    const first = pointByIndex.get(from);
    const second = pointByIndex.get(to);
    return first && second ? [[first, second]] : [];
  });
}

function nearestNeighborPath(points) {
  if (points.length < 2) return [];
  const remaining = points.slice(1);
  const path = [points[0]];

  while (remaining.length) {
    const current = path.at(-1);
    remaining.sort((first, second) => {
      const firstDistance =
        (first.x - current.x) ** 2 + (first.y - current.y) ** 2;
      const secondDistance =
        (second.x - current.x) ** 2 + (second.y - current.y) ** 2;
      return firstDistance - secondDistance || first.index - second.index;
    });
    path.push(remaining.shift());
  }
  return [path];
}

function layerMetadata(mode, detection, detectionIndex) {
  return {
    source: "ai",
    ai: {
      mode,
      detectionIndex,
      ...(detection.handedness
        ? { handedness: structuredClone(detection.handedness) }
        : {}),
    },
  };
}

export function normalizeLandmarks(points = [], source) {
  return points.map((point, index) => ({
    x: finiteCoordinate(point?.x),
    y: finiteCoordinate(point?.y),
    confidence: finiteCoordinate(
      Number.isFinite(point?.visibility)
        ? point.visibility
        : Number.isFinite(point?.presence)
          ? point.presence
          : 1,
    ),
    source,
    index,
  }));
}

export function selectLandmarkRegions(points = [], source, regions = []) {
  if (!regions.length) return points;
  const sourceIndexes =
    REGION_INDEXES[source === "hand" ? "hands" : source] ?? {};
  const requestedIndexes = new Set();
  for (const region of regions) {
    for (const index of sourceIndexes[region] ?? []) {
      requestedIndexes.add(index);
    }
  }
  return points.filter((point) => requestedIndexes.has(point.index));
}

export async function resetLandmarkModels(modes) {
  workerScanner?.reset();
  workerScanner = null;
  await directRuntime.reset(modes?.map(normalizedMode));
}

export function supportsInterruptibleLandmarkScan() {
  return (
    typeof Worker === "function" && typeof createImageBitmap === "function"
  );
}

export async function scanImage(imageSource, modes = [], { signal } = {}) {
  if (signal?.aborted) return cancelledResult();

  const selectedModes = [
    ...new Set(
      modes.map(normalizedMode).filter((mode) => SUPPORTED_MODES.has(mode)),
    ),
  ];
  let rawResult;

  try {
    if (supportsInterruptibleLandmarkScan()) {
      workerScanner ??= createWorkerScanner();
      const result = await workerScanner.scan(imageSource, selectedModes, {
        signal,
      });
      if (!result.ok) return result;
      rawResult = result.raw;
    } else {
      rawResult = await directRuntime.detect(imageSource, selectedModes);
    }
  } catch (error) {
    if (signal?.aborted) return cancelledResult();
    return {
      ok: false,
      code:
        error?.stage === "model-load"
          ? "MODEL_LOAD_FAILED"
          : "INFERENCE_FAILED",
      message: errorMessage(error),
    };
  }

  if (signal?.aborted) return cancelledResult();
  const output = { ok: true, face: [], hands: [], pose: [] };
  for (const mode of selectedModes) {
    output[mode] = normalizedDetections(mode, rawResult?.[mode]);
  }
  return output;
}

export function landmarksToLayers(
  result,
  {
    regions = [],
    density = 100,
    connectionMode = "anatomical",
    labels = false,
  } = {},
) {
  if (!result?.ok) return [];
  const layers = [];

  for (const mode of ["face", "hands", "pose"]) {
    for (const [detectionIndex, detection] of (
      result[mode] ?? []
    ).entries()) {
      const selected = selectLandmarkRegions(
        detection.landmarks ?? [],
        mode,
        regions,
      );
      const points = subsample(selected, density);
      if (!points.length) continue;

      const prefix = `ai-${mode}-${detectionIndex}`;
      const metadata = layerMetadata(mode, detection, detectionIndex);
      layers.push(
        createAnnotation("nodeCloud", points, {
          id: `${prefix}-nodes`,
          name: `AI_${mode.toUpperCase()}_${String(detectionIndex + 1).padStart(2, "0")}`,
          label: `AI_${mode.toUpperCase()}_${String(detectionIndex + 1).padStart(2, "0")}`,
          ...metadata,
        }),
      );

      const paths =
        connectionMode === "anatomical"
          ? anatomicalPaths(selected, mode)
          : connectionMode === "nearest-neighbor"
            ? nearestNeighborPath(points)
            : [];
      paths.forEach((path, pathIndex) => {
        layers.push(
          createAnnotation("path", path, {
            id: `${prefix}-path-${pathIndex}`,
            name: `AI_${mode.toUpperCase()}_PATH_${String(pathIndex + 1).padStart(2, "0")}`,
            label: `AI_${mode.toUpperCase()}_PATH`,
            ...metadata,
          }),
        );
      });

      if (labels) {
        layers.push(
          createAnnotation("label", [points[0]], {
            id: `${prefix}-label`,
            name: `AI_${mode.toUpperCase()}_LABEL_${String(detectionIndex + 1).padStart(2, "0")}`,
            label: `AI ${mode.toUpperCase()} ${String(detectionIndex + 1).padStart(2, "0")}`,
            ...metadata,
          }),
        );
      }
    }
  }
  return layers;
}
