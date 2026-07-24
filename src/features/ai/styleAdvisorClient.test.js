import { describe, expect, test, vi } from "vitest";
import {
  getStyleAdvice,
  requestStyleAdvice,
  sanitizeFeatureSummary,
} from "./styleAdvisorClient.js";

describe("style advisor client", () => {
  test("sanitizes a feature summary and never forwards raw image data", () => {
    const result = sanitizeFeatureSummary({
      width: 1200,
      height: 900,
      luminance: 0.4,
      contrast: 0.6,
      saturation: 0.8,
      aspectRatio: 1.3333,
      subjectHints: ["face", "face", { type: "hands" }],
      data: new Uint8Array([1, 2, 3]),
      image: { src: "secret" },
    });

    expect(result).toEqual({
      width: 1200,
      height: 900,
      luminance: 0.4,
      contrast: 0.6,
      saturation: 0.8,
      aspectRatio: 1.3333,
      subjectHints: ["face", "hands"],
    });
    expect(result).not.toHaveProperty("data");
    expect(result).not.toHaveProperty("image");
  });

  test("requests only the sanitized summary and validates remote advice", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        recommendations: [
          {
            id: "remote-style",
            name: "Remote style",
            description: "A safe suggestion",
            filters: { contrast: 1.1 },
            annotationType: "path",
            density: 60,
            labelMode: "single",
            risk: "Check contrast",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }),
    );

    const result = await requestStyleAdvice(
      { width: 800, image: { src: "should-not-send" }, subjectHints: ["face"] },
      { fetchImpl, timeoutMs: 8000 },
    );

    expect(result.ok).toBe(true);
    expect(result.recommendations).toHaveLength(1);
    const [, options] = fetchImpl.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      features: { width: 800, height: 1, luminance: 0, contrast: 0, saturation: 0, aspectRatio: 1, subjectHints: ["face"] },
    });
  });

  test("falls back to deterministic offline recommendations on timeout or invalid advice", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("timeout"));
    const result = await getStyleAdvice({ width: 10 }, { fetchImpl, timeoutMs: 1 });

    expect(result.source).toBe("offline");
    expect(result.recommendations).toHaveLength(3);
    expect(result.error).toBe("timeout");
  });

  test("composes caller abort with the internal timeout signal", async () => {
    const caller = new AbortController();
    let upstreamSignal;
    const fetchImpl = vi.fn((_url, options) => {
      upstreamSignal = options.signal;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    });

    const pending = requestStyleAdvice({ width: 10 }, { fetchImpl, signal: caller.signal });
    caller.abort();
    const result = await pending;

    expect(upstreamSignal.aborted).toBe(true);
    expect(result).toMatchObject({ ok: false, error: "ABORTED" });
  });

  test("rejects an oversized response before attempting JSON parsing", async () => {
    const oversized = "x".repeat(256 * 1024 + 1);
    const response = new Response(oversized, { status: 200 });
    response.json = vi.fn(() => {
      throw new Error("should not parse");
    });
    const result = await requestStyleAdvice({ width: 10 }, {
      fetchImpl: vi.fn().mockResolvedValue(response),
    });

    expect(result).toMatchObject({ ok: false, error: "RESPONSE_TOO_LARGE" });
    expect(response.json).not.toHaveBeenCalled();
  });

  test.each([
    [401, "UPSTREAM_AUTH_FAILED"],
    [429, "UPSTREAM_RATE_LIMITED"],
  ])("preserves normalized provider status %s", async (status, code) => {
    const result = await requestStyleAdvice({ width: 10 }, {
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code } }), {
        status,
        headers: { "content-type": "application/json" },
      })),
    });

    expect(result).toMatchObject({ ok: false, error: code });
  });

  test("normalizes a successful response with invalid JSON", async () => {
    const result = await requestStyleAdvice({ width: 10 }, {
      fetchImpl: vi.fn().mockResolvedValue(new Response("{not-json", { status: 200 })),
    });

    expect(result).toMatchObject({ ok: false, error: "INVALID_JSON" });
  });

  test("normalizes an abort during response reading as caller cancellation", async () => {
    const caller = new AbortController();
    const response = {
      ok: true,
      headers: { get: () => null },
      arrayBuffer: vi.fn(() => {
        caller.abort();
        return Promise.reject(new DOMException("aborted", "AbortError"));
      }),
    };
    const result = await requestStyleAdvice({ width: 10 }, {
      fetchImpl: vi.fn().mockResolvedValue(response),
      signal: caller.signal,
    });

    expect(result).toMatchObject({ ok: false, error: "ABORTED" });
  });
});
