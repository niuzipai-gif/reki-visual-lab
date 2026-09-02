import { useEffect, useState } from "react";

import {
  createIdempotencyKey,
  getUserSafeErrorState,
  apiClient as defaultApiClient,
  type ApiClient,
  type ErrorRecoveryAction,
} from "../app/api";
import {
  MAX_UPLOAD_BYTES,
  isSupportedImageType,
} from "../app/config";
import type { TaskError, TaskOperation, TaskView } from "../domain/task";
import TaskProgress from "./TaskProgress";
import RetouchFeatureGrid from "./RetouchFeatureGrid";

export type PreviewChangeHandler = (previewUrl: string | null, release?: () => void) => void;

interface UploadPanelProps {
  inviteToken: string | null;
  onTaskUpdate: (task: TaskView) => void;
  onPreviewChange?: PreviewChangeHandler;
  onTaskReset?: () => void;
  getOperationKey?: (taskId: string, operation: TaskOperation) => string;
  apiClient?: ApiClient;
}

function validateFile(file: File): string | null {
  if (!isSupportedImageType(file.type)) return "仅支持 JPG 或 PNG 图片。";
  if (file.size > MAX_UPLOAD_BYTES) return "文件不能超过 20MB。";
  return null;
}

function readPreview(file: File): Promise<string> {
  if (typeof URL.createObjectURL === "function") {
    return Promise.resolve(URL.createObjectURL(file));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error || new Error("preview unavailable"));
    reader.readAsDataURL(file);
  });
}

function isNewFileSelection(previous: File, next: File): boolean {
  return (
    previous !== next ||
    previous.name !== next.name ||
    previous.size !== next.size ||
    previous.type !== next.type ||
    previous.lastModified !== next.lastModified
  );
}

export default function UploadPanel({
  inviteToken,
  onTaskUpdate,
  onPreviewChange,
  onTaskReset,
  getOperationKey,
  apiClient = defaultApiClient,
}: UploadPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [createdTask, setCreatedTask] = useState<TaskView | null>(null);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [retryableAnalysis, setRetryableAnalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<TaskError | null>(null);
  const [progressStatus, setProgressStatus] = useState<TaskView["status"]>("created");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const release = previewUrl?.startsWith("blob:")
      ? () => URL.revokeObjectURL(previewUrl)
      : undefined;
    onPreviewChange?.(previewUrl, release);
  }, [onPreviewChange, previewUrl]);

  async function handleFileChange(selected: File | undefined) {
    if (!selected || busy) return;
    const replacesCreatedTask = Boolean(
      createdTask && file && isNewFileSelection(file, selected),
    );
    if (replacesCreatedTask) {
      setCreatedTask(null);
      setUploadComplete(false);
      setRetryableAnalysis(false);
      setProgressStatus("created");
      setPreviewUrl(null);
      onTaskReset?.();
    }
    const validationError = validateFile(selected);
    setError(validationError);
    setTaskError(
      validationError
        ? { code: "UNSUPPORTED_IMAGE", message: validationError, retryable: false }
        : null,
    );
    setFile(validationError ? null : selected);
    if (validationError) {
      setProgressStatus("failed");
      setPreviewUrl(null);
      return;
    }
    setProgressStatus("created");
    try {
      setPreviewUrl(await readPreview(selected));
    } catch {
      setError("原图预览失败，请重新选择文件。");
      setTaskError({
        code: "UNSUPPORTED_IMAGE",
        message: "图片预览失败，请重新上传图片。",
        retryable: false,
      });
      setProgressStatus("failed");
      setFile(null);
      setPreviewUrl(null);
    }
  }

  async function handleUpload() {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setTaskError(null);
    let taskForRetry = createdTask;
    let isUploaded = uploadComplete;
    try {
      if (!taskForRetry) {
        taskForRetry = await apiClient.createTask(
          {
            filename: file.name,
            contentType: file.type,
            byteSize: file.size,
          },
          inviteToken,
        );
        setCreatedTask(taskForRetry);
        onTaskUpdate(taskForRetry);
        setProgressStatus("uploading");
      }
      if (!isUploaded) {
        if (!taskForRetry.uploadUrl) throw new Error("missing upload url");
        await apiClient.uploadOriginal(taskForRetry.uploadUrl, file);
        isUploaded = true;
        setUploadComplete(true);
      }
      setProgressStatus("analyzing");
      setRetryableAnalysis(false);
      await apiClient.startAnalysis(
        taskForRetry.taskId,
        inviteToken,
        getOperationKey?.(taskForRetry.taskId, "analyze") || createIdempotencyKey(),
      );
      const analyzed = await apiClient.getTask(taskForRetry.taskId, inviteToken);
      setRetryableAnalysis(analyzed.status === "analyzing");
      setProgressStatus(analyzed.status);
      setTaskError(analyzed.error);
      onTaskUpdate(analyzed);
    } catch (caught) {
      const safeState = getUserSafeErrorState(caught);
      setError(safeState.message);
      setTaskError({
        code: safeState.code,
        message: safeState.message,
        retryable: safeState.retryable,
      });
      setProgressStatus("failed");
      setRetryableAnalysis(Boolean(taskForRetry && isUploaded));
      onTaskUpdate({
        taskId: taskForRetry?.taskId || "local-upload",
        status: "failed",
        originalAssetUrl: taskForRetry?.originalAssetUrl,
        analysis: [],
        plan: taskForRetry?.plan || null,
        versions: [],
        error: {
          code: safeState.code,
          message: safeState.message,
          retryable: safeState.retryable,
        },
      });
    } finally {
      setBusy(false);
    }
  }

  function resetUpload() {
    setFile(null);
    setPreviewUrl(null);
    setCreatedTask(null);
    setUploadComplete(false);
    setRetryableAnalysis(false);
    setTaskError(null);
    setError(null);
    setProgressStatus("created");
    onTaskReset?.();
  }

  function handleRecovery(action: ErrorRecoveryAction) {
    if (action === "retry") {
      void handleUpload();
      return;
    }
    resetUpload();
  }

  return (
    <section
      className={`panel upload-panel studio-panel-enter ${previewUrl ? "upload-panel-ready" : ""}`}
      aria-labelledby="upload-title"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">第一步 · 上传照片</p>
          <h2 id="upload-title">先放一张你喜欢的照片</h2>
        </div>
        <span className="badge">JPG / PNG · ≤ 20MB</span>
      </div>
      <p className="muted">我们会保留你的脸、姿势和服装设计，只帮你把细节变得更好。</p>
      <RetouchFeatureGrid />
      <label className="file-drop" htmlFor="source-image">
        <span className="file-drop-icon" aria-hidden="true">＋</span>
        <strong>把 COS 照片放在这里</strong>
        <span className="muted">支持 JPG、PNG，最大 20MB</span>
        <input
          id="source-image"
          type="file"
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
          aria-label="选择 JPG 或 PNG 原图"
          disabled={busy}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.currentTarget.value = "";
            void handleFileChange(selected);
          }}
        />
      </label>
      {previewUrl && (
        <div className="preview-wrap">
          <img src={previewUrl} alt="待处理原图预览" />
          <span>{file?.name}</span>
        </div>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="primary-button" type="button" disabled={!file || busy} onClick={() => void handleUpload()}>
        {busy ? "正在准备预览…" : retryableAnalysis ? "再试一次" : "开始看看哪里可以更好"}
      </button>
      {busy || progressStatus !== "created" || taskError ? (
        <TaskProgress status={progressStatus} error={taskError} onRecover={handleRecovery} />
      ) : null}
    </section>
  );
}
