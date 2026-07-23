import { describe, expect, test } from "vitest";
import {
  denormalizePoint,
  makeCurvePoints,
  normalizePoint,
} from "./geometry.js";

describe("normalized geometry", () => {
  test("round-trips normalized canvas positions", () => {
    const size = { width: 1080, height: 1350 };
    const normalized = normalizePoint({ x: 270, y: 675 }, size);

    expect(normalized).toEqual({ x: 0.25, y: 0.5 });
    expect(denormalizePoint(normalized, size)).toEqual({ x: 270, y: 675 });
  });

  test("avoids non-finite coordinates for unusable inputs", () => {
    expect(
      normalizePoint({ x: 270, y: Number.NaN }, { width: 0, height: 0 }),
    ).toEqual({ x: 0, y: 0 });
    expect(
      denormalizePoint(null, { width: 1080, height: 1350 }),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe("curve point generation", () => {
  test("keeps endpoints and inserts a deterministic point sequence", () => {
    const source = [
      { x: 0, y: 0 },
      { x: 0.5, y: 1 },
      { x: 1, y: 0 },
    ];

    const first = makeCurvePoints(source, 0.45);
    const second = makeCurvePoints(source, 0.45);

    expect(first[0]).toEqual({ x: 0, y: 0 });
    expect(first.at(-1)).toEqual({ x: 1, y: 0 });
    expect(first.length).toBeGreaterThan(3);
    expect(first).toEqual(second);
  });

  test.each([
    [[{ x: 0, y: 0 }, { x: 1, y: 1 }], 0],
    [[{ x: 0, y: 0 }, { x: 1, y: 1 }], 0.45],
    [[{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }], -1],
  ])("returns the original sequence when smoothing is inapplicable", (points, tension) => {
    expect(makeCurvePoints(points, tension)).toBe(points);
  });

  test("returns an empty sequence for invalid point collections", () => {
    expect(makeCurvePoints(null, 0.45)).toEqual([]);
  });
});
