export const ANIMATION_TYPES = Object.freeze([
  "none",
  "fade",
  "draw",
  "pulse",
  "glitch",
  "orbit",
  "scan",
]);

const ANIMATION_TYPE_SET = new Set(ANIMATION_TYPES);
const ANIMATION_DIRECTIONS = new Set([
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
]);

export const DEFAULT_ANIMATION = Object.freeze({
  type: "none",
  durationMs: 900,
  delayMs: 0,
  loop: true,
  amplitude: 0.35,
  direction: "normal",
});

export const DEFAULT_ANIMATION_FRAME = Object.freeze({
  opacity: 1,
  translateX: 0,
  translateY: 0,
  scale: 1,
  rotation: 0,
  drawProgress: 1,
  flash: 1,
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function boundedNumber(value, fallback, minimum, maximum) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, minimum, maximum) : fallback;
}

/**
 * Provides the persisted animation contract shared by the editor and export
 * renderer. It intentionally drops unknown keys so projects remain portable.
 */
export function sanitizeAnimation(animation) {
  const input = animation && typeof animation === "object" && !Array.isArray(animation)
    ? animation
    : {};
  const type = ANIMATION_TYPE_SET.has(input.type) ? input.type : DEFAULT_ANIMATION.type;
  const direction = ANIMATION_DIRECTIONS.has(input.direction)
    ? input.direction
    : DEFAULT_ANIMATION.direction;

  return {
    type,
    durationMs: boundedNumber(input.durationMs, DEFAULT_ANIMATION.durationMs, 200, 6000),
    delayMs: boundedNumber(input.delayMs, DEFAULT_ANIMATION.delayMs, 0, 6000),
    loop: typeof input.loop === "boolean" ? input.loop : DEFAULT_ANIMATION.loop,
    amplitude: boundedNumber(input.amplitude, DEFAULT_ANIMATION.amplitude, 0, 1),
    direction,
  };
}

function frame(overrides = {}) {
  return { ...DEFAULT_ANIMATION_FRAME, ...overrides };
}

function timelineProgress(config, timeMs) {
  const numericTime = Number(timeMs);
  const safeTime = Math.max(0, Number.isFinite(numericTime) ? numericTime : 0);
  if (safeTime < config.delayMs) return { waiting: true, progress: 0, cycle: 0 };

  const elapsed = safeTime - config.delayMs;
  if (!config.loop) {
    return { waiting: false, progress: clamp(elapsed / config.durationMs, 0, 1), cycle: 0 };
  }
  return {
    waiting: false,
    progress: (elapsed % config.durationMs) / config.durationMs,
    cycle: Math.floor(elapsed / config.durationMs),
  };
}

function applyDirection(progress, cycle, direction) {
  const reverse = direction === "reverse"
    || (direction === "alternate" && cycle % 2 === 1)
    || (direction === "alternate-reverse" && cycle % 2 === 0);
  return reverse ? 1 - progress : progress;
}

function animationFrameFor(config, progress) {
  const amplitude = config.amplitude;
  const wave = Math.sin(progress * Math.PI * 2);
  const arc = Math.sin(progress * Math.PI);

  switch (config.type) {
    case "fade":
      return frame({ opacity: progress });
    case "draw":
      return frame({ drawProgress: progress });
    case "pulse":
      return frame({
        opacity: clamp(1 - amplitude * 0.2 * (1 - arc), 0, 1),
        scale: clamp(1 + amplitude * 0.12 * arc, 0.01, 2),
      });
    case "glitch":
      return frame({
        opacity: clamp(1 - amplitude * 0.15 * Math.abs(wave), 0, 1),
        translateX: amplitude * 0.035 * Math.sign(wave),
        translateY: amplitude * 0.018 * Math.sign(Math.cos(progress * Math.PI * 6)),
        rotation: amplitude * 2.5 * Math.sign(wave),
        flash: clamp(1 - amplitude * 0.45 * Math.abs(wave), 0, 1),
      });
    case "orbit": {
      const angle = progress * Math.PI * 2;
      return frame({
        translateX: amplitude * 0.05 * Math.cos(angle),
        translateY: amplitude * 0.05 * Math.sin(angle),
        rotation: amplitude * 10 * Math.sin(angle),
      });
    }
    case "scan":
      return frame({
        opacity: clamp(0.7 + amplitude * 0.3, 0, 1),
        translateY: amplitude * 0.08 * (progress * 2 - 1),
        flash: clamp(0.5 + 0.5 * Math.sin(progress * Math.PI), 0, 1),
        drawProgress: progress,
      });
    default:
      return DEFAULT_ANIMATION_FRAME;
  }
}

/**
 * Resolves a serializable animation plus absolute timeline time into a pure,
 * normalized frame. translate values are fractions of the drawing viewport.
 */
export function resolveAnimation(animation, timeMs = 0) {
  const config = sanitizeAnimation(animation);
  if (config.type === "none") return DEFAULT_ANIMATION_FRAME;

  const timeline = timelineProgress(config, timeMs);
  if (timeline.waiting) return frame({ opacity: 0, drawProgress: 0, flash: 0 });

  return animationFrameFor(
    config,
    applyDirection(timeline.progress, timeline.cycle, config.direction),
  );
}
