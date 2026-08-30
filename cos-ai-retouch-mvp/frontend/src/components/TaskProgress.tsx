import type { TaskError, TaskStatus } from "../domain/task";
import {
  getUserSafeErrorState,
  type ErrorRecoveryAction,
} from "../app/api";

interface TaskProgressProps {
  status: TaskStatus;
  error?: TaskError | null;
  onRecover?: (action: ErrorRecoveryAction) => void;
}

const STATUS_COPY: Record<TaskStatus, { label: string; percent: number }> = {
  created: { label: "准备上传", percent: 10 },
  uploading: { label: "上传原图", percent: 30 },
  analyzing: { label: "AI 分析中", percent: 58 },
  awaiting_confirmation: { label: "分析完成，等待确认", percent: 70 },
  generating: { label: "生成候选图", percent: 82 },
  validating: { label: "检查候选图", percent: 94 },
  succeeded: { label: "处理完成", percent: 100 },
  failed: { label: "处理失败", percent: 100 },
  expired: { label: "任务已过期", percent: 100 },
};

export default function TaskProgress({ status, error, onRecover }: TaskProgressProps) {
  const copy = STATUS_COPY[status];
  const errorState = getUserSafeErrorState(
    error || (status === "expired" ? { code: "TASK_EXPIRED" } : null),
  );
  const displayMessage = error?.code === "PROVIDER_ERROR"
    ? "图像服务暂时不可用，请稍后重试。"
    : errorState.message;
  const showError = status === "failed" || status === "expired";
  return (
    <section className={`progress-card progress-${status}`} aria-live="polite">
      <div className="progress-heading">
        <span>{copy.label}</span>
        <strong>{copy.percent}%</strong>
      </div>
      <div className="progress-track" aria-label={`当前进度 ${copy.percent}%`}>
        <span style={{ width: `${copy.percent}%` }} />
      </div>
      {showError && (
        <>
        <p className="error-text" role="alert">
          {displayMessage}
        </p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => onRecover?.(errorState.action)}
          >
            {errorState.actionLabel}
          </button>
        </>
      )}
    </section>
  );
}
