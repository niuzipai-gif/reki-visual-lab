import { useEffect, useState } from "react";

import {
  createIdempotencyKey,
  getUserSafeErrorMessage,
  apiClient as defaultApiClient,
  type ApiClient,
} from "../app/api";
import {
  MAX_UPLOAD_BYTES,
  isSupportedImageType,
} from "../app/config";
import type { TaskView } from "../domain/task";
import TaskProgress from "./TaskProgress";

interface UploadPanelProps {
  inviteToken: string;
  onTaskUpdate: (task: TaskView) => void;
  onPreviewChange?: (previewUrl: string | null) => void;
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

export default function UploadPanel({
  inviteToken,
  onTaskUpdate,
  onPreviewChange,
  apiClient = defaultApiClient,
}: UploadPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressStatus, setProgressStatus] = useState<TaskView["status"]>("created");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onPreviewChange?.(previewUrl);
    return () => {
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [onPreviewChange, previewUrl]);

  async function handleFileChange(selected: File | undefined) {
    if (!selected) return;
    const validationError = validateFile(selected);
    setError(validationError);
    setFile(validationError ? null : selected);
    if (validationError) {
      setPreviewUrl(null);
      return;
    }
    try {
      setPreviewUrl(await readPreview(selected));
    } catch {
      setError("原图预览失败，请重新选择文件。");
      setFile(null);
      setPreviewUrl(null);
    }
  }

  async function handleUpload() {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await apiClient.createTask(
        {
          filename: file.name,
          contentType: file.type,
          byteSize: file.size,
        },
        inviteToken,
      );
      onTaskUpdate(created);
      setProgressStatus("uploading");
      if (!created.uploadUrl) throw new Error("missing upload url");
      await apiClient.uploadOriginal(created.uploadUrl, file);
      setProgressStatus("analyzing");
      await apiClient.startAnalysis(
        created.taskId,
        inviteToken,
        createIdempotencyKey(),
      );
      const analyzed = await apiClient.getTask(created.taskId, inviteToken);
      setProgressStatus(analyzed.status);
      onTaskUpdate(analyzed);
    } catch (caught) {
      const safeMessage = getUserSafeErrorMessage(caught);
      setError(safeMessage);
      setProgressStatus("failed");
      onTaskUpdate({
        taskId: "local-upload",
        status: "failed",
        analysis: [],
        plan: null,
        versions: [],
        error: { code: "UPLOAD_FAILED", message: safeMessage, retryable: true },
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel upload-panel" aria-labelledby="upload-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">STEP 1 · ORIGINAL</p>
          <h2 id="upload-title">上传原图</h2>
        </div>
        <span className="badge">JPG / PNG · ≤ 20MB</span>
      </div>
      <p className="muted">原图会保持不变。上传后，系统只分析局部修图建议，不会把提示词或模型密钥暴露到浏览器。</p>
      <label className="file-drop" htmlFor="source-image">
        <span className="file-drop-icon" aria-hidden="true">＋</span>
        <strong>选择一张 COS 原图</strong>
        <span className="muted">支持 JPG、PNG，最大 20MB</span>
        <input
          id="source-image"
          type="file"
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
          aria-label="选择 JPG 或 PNG 原图"
          onChange={(event) => void handleFileChange(event.target.files?.[0])}
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
        {busy ? "正在准备…" : "上传并开始分析"}
      </button>
      {busy || progressStatus !== "created" ? <TaskProgress status={progressStatus} /> : null}
    </section>
  );
}
