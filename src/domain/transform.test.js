import { describe, expect, test } from "vitest";
import {
  clampBounds,
  pointBounds,
  resizeBoundsFromHandle,
  resizeNormalizedPoints,
} from "./transform.js";

describe("normalized layer transforms", () => {
  test("resizes points from a top-left handle", () => {
    const points = [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.8 }];
    const from = pointBounds(points);
    const to = resizeBoundsFromHandle(from, "nw", { x: 0.1, y: 0.1 });
    expect(resizeNormalizedPoints(points, from, to)).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.6, y: 0.8 },
    ]);
  });

  test("clamps resize bounds to the canvas", () => {
    expect(clampBounds({ x: -0.5, y: 0.9, width: 2, height: 0.5 })).toEqual({
      x: 0,
      y: 0.5,
      width: 1,
      height: 0.5,
    });
  });
});
