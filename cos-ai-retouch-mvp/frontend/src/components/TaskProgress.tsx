import type { TaskError, TaskStatus } from "../domain/task";

interface TaskProgressProps {
  status: TaskStatus;
  error?: TaskError | null;
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

export default function TaskProgress({ status, error }: TaskProgressProps) {
  const copy = STATUS_COPY[status];
  return (
    <section className={`progress-card progress-${status}`} aria-live="polite">
      <div className="progress-heading">
        <span>{copy.label}</span>
        <strong>{copy.percent}%</strong>
      </div>
      <div className="progress-track" aria-label={`当前进度 ${copy.percent}%`}>
        <span style={{ width: `${copy.percent}%` }} />
      </div>
      {status === "failed" && (
        <p className="error-text" role="alert">
          {error?.message || "处理失败，请稍后重试。"}
        </p>
      )}
      {status === "expired" && (
        <p className="muted">任务已过期，下载已失效。请重新上传原图开始新的任务。</p>
      )}
    </section>
  );
}
