import {
  ALLOWED_ANNOTATION_TYPES,
  ALLOWED_LABEL_MODES,
  STYLE_PRESETS,
  createStyleLayers,
  findStylePreset,
} from "./stylePresets.js";

const FILTER_RANGES = Object.freeze({
  brightness: [0.5, 1.5],
  contrast: [0.5, 1.8],
  saturation: [0, 2],
  sharpness: [0, 1],
  grain: [0, 1],
  rgbOffset: [-32, 32],
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function sourceImage(input) {
  if (input?.imageData && typeof input.imageData === "object") return input.imageData;
  if (input?.image && typeof input.image === "object") return input.image;
  return input && typeof input === "object" ? input : {};
}

function dimensions(input) {
  const source = sourceImage(input);
  const width = finite(source.width ?? source.naturalWidth ?? input?.width, 1);
  const height = finite(source.height ?? source.naturalHeight ?? input?.height, 1);
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

function subjectHints(input, options = {}) {
  const values = options.subjectHints ?? input?.subjectHints ?? input?.subjects ?? [];
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map((item) => (typeof item === "string" ? item.trim() : item?.type))
        .filter(Boolean)
        .slice(0, 8),
    ),
  ];
}

/**
 * Produce a bounded, serializable image summary. Pixel data is deliberately
 * omitted from the returned object so it can be sent through a safe proxy.
 */
export function analyzeImageFeatures(input = {}, options = {}) {
  const source = sourceImage(input);
  const { width, height } = dimensions(input);
  const data = source?.data;
  const pixelCount = width * height;
  const usablePixels = data && typeof data.length === "number"
    ? Math.min(pixelCount, Math.floor(data.length / 4), 4096)
    : 0;

  let luminanceTotal = 0;
  let saturationTotal = 0;
  const luminances = [];
  for (let pixel = 0; pixel < usablePixels; pixel += 1) {
    const index = pixel * 4;
    const red = clamp(finite(data[index], 0), 0, 255) / 255;
    const green = clamp(finite(data[index + 1], 0), 0, 255) / 255;
    const blue = clamp(finite(data[index + 2], 0), 0, 255) / 255;
    const value = red * 0.299 + green * 0.587 + blue * 0.114;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    luminanceTotal += value;
    saturationTotal += maximum === 0 ? 0 : (maximum - minimum) / maximum;
    luminances.push(value);
  }

  const count = luminances.length || 1;
  const luminance = clamp(luminanceTotal / count, 0, 1);
  const variance = luminances.reduce(
    (sum, value) => sum + (value - luminance) ** 2,
    0,
  ) / count;
  const contrast = clamp(Math.sqrt(variance) * 2, 0, 1);
  const saturation = clamp(saturationTotal / count, 0, 1);
  const aspectRatio = clamp(width / height, 0.25, 4);

  return {
    width,
    height,
    luminance: Number(luminance.toFixed(4)),
    contrast: Number(contrast.toFixed(4)),
    saturation: Number(saturation.toFixed(4)),
    aspectRatio: Number(aspectRatio.toFixed(4)),
    subjectHints: subjectHints(input, options),
  };
}

function parseAdvice(input) {
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch {
      return null;
    }
  }
  return input;
}

function validFilterPatch(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return null;
  const output = {};
  for (const [key, value] of Object.entries(filters)) {
    const range = FILTER_RANGES[key];
    if (!range || !Number.isFinite(Number(value))) return null;
    const number = Number(value);
    if (number < range[0] || number > range[1]) return null;
    output[key] = number;
  }
  return Object.keys(output).length ? output : null;
}

function safeText(value, fallback, maximum) {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  return text ? text.slice(0, maximum) : fallback;
}

