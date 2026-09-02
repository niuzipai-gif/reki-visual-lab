import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  apiClient as defaultApiClient,
  createIdempotencyKey,
  getUserSafeErrorState,
  type ApiClient,
  type ErrorRecoveryAction,
} from "../app/api";
import {
  DEFAULT_INTEGRATION,
  DEFAULT_PRESERVE,
  DEFAULT_VALIDATION,
  type AnalysisCard,
  type TaskCategory,
  type EditPlanInput,
  type Goal,
  type MaskStroke,
  type Region,
  type TaskError,
  type TaskOperation,
  type TaskView,
} from "../domain/task";
import TaskProgress from "./TaskProgress";
import MaskCanvas from "./MaskCanvas";

interface RegionEditorProps {
  region: Region;
  card: AnalysisCard;
}

interface AnalysisPanelProps {
  task: TaskView;
  inviteToken: string | null;
  onTaskUpdate: (task: TaskView) => void;
  apiClient?: ApiClient;
  previewUrl?: string | null;
  getOperationKey?: (taskId: string, operation: TaskOperation) => string;
  /** Task 7 can mount MaskCanvas here without changing this workflow. */
  renderRegionEditor?: (props: RegionEditorProps) => ReactNode;
  onBackToUpload?: () => void;
  onReviewResults?: () => void;
}

const CATEGORY_META: Array<{ key: TaskCategory; label: string; fallback: string }> = [
  { key: "face", label: "面部", fallback: "保留面部辨识度，只处理必要的局部细节。" },
  { key: "hair", label: "头发", fallback: "检查发丝边缘和局部细节，不改变整体造型。" },
  { key: "clothing", label: "服装", fallback: "检查服装细节与接缝，保留原有设计。" },
  { key: "body_pose", label: "身体 / 姿态", fallback: "保持身体比例和主姿态，只提示局部连接风险。" },
  { key: "background", label: "背景", fallback: "保持背景结构和透视，不做整图重绘。" },
  { key: "lighting", label: "光线", fallback: "保持原始光向、层次和噪点一致。" },
];

type AnalysisGroup = "face" | "hair" | "clothing" | "background";

const CATEGORY_GROUPS: Record<AnalysisGroup, { label: string; categories: readonly TaskCategory[] }> = {
  face: { label: "脸部状态", categories: ["face"] },
  hair: { label: "头发与假发", categories: ["hair"] },
  clothing: { label: "服装细节", categories: ["clothing", "body_pose"] },
  background: { label: "背景与光线", categories: ["background", "lighting"] },
};

const CATEGORY_GROUP_ORDER: AnalysisGroup[] = ["face", "hair", "clothing", "background"];

const OPERATION_KIND: Record<TaskCategory, string> = {
  face: "skin_retouch",
  hair: "hair_detail",
  clothing: "clothing_repair",
  body_pose: "body_pose_repair",
  background: "background_cleanup",
  lighting: "light_balance",
};

const PRESERVE_LABELS: Array<{ value: string; label: string }> = [
  { value: "face identity", label: "脸部身份" },
  { value: "costume design", label: "服装设计" },
  { value: "main pose", label: "主体姿势" },
  { value: "composition", label: "构图" },
  { value: "background structure", label: "背景结构" },
  { value: "original light direction", label: "光线方向" },
  { value: "perspective", label: "透视关系" },
  { value: "noise consistency", label: "噪点一致性" },
];

function normalizeIntensity(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 55;
  return Math.round(Math.min(100, Math.max(0, value)));
}

function cardForCategory(cards: AnalysisCard[], key: TaskCategory): AnalysisCard {
  return (
    cards.find((card) => card.category === key) || {
      id: `suggested-${key}`,
      category: key,
      title: `${CATEGORY_META.find((item) => item.key === key)?.label || key}检查`,
      summary: CATEGORY_META.find((item) => item.key === key)?.fallback || "等待分析。",
      confidence: null,
      risk: "低置信度建议需要你明确确认后才会进入计划。",
      enabled: false,
      regions: [],
    }
  );
}

function formatConfidence(confidence: number | null): string {
  return confidence === null ? "置信度待确认" : `置信度 ${Math.round(confidence * 100)}%`;
}

function selectedGoal(goal: Goal | "both"): Goal[] {
  return goal === "both" ? ["natural_retouch", "structure_repair"] : [goal];
}

const GENERATION_ACTIVE_STATUSES = new Set<string>([
  "generating",
  "queued",
  "running",
  "validating",
]);

function goalFromPlan(plan: TaskView["plan"]): Goal | "both" {
  const goals = new Set(plan?.goals || []);
  if (goals.has("natural_retouch") && goals.has("structure_repair")) return "both";
  return goals.has("structure_repair") ? "structure_repair" : "natural_retouch";
}

