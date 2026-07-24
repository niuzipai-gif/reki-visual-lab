const MAX_BODY_BYTES = 256 * 1024;
const UPSTREAM_TIMEOUT_MS = 12_000;
const DEFAULT_MINIMAX_URL = "https://api.minimaxi.com/v1/chat/completions";
const DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function sanitizeFeatures(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const hints = Array.isArray(input.subjectHints)
    ? input.subjectHints
        .filter((value) => typeof value === "string")
        .map((value) => value.trim().slice(0, 40))
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, 8)
    : [];
  return {
    width: Math.round(clamp(finite(input.width, 1), 1, 10000)),
    height: Math.round(clamp(finite(input.height, 1), 1, 10000)),
    luminance: Number(clamp(finite(input.luminance, 0), 0, 1).toFixed(4)),
    contrast: Number(clamp(finite(input.contrast, 0), 0, 1).toFixed(4)),
    saturation: Number(clamp(finite(input.saturation, 0), 0, 1).toFixed(4)),
    aspectRatio: Number(clamp(finite(input.aspectRatio, 1), 0.25, 4).toFixed(4)),
    subjectHints: hints,
  };
}

function parseModelContent(payload) {
  const content = payload?.choices?.[0]?.message?.content ?? payload;
  if (content && typeof content === "object") return content;
  if (typeof content !== "string") return null;
  const withoutFence = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    return null;
  }
}

async function styleAdvice(request, env) {
  if (request.method !== "POST") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "POST required" } }, 405);
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json({ error: { code: "JSON_REQUIRED", message: "application/json required" } }, 415);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large" } }, 413);
  }
  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large" } }, 413);
    }
    body = JSON.parse(text);
  } catch {
    return json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON" } }, 400);
  }
  if (!env?.MINIMAX_API_KEY) {
    return json({ error: { code: "AI_NOT_CONFIGURED", message: "AI advice is not configured" } }, 503);
  }
  const features = sanitizeFeatures(body?.features ?? body);
  if (!features) {
    return json({ error: { code: "INVALID_FEATURES", message: "A feature summary is required" } }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(env.MINIMAX_API_URL || DEFAULT_MINIMAX_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${env.MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.MINIMAX_MODEL || DEFAULT_MINIMAX_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "You are an image-editing style advisor. Return JSON only with exactly three recommendations. Do not generate images. Each recommendation must include id, name, description, filters, annotationType, density, labelMode, and risk.",
          },
          { role: "user", content: JSON.stringify({ features }) },
        ],
      }),
      signal: controller.signal,
    });
    if (upstream.status === 401 || upstream.status === 403) {
      return json({ error: { code: "UPSTREAM_AUTH_FAILED", message: "AI provider authentication failed" } }, 502);
    }
    if (!upstream.ok) {
      const code = upstream.status === 429
        ? "UPSTREAM_RATE_LIMITED"
        : upstream.status >= 500
          ? "UPSTREAM_UNAVAILABLE"
          : "UPSTREAM_ERROR";
      return json({ error: { code, message: "AI provider request failed" } }, 502);
    }
    let payload;
    try {
      payload = await upstream.json();
    } catch {
      return json({ error: { code: "UPSTREAM_INVALID_RESPONSE", message: "AI provider returned invalid JSON" } }, 502);
    }
    const advice = parseModelContent(payload);
    if (
      !advice ||
      typeof advice !== "object" ||
      !Array.isArray(advice.recommendations) ||
      advice.recommendations.length === 0 ||
      advice.recommendations.some((recommendation) => !recommendation || typeof recommendation !== "object" || Array.isArray(recommendation))
    ) {
      return json({ error: { code: "UPSTREAM_INVALID_RESPONSE", message: "AI provider returned invalid advice" } }, 502);
    }
    return json({ recommendations: advice.recommendations.slice(0, 3) });
  } catch (error) {
    if (controller.signal.aborted) {
      return json({ error: { code: "UPSTREAM_TIMEOUT", message: "AI provider timed out" } }, 504);
    }
    return json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "AI provider is unavailable" } }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/style-advice") {
      return styleAdvice(request, env);
    }
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
