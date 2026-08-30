import { useCallback, useEffect, useRef, useState } from "react";

import { createIdempotencyKey, getUserSafeErrorMessage, apiClient as defaultApiClient, type ApiClient } from "./api";
import type { TaskOperation, TaskView } from "../domain/task";
import AnalysisPanel from "../components/AnalysisPanel";
import InviteGate from "../components/InviteGate";
import TaskProgress from "../components/TaskProgress";
import UploadPanel, { type PreviewChangeHandler } from "../components/UploadPanel";

interface AppProps {
  apiClient?: ApiClient;
}

export interface OperationKeyStore {
  get: (taskId: string, operation: TaskOperation) => string;
  clearTask: (taskId: string) => void;
}

export function createOperationKeyStore(
  generateKey: () => string = createIdempotencyKey,
): OperationKeyStore {
  const keys = new Map<string, string>();
  return {
    get(taskId, operation) {
      const scope = `${taskId}:${operation}`;
      const existing = keys.get(scope);
      if (existing) return existing;
      const key = generateKey();
      keys.set(scope, key);
      return key;
    },
    clearTask(taskId) {
      keys.delete(`${taskId}:analyze`);
      keys.delete(`${taskId}:generate`);
    },
  };
}

export default function App({ apiClient = defaultApiClient }: AppProps) {
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [task, setTask] = useState<TaskView | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [operationKeyStore] = useState(createOperationKeyStore);
  const previewUrlRef = useRef<string | null>(null);
  const previewCleanupRef = useRef<(() => void) | null>(null);

  const handlePreviewChange = useCallback<PreviewChangeHandler>((nextUrl, release) => {
    if (nextUrl !== previewUrlRef.current) previewCleanupRef.current?.();
    previewUrlRef.current = nextUrl;
    previewCleanupRef.current = release || null;
    setPreviewUrl(nextUrl);
  }, []);

  useEffect(() => () => {
    previewCleanupRef.current?.();
    previewCleanupRef.current = null;
  }, []);

  function handleInviteSubmit(token: string) {
    setGateError(null);
    setInviteToken(token);
  }

  function handleTaskUpdate(nextTask: TaskView) {
    setTask(nextTask);
    if (nextTask.status === "failed" && nextTask.taskId === "local-upload") {
      setGateError(getUserSafeErrorMessage(new Error(nextTask.error?.message)));
    }
  }

  if (!inviteToken) {
    return (
      <main className="app-shell gate-shell">
        <InviteGate onSubmit={handleInviteSubmit} error={gateError} />
      </main>
    );
  }

  const showAnalysis = Boolean(
    task &&
      task.taskId !== "local-upload" &&
      (task.status === "awaiting_confirmation" ||
        task.status === "generating" ||
        task.status === "validating" ||
        task.status === "succeeded" ||
        (task.status === "failed" && Boolean(task.plan))),
  );

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">COS AI RETOUCH</p>
          <h1>角色原图修复工作台</h1>
        </div>
        <span className="privacy-note">原图不覆盖 · 局部可控</span>
      </header>
      <div className="workflow-layout">
        <div className="workflow-main">
          {!showAnalysis && (
            <UploadPanel
              inviteToken={inviteToken}
              apiClient={apiClient}
              getOperationKey={operationKeyStore.get}
              onTaskUpdate={handleTaskUpdate}
              onPreviewChange={handlePreviewChange}
              onTaskReset={() => {
                if (task) operationKeyStore.clearTask(task.taskId);
                setTask(null);
              }}
            />
          )}
          {showAnalysis && task && (
            <AnalysisPanel
              task={task}
              inviteToken={inviteToken}
              apiClient={apiClient}
              getOperationKey={operationKeyStore.get}
              onTaskUpdate={handleTaskUpdate}
              previewUrl={previewUrl ?? task.originalAssetUrl?.url ?? null}
            />
          )}
        </div>
        <aside className="workflow-aside">
          <div className="aside-card">
            <p className="eyebrow">WORKFLOW</p>
            <ol className="step-list">
              <li className={!task ? "active" : "complete"}><span>01</span>上传原图</li>
              <li className={showAnalysis ? "active" : "pending"}><span>02</span>确认分析</li>
              <li className={task?.status === "succeeded" ? "complete" : "pending"}><span>03</span>生成候选</li>
            </ol>
            <p className="aside-copy">每个建议都需要明确确认，生成只使用结构化修图计划。</p>
          </div>
          {task?.status === "failed" && task.taskId !== "local-upload" && (
            <TaskProgress status={task.status} error={task.error} />
          )}
        </aside>
      </div>
    </main>
  );
}
