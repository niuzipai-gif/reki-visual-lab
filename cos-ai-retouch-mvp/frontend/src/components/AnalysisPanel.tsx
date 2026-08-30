import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  apiClient as defaultApiClient,
  createIdempotencyKey,
  getUserSafeErrorMessage,
  type ApiClient,
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
  inviteToken: string;
  onTaskUpdate: (task: TaskView) => void;
  apiClient?: ApiClient;
  previewUrl?: string | null;
  getOperationKey?: (taskId: string, operation: TaskOperation) => string;
  /** Task 7 can mount MaskCanvas here without changing this workflow. */
  renderRegionEditor?: (props: RegionEditorProps) => ReactNode;
}

const CATEGORY_META: Array<{ key: TaskCategory; label: string; fallback: string }> = [
  { key: "face", label: "面部", fallback: "保留面部辨识度，只处理必要的局部细节。" },
  { key: "hair", label: "头发", fallback: "检查发丝边缘和局部细节，不改变整体造型。" },
  { key: "clothing", label: "服装", fallback: "检查服装细节与接缝，保留原有设计。" },
  { key: "body_pose", label: "身体 / 姿态", fallback: "保持身体比例和主姿态，只提示局部连接风险。" },
  { key: "background", label: "背景", fallback: "保持背景结构和透视，不做整图重绘。" },
  { key: "lighting", label: "光线", fallback: "保持原始光向、层次和噪点一致。" },
];

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

const INTENSITY_VALUES = [25, 55, 80] as const;

function normalizeIntensity(value: number | undefined): number {
  return INTENSITY_VALUES.includes(value as (typeof INTENSITY_VALUES)[number]) ? value as number : 55;
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
}: AnalysisPanelProps) {
  const cards = useMemo(
    () => CATEGORY_META.map(({ key }) => cardForCategory(task.analysis, key)),
    [task.analysis],
  );
  const initialEnabled = useMemo(
    () => new Set(task.analysis.filter((card) => card.enabled).map((card) => card.id)),
    [task.analysis],
  );
  const [enabledIds, setEnabledIds] = useState<Set<string>>(initialEnabled);
  const [goal, setGoal] = useState<Goal | "both">("natural_retouch");
  const [intensity, setIntensity] = useState(() => normalizeIntensity(task.plan?.intensity));
  const [strokes, setStrokes] = useState<MaskStroke[]>(task.plan?.maskStrokes ?? []);
  const [notes, setNotes] = useState(task.plan?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generationRetryable, setGenerationRetryable] = useState(false);
  const [generationOperationStarted, setGenerationOperationStarted] = useState(
    () => GENERATION_ACTIVE_STATUSES.has(task.status) || (task.status === "failed" && Boolean(task.plan)),
  );
  const generationAlreadyStarted =
    generationOperationStarted ||
    generationRetryable ||
    GENERATION_ACTIVE_STATUSES.has(task.status) ||
    (task.status === "failed" && Boolean(task.plan));

  useEffect(() => {
    setIntensity(normalizeIntensity(task.plan?.intensity));
    setStrokes(task.plan?.maskStrokes ?? []);
    setNotes(task.plan?.notes ?? "");
  }, [task.taskId]);

  function toggleCard(cardId: string) {
    setEnabledIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
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
    try {
      await apiClient.savePlan(task.taskId, plan, inviteToken);
      const saved = await apiClient.getTask(task.taskId, inviteToken);
      onTaskUpdate(saved);
      return saved;
    } catch (caught) {
      setError(getUserSafeErrorMessage(caught));
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
    try {
      await apiClient.startGeneration(
        task.taskId,
        inviteToken,
        getOperationKey?.(task.taskId, "generate") || createIdempotencyKey(),
      );
      const generated = await apiClient.getTask(task.taskId, inviteToken);
      onTaskUpdate(generated);
      setGenerationRetryable(false);
    } catch (caught) {
      setError(getUserSafeErrorMessage(caught));
      setGenerationRetryable(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel analysis-panel" aria-labelledby="analysis-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">STEP 2 · REVIEW</p>
          <h2 id="analysis-title">AI 分析</h2>
        </div>
        <span className="badge">局部建议 · 手动确认</span>
      </div>
      <p className="muted">建议默认关闭。请逐卡确认需要处理的区域，低置信度区域不会自动进入修图计划。</p>
      {previewUrl && (
        <div className="analysis-preview" aria-label="原图与区域标注">
          <MaskCanvas
            originalImageUrl={previewUrl}
            regions={cards.flatMap((card) => card.regions)}
            strokes={strokes}
            onChange={setStrokes}
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
        <span className="control-label">修图目标</span>
        {([
          ["natural_retouch", "自然修图"],
          ["structure_repair", "结构修复"],
          ["both", "自然 + 结构"],
        ] as const).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="goal"
              value={value}
              checked={goal === value}
              disabled={generationAlreadyStarted || busy}
              onChange={() => setGoal(value)}
            />
            {label}
          </label>
        ))}
      </div>
      <fieldset className="intensity-picker" disabled={generationAlreadyStarted || busy}>
        <legend className="control-label">处理强度</legend>
        {([
          [25, "自然"],
          [55, "标准"],
          [80, "明显"],
        ] as const).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="intensity"
              value={value}
              checked={intensity === value}
              aria-label={label}
              onChange={() => setIntensity(value)}
            />
            {label} · {value}
          </label>
        ))}
      </fieldset>
      <div className="preserve-checklist" aria-label="始终保护清单">
        <div className="control-label">始终保护</div>
        <ul>
          {PRESERVE_LABELS.map(({ value, label }) => (
            <li key={value}>
              <span aria-hidden="true">✓</span> {label}
            </li>
          ))}
        </ul>
      </div>
      <div className="analysis-grid">
        {cards.map((card) => {
          const categoryLabel = CATEGORY_META.find((item) => item.key === card.category)?.label || card.category;
          return (
            <article className="analysis-card" key={card.id}>
              <div className="analysis-card-heading">
                <div>
                  <span className="category-label">{categoryLabel}</span>
                  <h3>{card.title}</h3>
                </div>
                <label className="toggle-control">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`${categoryLabel}处理开关`}
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
      <label className="notes-field">
        补充说明（可选）
        <textarea
          value={notes}
          maxLength={500}
          rows={3}
          aria-label="补充说明"
          disabled={generationAlreadyStarted || busy}
          onChange={(event) => setNotes(event.target.value.slice(0, 500))}
        />
        <span className="muted">{notes.length}/500 · 仅作为结构化修图计划的补充</span>
      </label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="analysis-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={busy || generationAlreadyStarted}
          onClick={() => void savePlan()}
        >
          保存修图计划
        </button>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void handleGenerate()}>
          {busy ? "处理中…" : generationRetryable ? "重试生成" : "确认并生成候选图"}
        </button>
      </div>
      {task.status === "generating" || task.status === "validating" || task.status === "succeeded" || task.status === "failed" ? (
        <TaskProgress status={task.status} error={task.error} />
      ) : null}
    </section>
  );
}
