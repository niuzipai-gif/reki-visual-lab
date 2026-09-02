import {
  DEFAULT_ADJUSTMENTS,
  type AdjustmentValues,
  type EditorDocument,
  type EditorBlendMode,
  type EditorLayer,
  type EditorMaskStroke,
  type EditorOperationStep,
  type EditorPresetId,
} from "../domain/editor";

const PRESERVE_DEFAULTS = ["face identity", "main pose", "costume design", "composition"];

const ADJUSTMENT_LIMITS: Record<keyof AdjustmentValues, readonly [number, number]> = {
  exposure: [-100, 100],
  contrast: [-100, 100],
  saturation: [-100, 100],
  temperature: [-100, 100],
  sharpness: [0, 100],
  grain: [0, 100],
  vignette: [0, 100],
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0));
}

export function clampAdjustments(values: Partial<AdjustmentValues>): AdjustmentValues {
  return (Object.keys(DEFAULT_ADJUSTMENTS) as Array<keyof AdjustmentValues>).reduce(
    (result, key) => {
      const [minimum, maximum] = ADJUSTMENT_LIMITS[key];
      result[key] = clamp(values[key] ?? DEFAULT_ADJUSTMENTS[key], minimum, maximum);
      return result;
    },
    { ...DEFAULT_ADJUSTMENTS },
  );
}

export function toCanvasBlendMode(mode: EditorBlendMode): GlobalCompositeOperation {
  return (mode === "normal" ? "source-over" : mode) as GlobalCompositeOperation;
}

function clampByte(value: number): number {
  return Math.round(clamp(value, 0, 255));
}

function createImageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  if (typeof ImageData === "function") return new ImageData(data, width, height);
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

function applySaturation(red: number, green: number, blue: number, saturation: number): [number, number, number] {
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const factor = 1 + saturation / 100;
  return [
    luminance + (red - luminance) * factor,
    luminance + (green - luminance) * factor,
    luminance + (blue - luminance) * factor,
  ];
}

/** Apply deterministic pixel adjustments without touching the source ImageData. */
export function applyAdjustments(source: ImageData, rawValues: Partial<AdjustmentValues>): ImageData {
  const values = clampAdjustments(rawValues);
  const result = createImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const exposureFactor = 2 ** (values.exposure / 100);
  const contrastFactor = (259 * (values.contrast + 255)) / (255 * (259 - values.contrast));
  const temperature = values.temperature * 0.42;

  for (let index = 0; index < result.data.length; index += 4) {
    let red = result.data[index] * exposureFactor;
    let green = result.data[index + 1] * exposureFactor;
    let blue = result.data[index + 2] * exposureFactor;
    [red, green, blue] = applySaturation(red, green, blue, values.saturation);
    red += temperature;
    blue -= temperature;
    red = (red - 128) * contrastFactor + 128;
    green = (green - 128) * contrastFactor + 128;
    blue = (blue - 128) * contrastFactor + 128;
    result.data[index] = clampByte(red);
    result.data[index + 1] = clampByte(green);
    result.data[index + 2] = clampByte(blue);
  }

  return result;
}

function createLayer(
  layer: Pick<EditorLayer, "id" | "name" | "kind" | "module" | "locked" | "scope">,
): EditorLayer {
  return {
    ...layer,
    visible: true,
    opacity: 1,
    blendMode: "normal",
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    maskStrokes: [],
  };
}

export function createInitialEditorDocument(filename: string, width: number, height: number): EditorDocument {
  return {
    id: `aura-${filename.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "photo"}`,
    filename,
    width,
    height,
    sourceDataUrl: null,
    layers: [
      createLayer({ id: "original", name: "原图（锁定）", kind: "image", module: "original", locked: true, scope: "global" }),
      createLayer({ id: "light-base", name: "光影与色彩", kind: "adjustment", module: "light", locked: false, scope: "global" }),
    ],
    history: [],
  };
}

function step(
  id: string,
  label: string,
  module: EditorOperationStep["module"],
  adjustments: Partial<AdjustmentValues>,
  options: Pick<EditorOperationStep, "kind" | "scope"> & Partial<Pick<EditorOperationStep, "requiresRemoteAi">>,
): EditorOperationStep {
  return { id, label, module, adjustments, preserve: [...PRESERVE_DEFAULTS], ...options };
}