function enabledIdsFromTask(task: TaskView, cards: AnalysisCard[]): Set<string> {
  if (!task.plan) {
    return new Set(task.analysis.filter((card) => card.enabled).map((card) => card.id));
  }
  const enabledKinds = new Set(
    task.plan.operations
      .filter((operation) => operation.enabled)
      .map((operation) => operation.kind),
  );
  return new Set(
    cards
      .filter((card) => enabledKinds.has(OPERATION_KIND[card.category as TaskCategory]))
      .map((card) => card.id),
  );
}

function generationStartedByTask(task: TaskView): boolean {
  return (
    GENERATION_ACTIVE_STATUSES.has(task.status) ||
    task.status === "succeeded" ||
    (task.status === "failed" && Boolean(task.plan))
  );
}

export function buildEditPlan(
  cards: AnalysisCard[],
  enabledIds: Set<string>,
  goal: Goal | "both",
  intensity = 55,
  maskStrokes: MaskStroke[] = [],
  notes?: string,
): EditPlanInput {
  const selectedCards = cards.filter((card) => enabledIds.has(card.id));
  const regions = selectedCards.flatMap((card) => card.regions);
  const selectedIntensity = normalizeIntensity(intensity);
  return {
    goals: selectedGoal(goal),
    preserve: [...DEFAULT_PRESERVE],
    regions,
    maskStrokes: [...maskStrokes],
    operations: selectedCards.map((card) => ({
      kind: OPERATION_KIND[card.category as TaskCategory] || "local_detail",
      goal: goal === "structure_repair" || (goal === "both" && card.category === "body_pose")
        ? "structure_repair"
        : "natural_retouch",
      regionIds: card.regions.map((region) => region.id),
      intensity: selectedIntensity,
      enabled: true,
    })),
    intensity: selectedIntensity,
    integration: [...DEFAULT_INTEGRATION],
    validation: [...DEFAULT_VALIDATION],
    notes: notes ? notes.slice(0, 500) : null,
  };
}

