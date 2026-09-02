const BAYER_4X4 = Object.freeze([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

export const DEFAULT_FILTER_SETTINGS = Object.freeze({
  threshold: null,
  halftone: false,
  grain: 0,
  grainSeed: 1,
  rgbOffset: 0,
  scanline: 0,
  duotone: null,
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function byte(value, fallback = 0) {
  return Math.round(clamp(finite(value, fallback), 0, 255));
}

function luminance(data, index) {
  return (
    data[index] * 0.299 +
    data[index + 1] * 0.587 +
    data[index + 2] * 0.114
  );
}

function applyThreshold(data, threshold) {
  const boundary = byte(threshold, 128);
  for (let index = 0; index < data.length; index += 4) {
    const value = luminance(data, index) >= boundary ? 255 : 0;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }
}

function applyHalftone(data, width) {
  for (let index = 0; index < data.length; index += 4) {
    const pixel = index / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const boundary = BAYER_4X4[(y % 4) * 4 + (x % 4)] * 16 + 8;
    const value = luminance(data, index) >= boundary ? 255 : 0;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }
}

function randomFromSeed(seed) {
  let state = finite(seed, 1) >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function applyGrain(data, amount, seed) {
  const strength = clamp(finite(amount, 0), 0, 1) * 128;
  if (strength === 0) return;
  const random = randomFromSeed(seed);
  for (let index = 0; index < data.length; index += 4) {
    const delta = Math.round((random() * 2 - 1) * strength);
    data[index] = data[index] + delta;
    data[index + 1] = data[index + 1] + delta;
    data[index + 2] = data[index + 2] + delta;
  }
}

function applyRgbOffset(data, width, height, value) {
  const offset = Math.round(
    clamp(finite(value, 0), -Math.max(width, height), Math.max(width, height)),
  );
  if (offset === 0) return;
  const source = new Uint8ClampedArray(data);
  const sourceIndex = (x, y) => (y * width + clamp(x, 0, width - 1)) * 4;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      data[target] = source[sourceIndex(x - offset, y)];
      data[target + 1] = source[target + 1];
      data[target + 2] = source[sourceIndex(x + offset, y) + 2];
    }
  }
}

function applyScanlines(data, width, height, amount) {
  const strength = clamp(finite(amount, 0), 0, 1);
  if (strength === 0) return;
  const factor = 1 - strength;

  for (let y = 1; y < height; y += 2) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = Math.round(data[index] * factor);
      data[index + 1] = Math.round(data[index + 1] * factor);
      data[index + 2] = Math.round(data[index + 2] * factor);
    }
  }
}

function validPalette(value) {
  return Array.isArray(value) && value.length >= 3;
}

export function hasActivePixelFilters(settings = {}) {
  if (!settings || typeof settings !== "object") return false;
  const thresholdActive =
    settings.threshold !== null &&
    settings.threshold !== undefined &&
    Number.isFinite(Number(settings.threshold));
  const grain = finite(settings.grain, 0);
  const rgbOffset = finite(
    settings.rgbOffset ?? settings.chromaShift,
    0,
  );
  const scanline = finite(settings.scanline, 0);
  const duotoneActive =
    settings.duotone &&
    validPalette(settings.duotone.dark) &&
    validPalette(settings.duotone.light);

  return Boolean(
    thresholdActive ||
      settings.halftone ||
      grain > 0 ||
      rgbOffset !== 0 ||
      scanline > 0 ||
      duotoneActive,
  );
}

function applyDuotone(data, duotone) {
  if (!duotone || !validPalette(duotone.dark) || !validPalette(duotone.light)) {
    return;
  }
  const dark = duotone.dark.map((value) => byte(value));
  const light = duotone.light.map((value) => byte(value, 255));

  for (let index = 0; index < data.length; index += 4) {
    const mix = luminance(data, index) / 255;
    data[index] = Math.round(dark[0] + (light[0] - dark[0]) * mix);
    data[index + 1] = Math.round(
      dark[1] + (light[1] - dark[1]) * mix,
    );
    data[index + 2] = Math.round(
      dark[2] + (light[2] - dark[2]) * mix,
    );
  }
}

export function applyPixelFilters(imageData, settings = {}) {
  const width = Number(imageData?.width);
  const height = Number(imageData?.height);
  const source = imageData?.data;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !source ||
    source.length !== width * height * 4
  ) {
    throw new TypeError("需要有效的 ImageData");
  }

  const safeSettings =
    settings && typeof settings === "object" ? settings : {};
  const data = new Uint8ClampedArray(source);
  if (
    safeSettings.threshold !== null &&
    safeSettings.threshold !== undefined &&
    Number.isFinite(Number(safeSettings.threshold))
  ) {
    applyThreshold(data, safeSettings.threshold);
  }
  if (safeSettings.halftone) applyHalftone(data, width);
  applyGrain(data, safeSettings.grain, safeSettings.grainSeed);
  applyRgbOffset(
    data,
    width,
    height,
    safeSettings.rgbOffset ?? safeSettings.chromaShift,
  );
  applyScanlines(data, width, height, safeSettings.scanline);
  applyDuotone(data, safeSettings.duotone);

  return new ImageData(data, width, height);
}