export function expandPreset(preset: EditorPresetId): EditorOperationStep[] {
  switch (preset) {
    case "natural-studio":
      return [
        step("natural-studio-light", "自然提亮", "light", { exposure: 12, contrast: 5 }, { kind: "adjustment", scope: "global" }),
        step("natural-studio-skin", "保留纹理的肤色整理", "skin", { saturation: -4, sharpness: 8 }, { kind: "adjustment", scope: "local" }),
        step("natural-studio-finish", "柔和高光", "style", { temperature: 5, vignette: 8 }, { kind: "adjustment", scope: "global" }),
      ];
    case "clear-japanese":
      return [
        step("clear-japanese-light", "清透亮肤", "light", { exposure: 10, contrast: -4 }, { kind: "adjustment", scope: "global" }),
        step("clear-japanese-color", "低饱和空气感", "style", { saturation: -8, temperature: 4 }, { kind: "adjustment", scope: "global" }),
        step("clear-japanese-hair", "发丝边缘整理", "hair", {}, { kind: "ai", scope: "local", requiresRemoteAi: true }),
      ];
    case "retro-film":
      return [
        step("retro-film-light", "复古柔光", "light", { exposure: -4, contrast: 8, temperature: 10 }, { kind: "adjustment", scope: "global" }),
        step("retro-film-color", "胶片褪色", "style", { saturation: -14, vignette: 16 }, { kind: "adjustment", scope: "global" }),
        step("retro-film-grain", "细腻颗粒", "style", { grain: 18 }, { kind: "adjustment", scope: "global" }),
      ];
    case "dark-cinema":
      return [
        step("dark-cinema-light", "暗调光影", "light", { exposure: -10, contrast: 18 }, { kind: "adjustment", scope: "global" }),
        step("dark-cinema-color", "冷暖电影色", "style", { saturation: -8, temperature: -8 }, { kind: "adjustment", scope: "global" }),
        step("dark-cinema-background", "背景杂物清理", "background", {}, { kind: "ai", scope: "local", requiresRemoteAi: true }),
      ];
  }
}

export function normalizeMaskStrokes(strokes: EditorMaskStroke[]): EditorMaskStroke[] {
  return strokes
    .filter((stroke) => Array.isArray(stroke.points) && stroke.points.length > 0)
    .map((stroke) => ({
      mode: stroke.mode === "erase" ? "erase" : "add",
      width: clamp(stroke.width, 1, 200),
      points: stroke.points.map((point) => ({ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) })),
    }));
}

/** Rasterize normalized brush strokes to an alpha mask for preview and PSD export. */
export function rasterizeMask(strokes: EditorMaskStroke[], width: number, height: number): Uint8ClampedArray {
  const output = new Uint8ClampedArray(width * height);
  const normalized = normalizeMaskStrokes(strokes);
  const paintCircle = (x: number, y: number, radius: number, mode: EditorMaskStroke["mode"]) => {
    const left = Math.max(0, Math.floor(x - radius));
    const right = Math.min(width - 1, Math.ceil(x + radius));
    const top = Math.max(0, Math.floor(y - radius));
    const bottom = Math.min(height - 1, Math.ceil(y + radius));
    for (let pixelY = top; pixelY <= bottom; pixelY += 1) {
      for (let pixelX = left; pixelX <= right; pixelX += 1) {
        if ((pixelX - x) ** 2 + (pixelY - y) ** 2 > radius ** 2) continue;
        output[pixelY * width + pixelX] = mode === "erase" ? 0 : 255;
      }
    }
  };

  for (const stroke of normalized) {
    const radius = Math.max(0.5, (stroke.width / 2) * Math.max(width, height) / 1000);
    for (let index = 0; index < stroke.points.length; index += 1) {
      const from = stroke.points[index];
      const to = stroke.points[index + 1] || from;
      const distance = Math.hypot((to.x - from.x) * width, (to.y - from.y) * height);
      const segments = Math.max(1, Math.ceil(distance / Math.max(1, radius)));
      for (let segment = 0; segment <= segments; segment += 1) {
        const progress = segment / segments;
        paintCircle(
          (from.x + (to.x - from.x) * progress) * width,
          (from.y + (to.y - from.y) * progress) * height,
          radius,
          stroke.mode,
        );
      }
    }
  }

  return output;
}