export default function AnalysisPanel({
  task,
  inviteToken,
  onTaskUpdate,
  apiClient = defaultApiClient,
  previewUrl,
  getOperationKey,
  renderRegionEditor,
  onBackToUpload,
  onReviewResults,
}: AnalysisPanelProps) {
  const cards = useMemo(
    () => CATEGORY_META.map(({ key }) => cardForCategory(task.analysis, key)),
    [task.analysis],
  );
  const initialEnabled = useMemo(
    () => enabledIdsFromTask(task, cards),
    [cards, task],
  );
  const [enabledIds, setEnabledIds] = useState<Set<string>>(initialEnabled);
  const [goal, setGoal] = useState<Goal | "both">(() => goalFromPlan(task.plan));
  const [intensity, setIntensity] = useState(() => normalizeIntensity(task.plan?.intensity));
  const [strokes, setStrokes] = useState<MaskStroke[]>(task.plan?.maskStrokes ?? []);
  const [notes, setNotes] = useState(task.plan?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<TaskError | null>(null);
  const [generationRetryable, setGenerationRetryable] = useState(false);
  const [generationOperationStarted, setGenerationOperationStarted] = useState(
    () => generationStartedByTask(task),
  );
  const planDirtyRef = useRef(false);
  const previousTaskIdRef = useRef(task.taskId);
  const previousStatusRef = useRef(task.status);
  const generationAlreadyStarted =
    generationOperationStarted ||
    generationRetryable ||
    generationStartedByTask(task);
  const generationButtonLocked =
    task.status === "succeeded" || GENERATION_ACTIVE_STATUSES.has(task.status);
  const planSaveLocked =
    generationButtonLocked || (task.status === "failed" && Boolean(task.plan));
  const generationRetryAvailable =
    generationRetryable || (task.status === "failed" && Boolean(task.plan));

  useEffect(() => {
    const isNewTask = previousTaskIdRef.current !== task.taskId;
    const statusChanged = previousStatusRef.current !== task.status;
    if (isNewTask) {
      planDirtyRef.current = false;
      previousTaskIdRef.current = task.taskId;
      setGenerationRetryable(false);
      setError(null);
      setTaskError(null);
    }

    if (isNewTask || !planDirtyRef.current) {
      setEnabledIds(enabledIdsFromTask(task, cards));
      setGoal(goalFromPlan(task.plan));
      setIntensity(normalizeIntensity(task.plan?.intensity));
      setStrokes(task.plan?.maskStrokes ?? []);
      setNotes(task.plan?.notes ?? "");
    }

    if (isNewTask || statusChanged) {
      setGenerationOperationStarted(generationStartedByTask(task));
      setGenerationRetryable(false);
    } else if (generationStartedByTask(task)) {
      setGenerationOperationStarted(true);
    }
    previousStatusRef.current = task.status;
  }, [cards, task]);

  function toggleCard(cardId: string) {
    planDirtyRef.current = true;
    setEnabledIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function handleGoalChange(nextGoal: Goal | "both") {
    planDirtyRef.current = true;
    setGoal(nextGoal);
  }

  function handleIntensityChange(nextIntensity: number) {
    planDirtyRef.current = true;
    setIntensity(normalizeIntensity(nextIntensity));
  }

  function handleStrokesChange(nextStrokes: MaskStroke[]) {
    planDirtyRef.current = true;
    setStrokes(nextStrokes);
  }

  function handleNotesChange(nextNotes: string) {
    planDirtyRef.current = true;
    setNotes(nextNotes.slice(0, 500));
  }

  async function savePlan() {
    const plan = buildEditPlan(cards, enabledIds, goal, intensity, strokes, notes);
    if (!plan.operations.length) {
      setError("请至少启用一张分析卡片。");
      return null;
    }
    const hasStructureRepair = plan.operations.some(
      (operation) => operation.enabled && operation.goal === "structure_repair",
    );
    const hasMask = strokes.some((stroke) => stroke.points.length > 0);
    if (hasStructureRepair && !hasMask) {
      setError("结构修复需要至少绘制一笔局部蒙版后才能保存。");
      return null;
    }
    if (hasStructureRepair && plan.operations.some((operation) => operation.regionIds?.length === 0)) {
      setError("结构修复必须绑定已标注的局部区域。");
      return null;
    }
    setBusy(true);
    setError(null);
    setTaskError(null);
    try {
      await apiClient.savePlan(task.taskId, plan, inviteToken);
      const saved = await apiClient.getTask(task.taskId, inviteToken);
      planDirtyRef.current = false;
      onTaskUpdate(saved);
      return saved;
    } catch (caught) {
      const safeState = getUserSafeErrorState(caught);
      setError(safeState.message);
      setTaskError({
        code: safeState.code,
        message: safeState.message,
        retryable: safeState.retryable,
      });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    setGenerationRetryable(false);
    const saved = generationAlreadyStarted ? task : await savePlan();
    if (!saved) return;
    setGenerationOperationStarted(true);
    setBusy(true);
    setError(null);
    setTaskError(null);
    try {
      try {
        await apiClient.startGeneration(
          task.taskId,
          inviteToken,
          getOperationKey?.(task.taskId, "generate") || createIdempotencyKey(),
        );
      } catch (caught) {
        const safeState = getUserSafeErrorState(caught);
        setError(safeState.message);
        setTaskError({
          code: safeState.code,
          message: safeState.message,
          retryable: safeState.retryable,
        });
        try {
          const refreshed = await apiClient.getTask(task.taskId, inviteToken);
          onTaskUpdate(refreshed);
          if (refreshed.status === "failed") {
            setTaskError(refreshed.error);
            setError(null);
          }
        } catch {
          // Keep the local retry affordance when the status refresh is also unavailable.
        }
        setGenerationRetryable(true);
        return;
      }
      try {
        const generated = await apiClient.getTask(task.taskId, inviteToken);
        onTaskUpdate(generated);
        setTaskError(generated.error);
        setGenerationRetryable(false);
      } catch (caught) {
        const safeState = getUserSafeErrorState(caught);
        setError(safeState.message);
        setTaskError({
          code: safeState.code,
          message: safeState.message,
          retryable: safeState.retryable,
        });
        setGenerationRetryable(true);
      }
    } finally {
      setBusy(false);
    }
  }

  function handleRecovery(action: ErrorRecoveryAction) {
    if (action === "retry") {
      void (generationAlreadyStarted ? handleGenerate() : savePlan());
      return;
    }
    if (action === "review") {
      onReviewResults?.();
      return;
    }
    if (action === "back" || action === "reupload" || action === "invite") {
      onBackToUpload?.();
    }
  }

  return (
    <section className="panel analysis-panel" aria-labelledby="analysis-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">第二步 · 选择细节</p>
          <h2 id="analysis-title">看看哪里可以更好</h2>
        </div>
        <span className="badge">由你确认 · 更安心</span>
      </div>
      <p className="muted">我们先给你几个温柔的建议，你可以自己决定要不要处理。</p>
      {previewUrl && (
        <div className="analysis-preview" aria-label="原图与区域标注">
          <MaskCanvas
            originalImageUrl={previewUrl}
            regions={cards.flatMap((card) => card.regions)}
            strokes={strokes}
            onChange={handleStrokesChange}
            disabled={generationAlreadyStarted || busy}
          />
          {cards.flatMap((card) => card.regions).map((region) => (
            <div
              className="region-highlight"
              data-testid={`region-highlight-${region.id}`}
              aria-label={`区域 ${region.id}`}
              key={region.id}
              style={{
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`,
              }}
            >
              {renderRegionEditor?.({ region, card: cards.find((item) => item.regions.includes(region)) || cards[0] })}
            </div>
          ))}
        </div>
      )}
      <div className="goal-picker" aria-label="修图目标">
        <span className="control-label">想怎么变好看</span>
        {([
          ["natural_retouch", "自然变好看"],
          ["structure_repair", "修复小瑕疵"],
          ["both", "整理细节"],
        ] as const).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="goal"
              value={value}
              checked={goal === value}
              disabled={generationAlreadyStarted || busy}
              onChange={() => handleGoalChange(value)}
            />
            {label}
          </label>
        ))}
      </div>
      <fieldset className="intensity-picker" disabled={generationAlreadyStarted || busy}>
        <legend className="control-label">修图力度</legend>
        <div className="intensity-control">
          <span>自然</span>
          <input
            id="intensity-slider"
            type="range"
            min="0"
            max="100"
            step="1"
            value={intensity}
            aria-label="修图力度"
            onChange={(event) => handleIntensityChange(Number(event.target.value))}
          />
          <output htmlFor="intensity-slider" aria-live="polite">{intensity}</output>
          <span>明显</span>
        </div>
      </fieldset>
      <div className="preserve-checklist" aria-label="始终保护清单">
        <div className="control-label">这些请一定保留</div>
        <ul>
          {PRESERVE_LABELS.map(({ value, label }) => (
            <li key={value}>
              <span aria-hidden="true">✓</span> {label}
            </li>
          ))}
        </ul>
      </div>
      <div className="analysis-groups">
        {CATEGORY_GROUP_ORDER.map((groupKey) => {
          const group = CATEGORY_GROUPS[groupKey];
          const groupId = `analysis-group-${groupKey}`;
          return (
            <section className="analysis-group" aria-labelledby={groupId} key={groupKey}>
              <h3 className="analysis-group-title" id={groupId}>{group.label}</h3>
              <div className="analysis-grid">
                {cards.filter((card) => group.categories.includes(card.category as TaskCategory)).map((card) => {
                  const categoryLabel = CATEGORY_META.find((item) => item.key === card.category)?.label || card.category;
                  return (
                    <article className="analysis-card" key={card.id}>
                      <div className="analysis-card-heading">
                        <div>
                          <span className="category-label">{categoryLabel}</span>
                          <h4>{card.title}</h4>
                        </div>
                        <label className="toggle-control">
                          <input
                            type="checkbox"
                            role="switch"
                            aria-label={`${group.label}中的${categoryLabel}处理开关`}
                            checked={enabledIds.has(card.id)}
                            disabled={generationAlreadyStarted || busy}
                            onChange={() => toggleCard(card.id)}
                          />
                          <span>启用</span>
                        </label>
                      </div>
                      <p>{card.summary}</p>
                      <div className="card-meta">
                        <span>{formatConfidence(card.confidence)}</span>
                        <span className="risk">风险：{card.risk || "请保持原始结构。"}</span>
                      </div>
                      {card.regions.length > 0 ? (
                        <div className="region-list">
                          {card.regions.map((region) => <span key={region.id}>已标注 · {region.label}</span>)}
                        </div>
                      ) : (
                        <div className="region-list muted">未标出局部区域</div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <label className="notes-field">
        想补充什么吗？
        <textarea
          value={notes}
          maxLength={500}
          rows={3}
          aria-label="补充说明"
          disabled={generationAlreadyStarted || busy}
          onChange={(event) => handleNotesChange(event.target.value)}
        />
        <span className="muted">{notes.length}/500 · 仅作为结构化修图计划的补充</span>
      </label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="analysis-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={busy || planSaveLocked}
          onClick={() => void savePlan()}
        >
          保存这份选择
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={busy || generationButtonLocked}
          onClick={() => void handleGenerate()}
        >
          {busy ? "处理中…" : generationRetryAvailable ? "重试生成" : "生成我的预览"}
        </button>
      </div>
      {task.status === "generating" || task.status === "validating" || task.status === "succeeded" || task.status === "failed" ? (
        <TaskProgress status={task.status} error={task.error} onRecover={handleRecovery} />
      ) : null}
      {taskError && !["failed", "expired"].includes(task.status) && (
        <TaskProgress status="failed" error={taskError} onRecover={handleRecovery} />
      )}
    </section>
  );
}
