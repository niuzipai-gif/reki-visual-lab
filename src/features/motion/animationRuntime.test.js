import { describe, expect, test } from "vitest";
import {
  DEFAULT_ANIMATION,
  DEFAULT_ANIMATION_FRAME,
  resolveAnimation,
  sanitizeAnimation,
} from "./animationRuntime.js";

const DYNAMIC_TYPES = ["fade", "draw", "pulse", "glitch", "orbit", "scan"];

function expectBoundedFrame(frame) {
  expect(frame.opacity).toBeGreaterThanOrEqual(0);
  expect(frame.opacity).toBeLessThanOrEqual(1);
  expect(frame.drawProgress).toBeGreaterThanOrEqual(0);
  expect(frame.drawProgress).toBeLessThanOrEqual(1);
  expect(frame.flash).toBeGreaterThanOrEqual(0);
  expect(frame.flash).toBeLessThanOrEqual(1);
  expect(frame.scale).toBeGreaterThan(0);
  expect(frame.scale).toBeLessThanOrEqual(2);
  expect(Math.abs(frame.translateX)).toBeLessThanOrEqual(1);
  expect(Math.abs(frame.translateY)).toBeLessThanOrEqual(1);
  expect(Math.abs(frame.rotation)).toBeLessThanOrEqual(180);
}

describe("animation runtime", () => {
  test.each(DYNAMIC_TYPES)("returns a bounded deterministic frame for %s", (type) => {
    const animation = {
      type,
      durationMs: 1000,
      delayMs: 0,
      loop: true,
      amplitude: 0.5,
      direction: "normal",
    };

    expect(resolveAnimation(animation, 500)).toEqual(resolveAnimation(animation, 500));
    expectBoundedFrame(resolveAnimation(animation, 500));
  });

  test("keeps a non-animated layer visually static", () => {
    expect(resolveAnimation(undefined, 777)).toEqual(DEFAULT_ANIMATION_FRAME);
    expect(resolveAnimation({ type: "none" }, 777)).toEqual(DEFAULT_ANIMATION_FRAME);
  });

  test("waits for delay before starting an animation", () => {
    expect(resolveAnimation({ type: "fade", delayMs: 300 }, 299)).toEqual({
      ...DEFAULT_ANIMATION_FRAME,
      opacity: 0,
      drawProgress: 0,
      flash: 0,
    });
    expect(resolveAnimation({ type: "fade", delayMs: 300 }, 800).opacity).toBeGreaterThan(0);
  });

  test("clamps non-looping animations at their final frame", () => {
    const animation = { type: "draw", durationMs: 1000, loop: false, amplitude: 0.5 };

    expect(resolveAnimation(animation, 1000)).toEqual(resolveAnimation(animation, 9000));
    expect(resolveAnimation(animation, 9000).drawProgress).toBe(1);
  });

  test("wraps looping animations and honors a reverse direction", () => {
    const loop = { type: "draw", durationMs: 1000, loop: true, amplitude: 0.5 };

    expect(resolveAnimation(loop, 250)).toEqual(resolveAnimation(loop, 1250));
    expect(resolveAnimation({ ...loop, loop: false, direction: "reverse" }, 250).drawProgress)
      .toBeGreaterThan(resolveAnimation({ ...loop, loop: false }, 250).drawProgress);
  });

  test("sanitizes invalid values into a serializable bounded config", () => {
    expect(sanitizeAnimation({
      type: "not-real",
      durationMs: -5,
      delayMs: 99999,
      loop: "yes",
      amplitude: 4,
      direction: "sideways",
      ignored: "value",
    })).toEqual({
      ...DEFAULT_ANIMATION,
      durationMs: 200,
      delayMs: 6000,
      amplitude: 1,
    });
  });

  test("safely falls back when numeric values cannot be coerced", () => {
    const throwingNumber = { valueOf: () => { throw new Error("nope"); } };

    expect(() => sanitizeAnimation({
      durationMs: Symbol("duration"),
      delayMs: throwingNumber,
      amplitude: Symbol("amplitude"),
    })).not.toThrow();
    expect(sanitizeAnimation({
      durationMs: Symbol("duration"),
      delayMs: throwingNumber,
      amplitude: Symbol("amplitude"),
    })).toEqual(DEFAULT_ANIMATION);
    expect(() => resolveAnimation({ type: "fade" }, Symbol("time"))).not.toThrow();
    expect(() => resolveAnimation({ type: "fade" }, throwingNumber)).not.toThrow();
  });
});