function validateRecommendation(candidate, index) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, error: `recommendation_${index}_invalid` };
  }
  const filters = validFilterPatch(candidate.filters);
  const annotationType = candidate.annotationType ?? candidate.markerType;
  const density = Number(candidate.density ?? 60);
  const labelMode = candidate.labelMode ?? "single";
  if (!filters) return { ok: false, error: `recommendation_${index}_filters_invalid` };
  if (!ALLOWED_ANNOTATION_TYPES.includes(annotationType)) {
    return { ok: false, error: `recommendation_${index}_annotation_invalid` };
  }
  if (!Number.isInteger(density) || density < 1 || density > 100) {
    return { ok: false, error: `recommendation_${index}_density_invalid` };
  }
  if (!ALLOWED_LABEL_MODES.includes(labelMode)) {
    return { ok: false, error: `recommendation_${index}_label_mode_invalid` };
  }
  return {
    ok: true,
    value: {
      id: safeText(candidate.id, `style-${index + 1}`, 64),
      name: safeText(candidate.name, `风格方案 ${index + 1}`, 80),
      description: safeText(candidate.description, "离线风格建议", 240),
      filters,
      annotationType,
      density,
      labelMode,
      risk: safeText(candidate.risk, "请在应用前确认效果。", 240),
    },
  };
}

/** Validate remote JSON before it can enter React state. */
export function validateStyleAdvice(input) {
  const parsed = parseAdvice(input);
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "INVALID_JSON", recommendations: [] };
  }
  const candidates = Array.isArray(parsed) ? parsed : parsed.recommendations;
  if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 3) {
    return { ok: false, error: "INVALID_RECOMMENDATIONS", recommendations: [] };
  }
  const validated = candidates.map(validateRecommendation);
  const invalid = validated.find((item) => !item.ok);
  if (invalid) return { ok: false, error: invalid.error, recommendations: [] };
  const recommendations = validated.map(({ value }) => value);
  return { ok: true, recommendations, value: recommendations };
}

export function createRecommendation(name, filters, annotationType, options = {}) {
  const preset = STYLE_PRESETS.find((candidate) => candidate.name === name);
  const recommendation = {
    id: options.id ?? preset?.id ?? `offline-${annotationType}`,
    name,
    description: options.description ?? preset?.description ?? "离线风格建议",
    filters: { ...filters },
    annotationType,
    density: options.density ?? preset?.density ?? 60,
    labelMode: options.labelMode ?? preset?.labelMode ?? "single",
    risk: options.risk ?? preset?.risk ?? "请在应用前确认效果。",
  };
  const result = validateRecommendation(recommendation, 0);
  return result.ok ? result.value : null;
}

export function getOfflineRecommendations(_features = {}) {
  return [
    createRecommendation("红线档案", { contrast: 1.16, saturation: 0.82, grain: 0.12 }, "path"),
    createRecommendation("银雾肖像", { brightness: 1.04, contrast: 1.08, saturation: 0.74 }, "orbit"),
    createRecommendation("机械节点", { contrast: 1.22, saturation: 0.68, grain: 0.18 }, "nodeCloud"),
  ];
}

export function styleToEditorPatch(recommendation, options = {}) {
  let candidate = recommendation;
  let context = options && typeof options === "object" ? options : {};
  // Accept both (recommendation, context) and (project, recommendation) so
  // callers can keep the project object at the front of an editor pipeline.
  if (
    recommendation?.layers &&
    recommendation?.filters &&
    options?.annotationType
  ) {
    candidate = options;
    context = { project: recommendation };
  }
  const project = context.project ?? (context.layers && context.filters ? context : null);
  const features = context.features ?? {};
  const seed = context.seed ?? 1;
  candidate = candidate && typeof candidate === "object" ? candidate : {};
  const validated = validateRecommendation(candidate, 0);
  if (!validated.ok) return { filters: {}, layers: [] };
  const safe = validated.value;
  const preset = findStylePreset(safe.id) ?? safe;
  const layers = Array.isArray(candidate.layers)
    ? structuredClone(candidate.layers)
    : createStyleLayers(preset, {
        seed,
        landmarks: features.landmarks ?? context.landmarks ?? [],
      });
  return {
    filters: structuredClone(safe.filters),
    layers: structuredClone(layers),
  };
}
