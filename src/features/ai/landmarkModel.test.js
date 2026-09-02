import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  FACE_MODEL_URL,
  HAND_MODEL_URL,
  POSE_MODEL_URL,
  TASKS_VISION_WASM_BASE_URL,
  landmarksToLayers,
  normalizeLandmarks,
  resetLandmarkModels,
  scanImage,
  selectLandmarkRegions,
} from "./landmarkModel.js";

const visionMock = vi.hoisted(() => ({
  importCount: 0,
  filesetCount: 0,
  createCount: { face: 0, hands: 0, pose: 0 },
  closeCount: { face: 0, hands: 0, pose: 0 },
  failCreate: new Set(),
  failDetect: new Set(),
  options: {},
  results: {
    face: {
      faceLandmarks: [[{ x: 0.2, y: 0.4, visibility: 0.9 }]],
    },
    hands: {
      landmarks: [[{ x: 0.3, y: 0.5, presence: 0.8 }]],
      handedness: [[{ categoryName: "Left", score: 0.98 }]],
    },
    pose: {
      landmarks: [[{ x: 0.4, y: 0.6, visibility: 0.7 }]],
    },
  },
}));

vi.mock("@mediapipe/tasks-vision", () => {
  visionMock.importCount += 1;

  function landmarker(mode) {
    return {
      async createFromOptions(_fileset, options) {
        visionMock.createCount[mode] += 1;
        visionMock.options[mode] = options;
        if (visionMock.failCreate.delete(mode)) {
          throw new Error(`${mode} model unavailable`);
        }
        return {
          detect() {
            if (visionMock.failDetect.delete(mode)) {
              throw new Error(`${mode} inference failed`);
            }
            return visionMock.results[mode];
          },
          close() {
            visionMock.closeCount[mode] += 1;
          },
        };
      },
    };
  }

  return {
    FilesetResolver: {
      async forVisionTasks(url) {
        visionMock.filesetCount += 1;
        visionMock.options.wasm = url;
        return { wasm: url };
      },
    },
    FaceLandmarker: landmarker("face"),
    HandLandmarker: landmarker("hands"),
    PoseLandmarker: landmarker("pose"),
  };
});

beforeEach(() => {
  visionMock.filesetCount = 0;
  visionMock.createCount = { face: 0, hands: 0, pose: 0 };
  visionMock.closeCount = { face: 0, hands: 0, pose: 0 };
  visionMock.failCreate.clear();
  visionMock.failDetect.clear();
  visionMock.options = {};
});

afterEach(async () => {
  await resetLandmarkModels();
});

describe("landmark normalization", () => {
  test("normalizes model points into finite editable Reki points", () => {
    expect(
      normalizeLandmarks(
        [
          { x: 0.2, y: 0.4, visibility: 0.9 },
          { x: -2, y: 4, presence: 0.75 },
          { x: Number.NaN, y: Number.POSITIVE_INFINITY },
        ],
        "pose",
      ),
    ).toEqual([
      { x: 0.2, y: 0.4, confidence: 0.9, source: "pose", index: 0 },
      { x: 0, y: 1, confidence: 0.75, source: "pose", index: 1 },
      { x: 0, y: 0, confidence: 1, source: "pose", index: 2 },
    ]);
  });

  test("clamps confidence and safely falls back from nonfinite scores", () => {
    expect(
      normalizeLandmarks(
        [
          { x: 0.1, y: 0.2, visibility: 1.4 },
          { x: 0.2, y: 0.3, presence: -0.25 },
          { x: 0.3, y: 0.4, visibility: Number.NaN, presence: 0.6 },
          {
            x: 0.4,
            y: 0.5,
            visibility: Number.POSITIVE_INFINITY,
            presence: Number.NaN,
          },
        ],
        "pose",
      ).map(({ confidence }) => confidence),
    ).toEqual([1, 0, 0.6, 1]);
  });

  test("selects upper-body pose points without changing identity or order", () => {
    const points = [
      { index: 15, x: 0.1, y: 0.2, source: "pose" },
      { index: 27, x: 0.4, y: 0.8, source: "pose" },
      { index: 11, x: 0.2, y: 0.3, source: "pose" },
    ];

    const selected = selectLandmarkRegions(points, "pose", ["upper-body"]);

    expect(selected).toEqual([points[0], points[2]]);
    expect(selected[0]).toBe(points[0]);
    expect(selected[1]).toBe(points[2]);
  });

  test("supports documented face, hand, and full-pose region sets", () => {
    const face = [
      { index: 33, source: "face" },
      { index: 10, source: "face" },
      { index: 1, source: "face" },
    ];
    const hand = [
      { index: 0, source: "hands" },
      { index: 4, source: "hands" },
      { index: 17, source: "hands" },
    ];
    const pose = [
      { index: 0, source: "pose" },
      { index: 27, source: "pose" },
    ];

    expect(selectLandmarkRegions(face, "face", ["eyes"])).toEqual([face[0]]);
    expect(selectLandmarkRegions(face, "face", ["face-outline"])).toEqual([
      face[1],
    ]);
    expect(selectLandmarkRegions(hand, "hands", ["fingers"])).toEqual([
      hand[1],
      hand[2],
    ]);
    expect(selectLandmarkRegions(pose, "pose", ["full-pose"])).toEqual(pose);
  });
});

