import { applyPixelFilters } from "./filterPipeline.js";

export const EFFECT_TYPES = Object.freeze([
  "threshold",
  "halftone",
  "grain",
  "rgbOffset",
  "scanline",
  "duotone",
]);

const EFFECT_NAMES = Object.freeze({
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
    case "threshold":
      return Number.isFinite(Number(settings.value));
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

function blendPixels(base, processed, opacity) {
  const output = new Uint8ClampedArray(base.length);
  const inverse = 1 - opacity;
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Math.round(base[index] * inverse + processed[index] * opacity);
  }
  return output;
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
    const processed = applyPixelFilters(
      new ImageData(new Uint8ClampedArray(data), width, height),
      effectToLegacySettings(effect),
    );
    data = blendPixels(data, processed.data, effect.opacity);
  }
  return new ImageData(data, width, height);
}

