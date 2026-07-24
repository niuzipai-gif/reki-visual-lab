import { applyPixelFilters } from "./filterPipeline.js";

export const EFFECT_TYPES = Object.freeze([
  "brightness",
  "contrast",
  "saturation",
  "sharpness",
  "threshold",
  "halftone",
  "grain",
  "rgbOffset",
  "scanline",
  "duotone",
]);

const EFFECT_NAMES = Object.freeze({
  brightness: "亮度",
  contrast: "对比度",
  saturation: "饱和度",
  sharpness: "锐化",
  threshold: "阈值",
  halftone: "网点",
  grain: "颗粒",
  rgbOffset: "RGB 偏移",
  scanline: "扫描线",
  duotone: "双色调",
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function cloneSettings(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value)
    : {};
}

function validPalette(value) {
  return Array.isArray(value) && value.length >= 3;
}

function effectIsActive(type, settings) {
  switch (type) {
    case "brightness":
    case "contrast":
    case "saturation":
      return finite(settings.amount, 1) !== 1;
    case "sharpness":
      return finite(settings.amount) > 0;
    case "threshold":
      return (
        settings.value !== null &&
        settings.value !== undefined &&
        Number.isFinite(Number(settings.value))
      );
    case "halftone":
      return true;
    case "grain":
      return finite(settings.amount) > 0;
    case "rgbOffset":
      return finite(settings.offset) !== 0;
    case "scanline":
      return finite(settings.amount) > 0;
    case "duotone":
      return validPalette(settings.dark) && validPalette(settings.light);
    default:
      return false;
  }
}

function settingsForLegacyType(type, filters) {
  switch (type) {
    case "brightness":
    case "contrast":
    case "saturation":
    case "sharpness":
      return { amount: filters[type] };
    case "threshold":
      return { value: filters.threshold };
    case "halftone":
      return {};
    case "grain":
      return { amount: filters.grain, seed: filters.grainSeed ?? 1 };
    case "rgbOffset":
      return { offset: filters.rgbOffset ?? filters.chromaShift };
    case "scanline":
      return { amount: filters.scanline };
    case "duotone":
      return { dark: filters.duotone?.dark, light: filters.duotone?.light };
    default:
      return {};
  }
}

function effectToLegacySettings(effect) {
  switch (effect.type) {
    case "brightness":
    case "contrast":
    case "saturation":
    case "sharpness":
      return { [effect.type]: effect.settings.amount };
    case "threshold":
      return { threshold: effect.settings.value };
    case "halftone":
      return { halftone: true };
    case "grain":
      return { grain: effect.settings.amount, grainSeed: effect.settings.seed };
    case "rgbOffset":
      return { rgbOffset: effect.settings.offset };
    case "scanline":
      return { scanline: effect.settings.amount };
    case "duotone":
      return {
        duotone: {
          dark: effect.settings.dark,
          light: effect.settings.light,
        },
      };
    default:
      return {};
  }
}

export function createEffect(type, overrides = {}) {
  if (!EFFECT_TYPES.includes(type)) return null;
  const settings = cloneSettings(overrides.settings);
  const effect = {
    id: typeof overrides.id === "string" && overrides.id ? overrides.id : crypto.randomUUID(),
    type,
    name:
      typeof overrides.name === "string" && overrides.name.trim()
        ? overrides.name.trim().slice(0, 80)
        : EFFECT_NAMES[type],
    visible: overrides.visible !== false,
    opacity: clamp(finite(overrides.opacity, 1), 0, 1),
    settings,
  };
  return effect;
}

export function normalizeEffectStack(stack) {
  if (!Array.isArray(stack)) return [];
  const ids = new Set();
  const output = [];
  for (const source of stack) {
    if (!source || typeof source !== "object" || ids.has(source.id)) continue;
    const effect = createEffect(source.type, source);
    if (!effect) continue;
    ids.add(effect.id);
    output.push(effect);
  }
  return output;
}

/** Convert a legacy flat filter object into explicit visible effect cards. */
export function legacyFiltersToEffectStack(filters = {}) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return [];
  const effects = [];
  for (const type of EFFECT_TYPES) {
    const settings = settingsForLegacyType(type, filters);
    const active =
      (type === "halftone" && filters.halftone === true) ||
      (type !== "halftone" && effectIsActive(type, settings));
    if (!active) continue;
    effects.push(
      createEffect(type, {
        id: `legacy-${type}`,
        settings,
      }),
    );
  }
  return effects;
}

