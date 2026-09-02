import React, { useEffect, useMemo, useRef, useState } from "react";
import { landmarksToLayers, scanImage } from "./landmarkModel.js";

const MODE_OPTIONS = Object.freeze([
  ["face", "人脸"],
  ["hands", "手部"],
  ["pose", "姿态"],
]);

const REGION_OPTIONS = Object.freeze([
  ["eyes", "眼睛"],
  ["face-outline", "面部轮廓"],
  ["fingers", "手指"],
  ["upper-body", "上半身"],
  ["full-pose", "全身姿态"],
]);

export function AiScanPanel({
  imageSource,
  hasResults = false,
  onAddLayers,
  onClearResults,
  scan = scanImage,
  toLayers = landmarksToLayers,
  interruptible = true,
}) {
  const [modes, setModes] = useState(() => new Set(["face", "hands", "pose"]));
  const [regions, setRegions] = useState(() => new Set());
  const [density, setDensity] = useState(100);
  const [connectionMode, setConnectionMode] = useState("anatomical");
  const [labels, setLabels] = useState(false);
  const [status, setStatus] = useState({ type: "idle" });
  const activeRequest = useRef(null);
  const previousHasResults = useRef(hasResults);

  useEffect(
    () => () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    },
    [],
  );

  useEffect(() => {
    if (
      previousHasResults.current &&
      !hasResults &&
      status.type === "success"
    ) {
      setStatus({ type: "idle" });
    }
    previousHasResults.current = hasResults;
  }, [hasResults, status.type]);

  const selectedModes = useMemo(
    () => MODE_OPTIONS.map(([mode]) => mode).filter((mode) => modes.has(mode)),
    [modes],
  );
  const duplicateResult = hasResults || status.type === "success";
  const loading = status.type === "loading";
  const canScan =
    Boolean(imageSource) &&
    selectedModes.length > 0 &&
    !loading &&
    !duplicateResult;

  function toggle(setter, value) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function runScan() {
    if (!canScan && status.type !== "failure" && status.type !== "empty") {
      return;
    }
    if (!imageSource || !selectedModes.length || loading || duplicateResult) {
      return;
    }

    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setStatus({ type: "loading" });

    try {
      const result = await scan(imageSource, selectedModes, {
        signal: controller.signal,
      });
      if (activeRequest.current !== controller || controller.signal.aborted) {
        return;
      }

      if (!result?.ok) {
        if (result?.code === "CANCELLED") {
          setStatus({ type: "idle" });
        } else {
          setStatus({
            type: "failure",
            message: result?.message ?? "AI 模型暂时不可用",
          });
        }
        return;
      }

      const layers = toLayers(result, {
        regions: [...regions],
        density,
        connectionMode,
        labels,
      });
      if (!layers.length) {
        setStatus({ type: "empty" });
        return;
      }

      onAddLayers?.(layers);
      setStatus({ type: "success", count: layers.length });
    } catch (error) {
      if (
        activeRequest.current === controller &&
        !controller.signal.aborted
      ) {
        setStatus({
          type: "failure",
          message:
            error instanceof Error && error.message
              ? error.message
              : "AI 扫描处理失败",
        });
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  }

  function clearResults() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    onClearResults?.();
    setStatus({ type: "idle" });
  }

  function cancelScan() {
    const controller = activeRequest.current;
    activeRequest.current = null;
    controller?.abort();
    setStatus({ type: "idle" });
  }

  return (
    <form
      className="ai-scan-panel"
      aria-label="AI 关键点扫描"
      onSubmit={(event) => {
        event.preventDefault();
        runScan();
      }}
    >
      <header>
        <div>
          <small>ON-DEVICE VISION</small>
          <h2>AI 关键点</h2>
        </div>
        <span className="type-badge">LOCAL</span>
      </header>

      <p className="ai-privacy">
        照片不会上传。识别仅在本机浏览器内运行，网络只用于加载静态模型文件。
      </p>
      {!interruptible ? (
        <p className="ai-feedback">
          当前浏览器使用兼容模式，无法中断正在执行的识别；手动工具可能短暂暂停。
        </p>
      ) : null}

      <fieldset disabled={loading || duplicateResult}>
        <legend>识别对象</legend>
        <div className="ai-option-grid">
          {MODE_OPTIONS.map(([mode, label]) => (
            <label key={mode} className="switch-row">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={modes.has(mode)}
                onChange={() => toggle(setModes, mode)}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={loading || duplicateResult}>
        <legend>限定区域（可选）</legend>
        <div className="ai-region-grid">
          {REGION_OPTIONS.map(([region, label]) => (
            <label key={region} className="switch-row">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={regions.has(region)}
                onChange={() => toggle(setRegions, region)}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={loading || duplicateResult}>
        <legend>生成方式</legend>
        <label className="control-field">
          <span>关键点密度 · {density}%</span>
          <input
            type="range"
            aria-label="关键点密度"
            min="10"
            max="100"
            step="10"
            value={density}
            onChange={(event) => setDensity(Number(event.target.value))}
          />
        </label>
        <label className="control-field">
          <span>连接方式</span>
          <select
            aria-label="连接方式"
            value={connectionMode}
            onChange={(event) => setConnectionMode(event.target.value)}
          >
            <option value="none">不连接</option>
            <option value="anatomical">解剖连接</option>
            <option value="nearest-neighbor">最近邻</option>
          </select>
        </label>
        <label className="switch-row">
          <span>显示标签</span>
          <input
            type="checkbox"
            checked={labels}
            onChange={(event) => setLabels(event.target.checked)}
          />
        </label>
      </fieldset>

      {!imageSource ? (
        <p className="ai-feedback">图片加载完成后即可在本机扫描关键点。</p>
      ) : !selectedModes.length ? (
        <p className="ai-feedback">请至少选择一种识别对象。</p>
      ) : null}
      {status.type === "loading" ? (
        <p className="ai-feedback" role="status" aria-live="polite">
          正在本机加载模型并识别…
        </p>
      ) : null}
      {status.type === "empty" ? (
        <p className="ai-feedback" role="status">
          没有识别到关键点。可调整照片或继续使用手动工具。
        </p>
      ) : null}
      {status.type === "failure" ? (
        <div className="ai-feedback ai-error" role="alert">
          <b>{status.message}</b>
          <span>手动标注工具仍可使用。</span>
        </div>
      ) : null}
      {status.type === "success" ? (
        <p className="ai-feedback ai-success" role="status">
          已生成 {status.count} 个 AI 图层。
        </p>
      ) : null}

      <div className="ai-actions">
        <button
          type="submit"
          className="primary-button"
          disabled={!canScan}
        >
          扫描关键点
        </button>
        {loading && interruptible ? (
          <button type="button" onClick={cancelScan}>
            取消扫描
          </button>
        ) : status.type === "failure" ? (
          <button
            type="button"
            onClick={runScan}
            disabled={!imageSource || !selectedModes.length || loading}
          >
            重新扫描
          </button>
        ) : null}
        <button
          type="button"
          onClick={clearResults}
          disabled={!hasResults && status.type !== "success"}
        >
          清除 AI 结果
        </button>
      </div>
    </form>
  );
}
