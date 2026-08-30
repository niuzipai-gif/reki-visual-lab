import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";

import {
  apiClient as defaultApiClient,
  createIdempotencyKey,
  getUserSafeErrorMessage,
  type ApiClient,
} from "../app/api";
import type { TaskOperation, TaskView, VersionView } from "../domain/task";
import TaskProgress from "./TaskProgress";

interface ResultPanelProps {
  task: TaskView;
  originalUrl: string;
  inviteToken: string;
  onTaskUpdate: (task: TaskView) => void;
  onRestoreOriginal?: () => void;
  apiClient?: ApiClient;
  getOperationKey?: (taskId: string, operation: TaskOperation) => string;
  createGenerationKey?: () => string;
}

const VALIDATION_LABELS: Record<string, string> = {
  face_identity: "面部身份",
  pose_and_composition: "姿态与构图",
  hands_and_costume: "手部与服装",
  background_geometry: "背景几何",
  lighting_and_noise: "光线与噪点",
};

function validationLabel(value: "pass" | "review"): string {
  return value === "pass" ? "通过" : "需复核";
}

export default function ResultPanel({
  task,
  originalUrl,
  inviteToken,
  onTaskUpdate,
  onRestoreOriginal,
  apiClient = defaultApiClient,
  getOperationKey,
  createGenerationKey,
}: ResultPanelProps) {
  const candidates = useMemo(() => task.versions.slice(0, 2), [task.versions]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    () => candidates.find((version) => version.selected)?.id ?? candidates[0]?.id ?? null,
  );
  const [isOriginalRestored, setIsOriginalRestored] = useState(false);
  const [comparisonPosition, setComparisonPosition] = useState(50);
  const [zoom, setZoom] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const comparisonRef = useRef<HTMLDivElement | null>(null);

  const selectedVersion = candidates.find((version) => version.id === selectedVersionId) ?? null;
  const canRegenerate =
    !busy &&
    task.status !== "generating" &&
    task.status !== "validating" &&
    task.status !== "expired" &&
    task.versions.length < 2;
  const comparisonAfterUrl =
    isOriginalRestored ? originalUrl : selectedVersion?.assetUrl.url || originalUrl;

  function updateComparisonPosition(clientX: number) {
    const element = comparisonRef.current;
    if (!element || !Number.isFinite(clientX)) return;
    const rect = element.getBoundingClientRect();
    if (!rect.width) return;
    const next = Math.round(((clientX - rect.left) / rect.width) * 100);
    setComparisonPosition(Math.min(95, Math.max(5, next)));
  }

  function beginDragging(clientX: number, button?: number) {
    if (button !== undefined && button !== 0) return;
    updateComparisonPosition(clientX);
    setDragging(true);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    beginDragging(event.clientX, event.button);
  }

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    beginDragging(event.clientX, event.button);
  }

  function handleTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    const clientX = event.touches[0]?.clientX;
    if (clientX === undefined) return;
    event.preventDefault();
    beginDragging(clientX);
  }

  useEffect(() => {
    if (!dragging) return undefined;
    const handleMove = (event: PointerEvent | MouseEvent | TouchEvent) => {
      const clientX = "touches" in event
        ? event.touches[0]?.clientX ?? event.changedTouches[0]?.clientX
        : event.clientX;
      if (clientX === undefined) return;
      event.preventDefault();
      updateComparisonPosition(clientX);
    };
    const stopDragging = () => setDragging(false);
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    window.addEventListener("mousemove", handleMove, { passive: false });
    window.addEventListener("mouseup", stopDragging);
    window.addEventListener("touchmove", handleMove, { passive: false });
    window.addEventListener("touchend", stopDragging);
    window.addEventListener("touchcancel", stopDragging);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", stopDragging);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", stopDragging);
      window.removeEventListener("touchcancel", stopDragging);
    };
  }, [dragging]);

  function selectVersion(version: VersionView) {
    setSelectedVersionId(version.id);
    setIsOriginalRestored(false);
  }

  function keepVersion(version: VersionView) {
    setSelectedVersionId(version.id);
    setIsOriginalRestored(false);
    onTaskUpdate({
      ...task,
      versions: task.versions.map((candidate) => ({
        ...candidate,
        selected: candidate.id === version.id,
      })),
    });
  }

  function restoreOriginal() {
    setIsOriginalRestored(true);
    setComparisonPosition(50);
    onRestoreOriginal?.();
  }

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.startGeneration(
        task.taskId,
        inviteToken,
        createGenerationKey?.() ||
          getOperationKey?.(task.taskId, "generate") ||
          createIdempotencyKey(),
      );
      onTaskUpdate(await apiClient.getTask(task.taskId, inviteToken));
    } catch (caught) {
      setError(getUserSafeErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function downloadCurrentResult() {
    setBusy(true);
    setError(null);
    try {
      const url = await apiClient.getDownloadUrl(task.taskId, inviteToken);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(getUserSafeErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel result-panel" aria-labelledby="result-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">STEP 3 · RESULT REVIEW</p>
          <h2 id="result-title">生成结果</h2>
        </div>
        <span className="badge">原图永远保留</span>
      </div>
      <p className="muted">拖动中间分界线查看原图与候选图；原图始终位于左侧。</p>

      <div
        className="before-after-comparison"
        data-testid="before-after-comparison"
        ref={comparisonRef}
        onPointerDown={handlePointerDown}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        style={{ "--comparison-position": `${comparisonPosition}%` } as CSSProperties}
      >
        <img
          className="comparison-layer comparison-before"
          data-testid="comparison-before"
          data-asset-kind="original"
          src={originalUrl}
          alt="原图（左侧）"
        />
        <span className="comparison-label comparison-label-before">原图 · 左侧</span>
        <div
          className="comparison-layer comparison-after"
          data-testid="comparison-after"
          data-asset-kind={selectedVersion ? "version" : "original"}
          style={{
            clipPath: `inset(0 0 0 ${comparisonPosition}%)`,
            transform: `scale(${zoom / 100})`,
          }}
        >
          <img src={comparisonAfterUrl} alt="候选结果（右侧）" />
          <span className="comparison-label comparison-label-after">
            {isOriginalRestored ? "原图 · 已恢复" : selectedVersion ? "候选图 · 右侧" : "原图 · 已恢复"}
          </span>
        </div>
        <div className="comparison-divider" style={{ left: `${comparisonPosition}%` }} aria-hidden="true" />
      </div>

      <div className="result-controls">
        <label>
          对比位置
          <input
            type="range"
            min="5"
            max="95"
            value={comparisonPosition}
            aria-label="对比位置"
            onChange={(event) => setComparisonPosition(Number(event.target.value))}
          />
        </label>
        <label>
          预览缩放
          <input
            type="range"
            min="75"
            max="150"
            step="5"
            value={zoom}
            aria-label="预览缩放"
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <span>{zoom}%</span>
        </label>
      </div>

      <div className="candidate-grid" aria-label="候选版本列表">
        {candidates.map((version, index) => (
          <article
            className={`candidate-card ${selectedVersionId === version.id ? "candidate-selected" : ""}`}
            data-testid={`candidate-card-${version.id}`}
            key={version.id}
          >
            <button className="candidate-select" type="button" onClick={() => selectVersion(version)}>
              <img src={version.assetUrl.url} alt={`候选版本 ${index + 1}`} />
            </button>
            <div className="candidate-heading">
              <h3>候选 {index + 1}</h3>
              <span className="muted">{version.selected ? "已保留" : "待选择"}</span>
            </div>
            <div className="validation-list" aria-label={`候选 ${index + 1} 校验结果`}>
              {Object.entries(VALIDATION_LABELS).map(([key, label]) => {
                const result = version.validation[key];
                if (!result) return null;
                return (
                  <span className={`validation-${result}`} key={key}>
                    {label}：{validationLabel(result)}
                  </span>
                );
              })}
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => keepVersion(version)}
            >
              保留此版本
            </button>
          </article>
        ))}
      </div>

      {task.status === "expired" && <TaskProgress status="expired" />}
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="analysis-actions result-actions">
        <button className="secondary-button" type="button" disabled={busy || task.status === "expired"} onClick={restoreOriginal}>
          恢复原图
        </button>
        <button className="secondary-button" type="button" disabled={!canRegenerate} onClick={() => void regenerate()}>
          {busy ? "处理中…" : "重新生成"}
        </button>
        <button className="primary-button" type="button" disabled={busy || task.status !== "succeeded" || !selectedVersion} onClick={() => void downloadCurrentResult()}>
          下载当前结果
        </button>
      </div>
    </section>
  );
}