/** Convert a patch from the old filter API into new effect cards. */
export function legacyFilterPatchToEffects(filters = {}) {
  return legacyFiltersToEffectStack(filters).map((effect) => ({
    ...effect,
    id: crypto.randomUUID(),
  }));
}

/** Convert explicit effect cards back to the legacy-shaped settings for compatibility actions. */
export function effectStackToLegacyFilters(stack = []) {
  const filters = {};
  for (const effect of normalizeEffectStack(stack)) {
    Object.assign(filters, effectToLegacySettings(effect));
  }
  return filters;
}

function blendPixels(base, processed, opacity) {
  const output = new Uint8ClampedArray(base.length);
  const inverse = 1 - opacity;
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Math.round(base[index] * inverse + processed[index] * opacity);
  }
  return output;
}

function byte(value) {
  return Math.round(clamp(finite(value), 0, 255));
}

function applyColorEffect(data, width, height, effect) {
  const amount = finite(effect.settings.amount, effect.type === "sharpness" ? 0 : 1);
  const output = new Uint8ClampedArray(data);
  if (effect.type === "brightness") {
    for (let index = 0; index < output.length; index += 4) {
      output[index] = byte(output[index] * amount);
      output[index + 1] = byte(output[index + 1] * amount);
      output[index + 2] = byte(output[index + 2] * amount);
    }
  }
  if (effect.type === "contrast") {
    for (let index = 0; index < output.length; index += 4) {
      output[index] = byte((output[index] - 128) * amount + 128);
      output[index + 1] = byte((output[index + 1] - 128) * amount + 128);
      output[index + 2] = byte((output[index + 2] - 128) * amount + 128);
    }
  }
  if (effect.type === "saturation") {
    for (let index = 0; index < output.length; index += 4) {
      const luminance = output[index] * 0.299 + output[index + 1] * 0.587 + output[index + 2] * 0.114;
      output[index] = byte(luminance + (output[index] - luminance) * amount);
      output[index + 1] = byte(luminance + (output[index + 1] - luminance) * amount);
      output[index + 2] = byte(luminance + (output[index + 2] - luminance) * amount);
    }
  }
  if (effect.type === "sharpness") {
    const source = new Uint8ClampedArray(output);
    const strength = clamp(amount, 0, 1);
    const pixel = (x, y, channel) => source[(Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4 + channel];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          const center = pixel(x, y, channel);
          const average = (pixel(x - 1, y, channel) + pixel(x + 1, y, channel) + pixel(x, y - 1, channel) + pixel(x, y + 1, channel)) / 4;
          output[(y * width + x) * 4 + channel] = byte(center + (center - average) * strength);
        }
      }
    }
  }
  return new ImageData(output, width, height);
}

/** Apply visible effects in card order without mutating the supplied image. */
export function applyEffectStack(imageData, stack = []) {
  const width = Number(imageData?.width);
  const height = Number(imageData?.height);
  const source = imageData?.data;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || !source || source.length !== width * height * 4) {
    throw new TypeError("需要有效的 ImageData");
  }

  let data = new Uint8ClampedArray(source);
  for (const effect of normalizeEffectStack(stack)) {
    if (!effect.visible || effect.opacity <= 0 || !effectIsActive(effect.type, effect.settings)) continue;
    const processed = ["brightness", "contrast", "saturation", "sharpness"].includes(effect.type)
      ? applyColorEffect(data, width, height, effect)
      : applyPixelFilters(
          new ImageData(new Uint8ClampedArray(data), width, height),
          effectToLegacySettings(effect),
        );
    data = blendPixels(data, processed.data, effect.opacity);
  }
  return new ImageData(data, width, height);
}
