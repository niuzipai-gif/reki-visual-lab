import React from "react";

const DEFAULT_DUOTONE = Object.freeze({
  dark: Object.freeze([18, 22, 24]),
  light: Object.freeze([239, 190, 59]),
});

function asNumber(event) {
  return Number(event.target.value);
}

function rgbToHex(rgb) {
  return `#${rgb
    .slice(0, 3)
    .map((value) =>
      Math.max(0, Math.min(255, Number(value) || 0))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function hexToRgb(hex) {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
}

const COMMIT_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

export function FilterPanel({
  settings = {},
  onChange,
  onPreview,
  onCommit,
  onReset,
}) {
  const preview = onPreview ?? onChange;
  const commit = onCommit ?? onChange;
  const thresholdEnabled =
    settings.threshold !== null && settings.threshold !== undefined;
  const duotone = settings.duotone;
  const palette = duotone ?? DEFAULT_DUOTONE;

  return (
    <form
      className="filter-panel"
      aria-label="底图效果"
      onSubmit={(event) => event.preventDefault()}
    >
      <header>
        <div>
          <small>PIXEL FX</small>
          <h2>底图效果</h2>
        </div>
      </header>

      <fieldset>
        <legend>像素化</legend>
        <label className="switch-row">
          <span>阈值</span>
          <input
            type="checkbox"
            aria-label="启用阈值"
            checked={thresholdEnabled}
            onChange={(event) =>
              commit?.({
                threshold: event.target.checked ? 128 : null,
                ...(event.target.checked ? { halftone: false } : {}),
              })
            }
          />
        </label>
        <label className="control-field">
          阈值
          <input
            type="range"
            aria-label="阈值"
            min="0"
            max="255"
            step="1"
            value={thresholdEnabled ? settings.threshold : 128}
            disabled={!thresholdEnabled}
            onChange={(event) => preview?.({ threshold: asNumber(event) })}
            onPointerUp={(event) =>
              commit?.({ threshold: asNumber(event) })
            }
            onBlur={(event) => commit?.({ threshold: asNumber(event) })}
            onKeyUp={(event) => {
              if (COMMIT_KEYS.has(event.key)) {
                commit?.({ threshold: asNumber(event) });
              }
            }}
          />
        </label>
        <label className="switch-row">
          <span>4×4 网点</span>
          <input
            type="checkbox"
            aria-label="4×4 网点"
            checked={Boolean(settings.halftone)}
            onChange={(event) =>
              commit?.({
                halftone: event.target.checked,
                ...(event.target.checked ? { threshold: null } : {}),
              })
            }
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>纹理与偏移</legend>
        <label className="control-field">
          颗粒
          <input
            type="range"
            aria-label="颗粒"
            min="0"
            max="1"
            step="0.05"
            value={settings.grain ?? 0}
            onChange={(event) => preview?.({ grain: asNumber(event) })}
            onPointerUp={(event) => commit?.({ grain: asNumber(event) })}
            onBlur={(event) => commit?.({ grain: asNumber(event) })}
            onKeyUp={(event) => {
              if (COMMIT_KEYS.has(event.key)) {
                commit?.({ grain: asNumber(event) });
              }
            }}
          />
        </label>
        <label className="control-field">
          RGB 偏移
          <input
            type="range"
            aria-label="RGB 偏移"
            min="-12"
            max="12"
            step="1"
            value={settings.rgbOffset ?? 0}
            onChange={(event) => preview?.({ rgbOffset: asNumber(event) })}
            onPointerUp={(event) => commit?.({ rgbOffset: asNumber(event) })}
            onBlur={(event) => commit?.({ rgbOffset: asNumber(event) })}
            onKeyUp={(event) => {
              if (COMMIT_KEYS.has(event.key)) {
                commit?.({ rgbOffset: asNumber(event) });
              }
            }}
          />
        </label>
        <label className="control-field">
          扫描线
          <input
            type="range"
            aria-label="扫描线"
            min="0"
            max="1"
            step="0.05"
            value={settings.scanline ?? 0}
            onChange={(event) => preview?.({ scanline: asNumber(event) })}
            onPointerUp={(event) => commit?.({ scanline: asNumber(event) })}
            onBlur={(event) => commit?.({ scanline: asNumber(event) })}
            onKeyUp={(event) => {
              if (COMMIT_KEYS.has(event.key)) {
                commit?.({ scanline: asNumber(event) });
              }
            }}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>双色调</legend>
        <label className="switch-row">
          <span>双色调</span>
          <input
            type="checkbox"
            aria-label="启用双色调"
            checked={Boolean(duotone)}
            onChange={(event) =>
              commit?.({
                duotone: event.target.checked
                  ? {
                      dark: [...DEFAULT_DUOTONE.dark],
                      light: [...DEFAULT_DUOTONE.light],
                    }
                  : null,
              })
            }
          />
        </label>
        <div className="color-grid">
          <label className="control-field">
            暗部
            <input
              type="color"
              aria-label="暗部颜色"
              value={rgbToHex(palette.dark)}
              disabled={!duotone}
              onChange={(event) =>
                commit?.({
                  duotone: {
                    dark: hexToRgb(event.target.value),
                    light: [...palette.light],
                  },
                })
              }
            />
          </label>
          <label className="control-field">
            亮部
            <input
              type="color"
              aria-label="亮部颜色"
              value={rgbToHex(palette.light)}
              disabled={!duotone}
              onChange={(event) =>
                commit?.({
                  duotone: {
                    dark: [...palette.dark],
                    light: hexToRgb(event.target.value),
                  },
                })
              }
            />
          </label>
        </div>
      </fieldset>

      <button
        className="filter-reset"
        type="button"
        aria-label="重置底图效果"
        onClick={() => onReset?.()}
      >
        重置效果
      </button>
    </form>
  );
}
