import React from "react";
import {
  ANIMATION_TYPES,
  DEFAULT_ANIMATION,
  sanitizeAnimation,
} from "./animationRuntime.js";

const TYPE_LABELS = Object.freeze({
  none: "静态",
  fade: "淡入",
  draw: "线条生长",
  pulse: "呼吸",
  glitch: "错位抖动",
  orbit: "环绕",
  scan: "扫描",
});

const DIRECTION_LABELS = Object.freeze({
  normal: "正向",
  reverse: "反向",
  alternate: "往返",
  "alternate-reverse": "反向往返",
});

function seconds(milliseconds) {
  return (Math.max(0, Number(milliseconds) || 0) / 1000).toFixed(2);
}

function animationFor(layer) {
  return sanitizeAnimation(layer?.animation ?? DEFAULT_ANIMATION);
}

/**
 * Inspector controls for the selected layer plus the project-wide preview
 * cursor. Values are intentionally serializable and passed to the reducer by
 * the workbench rather than being held as a separate panel state.
 */
export function MotionPanel({
  layer,
  playing = false,
  timeMs = 0,
  timelineDurationMs = 4000,
  onChange,
  onPlayChange,
  onRestart,
  onTimelineChange,
  onTimelineDurationChange,
}) {
  if (!layer) return null;
  const animation = animationFor(layer);
  const duration = Math.max(200, Number(timelineDurationMs) || 4000);
  const hasAnimation = animation.type !== "none";

  function update(patch) {
    onChange?.(sanitizeAnimation({ ...animation, ...patch }));
  }

  return (
    <section className="motion-panel" aria-labelledby="motion-panel-title">
      <header>
        <div>
          <small>04 · 动态化</small>
          <h2 id="motion-panel-title">标记动态预览</h2>
        </div>
        <button
          type="button"
          className="motion-play-button"
          onClick={() => onPlayChange?.(!playing)}
          aria-label={playing ? "暂停动画预览" : "播放动画预览"}
        >
          {playing ? "暂停" : "播放"}
        </button>
      </header>

      <label className="control-field" htmlFor="motion-animation-type">
        动画类型
        <select
          id="motion-animation-type"
          value={animation.type}
          onChange={(event) => update({ type: event.target.value })}
        >
          {ANIMATION_TYPES.map((type) => (
            <option key={type} value={type}>{TYPE_LABELS[type]}</option>
          ))}
        </select>
      </label>

      {hasAnimation ? <>
        <div className="range-grid motion-range-grid">
          <label className="control-field" htmlFor="motion-duration">
            动画时长
            <input
              id="motion-duration"
              type="number"
              min="200"
              max="6000"
              step="100"
              value={animation.durationMs}
              onChange={(event) => update({ durationMs: event.target.value })}
            />
          </label>
          <label className="control-field" htmlFor="motion-delay">
            动画延迟
            <input
              id="motion-delay"
              type="number"
              min="0"
              max="6000"
              step="100"
              value={animation.delayMs}
              onChange={(event) => update({ delayMs: event.target.value })}
            />
          </label>
        </div>

        <label className="switch-row" htmlFor="motion-loop">
          循环播放
          <input
            id="motion-loop"
            type="checkbox"
            checked={animation.loop}
            onChange={(event) => update({ loop: event.target.checked })}
          />
        </label>

        <label className="control-field" htmlFor="motion-amplitude">
          动态幅度
          <input
            id="motion-amplitude"
            type="range"
            min="0"
            max="100"
            value={Math.round(animation.amplitude * 100)}
            onChange={(event) => update({ amplitude: Number(event.target.value) / 100 })}
          />
        </label>

        <label className="control-field" htmlFor="motion-direction">
          播放方向
          <select
            id="motion-direction"
            value={animation.direction}
            onChange={(event) => update({ direction: event.target.value })}
          >
            {Object.entries(DIRECTION_LABELS).map(([direction, label]) => (
              <option key={direction} value={direction}>{label}</option>
            ))}
          </select>
        </label>
      </> : <p>选择动画后，可调整时长、延迟与动态幅度。</p>}

      <div className="motion-timeline" aria-label="全局动画时间轴">
        <div className="motion-timeline-row">
          <strong>时间轴</strong>
          <span>{seconds(timeMs)}s / {seconds(duration)}s</span>
        </div>
        <label className="control-field motion-global-duration" htmlFor="motion-global-duration">
          全局动画时长
          <input
            id="motion-global-duration"
            type="number"
            min="1000"
            max="10000"
            step="100"
            value={duration}
            onChange={(event) => onTimelineDurationChange?.(Number(event.target.value))}
          />
        </label>
        <input
          aria-label="全局时间轴"
          type="range"
          min="0"
          max={duration}
          value={Math.min(duration, Math.max(0, Number(timeMs) || 0))}
          onChange={(event) => onTimelineChange?.(Number(event.target.value))}
        />
      </div>

      <button
        type="button"
        className="motion-restart-button"
        onClick={() => onRestart?.()}
      >
        重新开始动画预览
      </button>
    </section>
  );
}
