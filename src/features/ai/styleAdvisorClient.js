import {
  analyzeImageFeatures,
  getOfflineRecommendations,
  validateStyleAdvice,
} from "./styleAdvisor.js";

export const STYLE_ADVICE_TIMEOUT_MS = 8000;

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function boundedNumber(value, fallback, minimum, maximum, digits = 4) {
  const number = clamp(finite(value, fallback), minimum, maximum);
  return Number(number.toFixed(digits));
}

/** Keep the browser-to-worker contract primitive and pixel-free. */
export function sanitizeFeatureSummary(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const hints = Array.isArray(source.subjectHints)
    ? source.subjectHints
        .map((value) =>
          typeof value === "string"
            ? value
            : value && typeof value === "object" && typeof value.type === "string"
              ? value.type
              : null,
        )
        .filter(Boolean)
        .map((value) => value.trim().slice(0, 40))
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, 8)
    : [];

  return {
    width: Math.round(clamp(finite(source.width, 1), 1, 10000)),
    height: Math.round(clamp(finite(source.height, 1), 1, 10000)),
    luminance: boundedNumber(source.luminance, 0, 0, 1),
    contrast: boundedNumber(source.contrast, 0, 0, 1),
    saturation: boundedNumber(source.saturation, 0, 0, 1),
    aspectRatio: boundedNumber(source.aspectRatio, 1, 0.25, 4),
    subjectHints: hints,
  };
}

function errorResult(error) {
  const code = error?.code || error?.message || "REQUEST_FAILED";
  return { ok: false, error: String(code), recommendations: [] };
}

/** Request validated recommendations from the same-origin worker proxy. */
export async function requestStyleAdvice(features, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const endpoint = options.endpoint ?? "/api/style-advice";
  const timeoutMs = Math.min(
    STYLE_ADVICE_TIMEOUT_MS,
    Math.max(1, Number(options.timeoutMs) || STYLE_ADVICE_TIMEOUT_MS),
  );
  if (typeof fetchImpl !== "function") return errorResult({ code: "FETCH_UNAVAILABLE" });

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ features: sanitizeFeatureSummary(features) }),
      signal: controller.signal,
    });
    if (!response?.ok) {
      return errorResult({ code: `HTTP_${response?.status ?? 0}` });
    }
    const payload = await response.json();
    const advice = payload?.advice ?? payload;
    return validateStyleAdvice(advice);
  } catch (error) {
    if (controller.signal.aborted) return errorResult({ code: "TIMEOUT" });
    return errorResult(error);
  } finally {
    clearTimeout(timer);
  }
}

/** Remote-first advice with a deterministic local fallback for offline use. */
export async function getStyleAdvice(features, options = {}) {
  const remote = await requestStyleAdvice(features, options);
  if (remote.ok) {
    return { source: "remote", recommendations: remote.recommendations, error: null };
  }
  return {
    source: "offline",
    recommendations: getOfflineRecommendations(sanitizeFeatureSummary(features)),
    error: remote.error,
  };
}

export { analyzeImageFeatures };
export const fetchStyleAdvice = requestStyleAdvice;
