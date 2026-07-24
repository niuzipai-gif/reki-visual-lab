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
});