describe("lazy MediaPipe scanning", () => {
  test("exports exact versioned WASM and model URLs without importing MediaPipe", () => {
    expect(TASKS_VISION_WASM_BASE_URL).toBe(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm",
    );
    expect(FACE_MODEL_URL).toBe(
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    );
    expect(HAND_MODEL_URL).toBe(
      "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    );
    expect(POSE_MODEL_URL).toBe(
      "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    );
    expect(visionMock.importCount).toBe(0);
  });

  test("loads only requested models and reuses successful module, fileset, and model instances", async () => {
    const first = await scanImage({ width: 10 }, ["face"]);
    const second = await scanImage({ width: 10 }, ["face"]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(visionMock.importCount).toBe(1);
    expect(visionMock.filesetCount).toBe(1);
    expect(visionMock.createCount).toEqual({ face: 1, hands: 0, pose: 0 });
    expect(visionMock.options.face).toMatchObject({
      baseOptions: { modelAssetPath: FACE_MODEL_URL },
      runningMode: "IMAGE",
      numFaces: 1,
    });
  });

  test("normalizes face, hand, and pose detections with handedness metadata", async () => {
    const result = await scanImage(
      { width: 10 },
      ["face", "hands", "pose"],
    );

    expect(result).toEqual({
      ok: true,
      face: [
        {
          landmarks: [
            {
              x: 0.2,
              y: 0.4,
              confidence: 0.9,
              source: "face",
              index: 0,
            },
          ],
        },
      ],
      hands: [
        {
          landmarks: [
            {
              x: 0.3,
              y: 0.5,
              confidence: 0.8,
              source: "hands",
              index: 0,
            },
          ],
          handedness: [{ categoryName: "Left", score: 0.98 }],
        },
      ],
      pose: [
        {
          landmarks: [
            {
              x: 0.4,
              y: 0.6,
              confidence: 0.7,
              source: "pose",
              index: 0,
            },
          ],
        },
      ],
    });
    expect(visionMock.filesetCount).toBe(1);
    expect(visionMock.createCount).toEqual({ face: 1, hands: 1, pose: 1 });
    expect(visionMock.options.hands).toMatchObject({
      baseOptions: { modelAssetPath: HAND_MODEL_URL },
      runningMode: "IMAGE",
      numHands: 1,
    });
    expect(visionMock.options.pose).toMatchObject({
      baseOptions: { modelAssetPath: POSE_MODEL_URL },
      runningMode: "IMAGE",
      numPoses: 1,
    });
  });

  test("classifies model failures and retries a cleared failed model promise", async () => {
    visionMock.failCreate.add("face");

    await expect(scanImage({}, ["face"])).resolves.toMatchObject({
      ok: false,
      code: "MODEL_LOAD_FAILED",
      message: "face model unavailable",
    });
    await expect(scanImage({}, ["face"])).resolves.toMatchObject({
      ok: true,
    });
    expect(visionMock.createCount.face).toBe(2);
  });

  test("classifies inference failures, disposes the broken instance, and recreates it", async () => {
    visionMock.failDetect.add("pose");

    await expect(scanImage({}, ["pose"])).resolves.toMatchObject({
      ok: false,
      code: "INFERENCE_FAILED",
      message: "pose inference failed",
    });
    expect(visionMock.closeCount.pose).toBe(1);

    await expect(scanImage({}, ["pose"])).resolves.toMatchObject({
      ok: true,
    });
    expect(visionMock.createCount.pose).toBe(2);
  });

  test("returns cancellation without loading a model when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const importCountBeforeScan = visionMock.importCount;

    await expect(
      scanImage({}, ["face"], { signal: controller.signal }),
    ).resolves.toEqual({
      ok: false,
      code: "CANCELLED",
      message: "扫描已取消",
    });
    expect(visionMock.importCount).toBe(importCountBeforeScan);
    expect(visionMock.createCount.face).toBe(0);
  });
});

describe("landmark layer conversion", () => {
  const scanResult = {
    ok: true,
    face: [
      {
        landmarks: [
          { x: 0.1, y: 0.1, index: 33, source: "face", confidence: 1 },
          { x: 0.2, y: 0.1, index: 133, source: "face", confidence: 1 },
          { x: 0.3, y: 0.2, index: 10, source: "face", confidence: 1 },
          { x: 0.4, y: 0.2, index: 338, source: "face", confidence: 1 },
        ],
      },
    ],
    hands: [],
    pose: [
      {
        landmarks: [
          { x: 0.2, y: 0.3, index: 11, source: "pose", confidence: 0.9 },
          { x: 0.3, y: 0.4, index: 13, source: "pose", confidence: 0.9 },
          { x: 0.4, y: 0.5, index: 15, source: "pose", confidence: 0.9 },
          { x: 0.8, y: 0.9, index: 27, source: "pose", confidence: 0.9 },
        ],
      },
    ],
  };

  test("creates ordinary editable AI node layers and optional labels", () => {
    const layers = landmarksToLayers(scanResult, {
      connectionMode: "none",
      labels: true,
    });

    expect(layers.map(({ type }) => type)).toEqual([
      "nodeCloud",
      "label",
      "nodeCloud",
      "label",
    ]);
    expect(layers.every(({ source }) => source === "ai")).toBe(true);
    expect(layers[0]).toMatchObject({
      id: "ai-face-0-nodes",
      name: "AI_FACE_01",
      ai: { mode: "face", detectionIndex: 0 },
    });
    expect(layers[2]).toMatchObject({
      id: "ai-pose-0-nodes",
      ai: { mode: "pose", detectionIndex: 0 },
    });
    expect(layers[0].style).toMatchObject({
      lineColor: "#e5484d",
      anchorColor: "#ff6b6b",
    });
  });

  test("filters regions before deterministic density subsampling", () => {
    const layers = landmarksToLayers(scanResult, {
      regions: ["upper-body"],
      density: 50,
      connectionMode: "none",
    });

    expect(layers).toHaveLength(1);
    expect(layers[0].points.map(({ index }) => index)).toEqual([11, 15]);
  });

  test.each([
    [90, 9],
    [70, 7],
    [50, 5],
  ])("selects the exact rounded %s%% density target", (density, count) => {
    const landmarks = Array.from({ length: 10 }, (_, index) => ({
      x: index / 9,
      y: index / 9,
      index,
      source: "pose",
      confidence: 1,
    }));
    const result = {
      ok: true,
      face: [],
      hands: [],
      pose: [{ landmarks }],
    };

    const first = landmarksToLayers(result, {
      density,
      connectionMode: "none",
    });
    const second = landmarksToLayers(result, {
      density,
      connectionMode: "none",
    });
    const indexes = first[0].points.map(({ index }) => index);

    expect(first).toEqual(second);
    expect(indexes).toHaveLength(count);
    expect(indexes[0]).toBe(0);
    expect(indexes.at(-1)).toBe(9);
  });

  test("preserves anatomical topology independently from node density", () => {
    const layers = landmarksToLayers(scanResult, {
      regions: ["upper-body"],
      density: 34,
      connectionMode: "anatomical",
    });

    expect(
      layers.find(({ type }) => type === "nodeCloud").points.map(
        ({ index }) => index,
      ),
    ).toEqual([11]);
    expect(
      layers
        .filter(({ type }) => type === "path")
        .map(({ points }) => points.map(({ index }) => index)),
    ).toEqual([
      [11, 13],
      [13, 15],
    ]);
  });

  test("creates documented anatomical edges as ordinary path layers", () => {
    const layers = landmarksToLayers(scanResult, {
      regions: ["upper-body"],
      connectionMode: "anatomical",
    });
    const paths = layers.filter(({ type }) => type === "path");

    expect(paths.map(({ points }) => points.map(({ index }) => index))).toEqual([
      [11, 13],
      [13, 15],
    ]);
  });

  test("creates a stable nearest-neighbor path with deterministic tie breaking", () => {
    const result = {
      ok: true,
      face: [],
      hands: [
        {
          landmarks: [
            { x: 0, y: 0, index: 0, source: "hands" },
            { x: 1, y: 0, index: 1, source: "hands" },
            { x: 0, y: 1, index: 2, source: "hands" },
          ],
          handedness: [{ categoryName: "Right", score: 0.96 }],
        },
      ],
      pose: [],
    };

    const first = landmarksToLayers(result, {
      connectionMode: "nearest-neighbor",
    });
    const second = landmarksToLayers(result, {
      connectionMode: "nearest-neighbor",
    });

    expect(first).toEqual(second);
    expect(
      first.find(({ type }) => type === "path").points.map(({ index }) => index),
    ).toEqual([0, 1, 2]);
    expect(first[0].ai.handedness).toEqual([
      { categoryName: "Right", score: 0.96 },
    ]);
  });
});
