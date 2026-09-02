import { useCallback, useEffect, useRef, useState } from "react";

import {
  createIdempotencyKey,
  getUserSafeErrorState,
  apiClient as defaultApiClient,
  type ApiClient,
  type ErrorRecoveryAction,
} from "./api";
import type { TaskOperation, TaskView } from "../domain/task";
import AnalysisPanel from "../components/AnalysisPanel";
import InviteGate from "../components/InviteGate";
import ResultPanel from "../components/ResultPanel";
import StudioHeader from "../components/StudioHeader";
import TaskProgress from "../components/TaskProgress";
import UploadPanel, { type PreviewChangeHandler } from "../components/UploadPanel";
import WorkflowRail, { type WorkflowStep } from "../components/WorkflowRail";

interface AppProps {
  apiClient?: ApiClient;
}

export interface OperationKeyStore {
  get: (taskId: string, operation: TaskOperation) => string;
  clearTask: (taskId: string) => void;
}

type InviteToken = string | null;

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
  const [inviteToken, setInviteToken] = useState<InviteToken>(null);
  const [showInviteGate, setShowInviteGate] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [task, setTask] = useState<TaskView | null>(null);
  const [reviewRequested, setReviewRequested] = useState(false);
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
    setInviteToken(token.trim() || null);
    setShowInviteGate(false);
  }

  function handleTaskUpdate(nextTask: TaskView) {
    if (nextTask.status === "failed" && nextTask.taskId === "local-upload") {
      const safeState = getUserSafeErrorState(nextTask.error);
      if (safeState.action === "invite") {
        setGateError(safeState.message);
        setInviteToken(null);
        setTask(null);
        setShowInviteGate(true);
        return;
      }
    }
    setTask(nextTask);
  }

  function resetWorkflow() {
    if (task) operationKeyStore.clearTask(task.taskId);
    previewCleanupRef.current?.();
    previewCleanupRef.current = null;
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setTask(null);
    setReviewRequested(false);
  }

  function handleRecovery(action: ErrorRecoveryAction) {
    if (action === "invite") {
      setGateError(task?.error?.message || "邀请 token 无效，请重新输入。");
      setInviteToken(null);
      setTask(null);
      setShowInviteGate(true);
      return;
    }
    if (action === "review") {
      setReviewRequested(true);
      return;
    }
    if (action === "back" || action === "reupload") resetWorkflow();
  }

  if (showInviteGate) {
    return (
      <main className="app-shell gate-shell">
        <InviteGate onSubmit={handleInviteSubmit} error={gateError} />
      </main>
    );
  }

  const showResult = Boolean(
    task &&
      task.taskId !== "local-upload" &&
      (task.status === "succeeded" || (reviewRequested && task.versions.length > 0)),
  );
  const showAnalysis = Boolean(
    !showResult &&
      task &&
      task.taskId !== "local-upload" &&
      (task.status === "awaiting_confirmation" ||
        task.status === "generating" ||
        task.status === "validating" ||
        (task.status === "failed" && Boolean(task.plan))),
  );
  const currentStep: WorkflowStep = showResult ? "result" : showAnalysis ? "analysis" : "upload";

  return (
    <main className="app-shell studio-shell" data-stage={currentStep}>
      <StudioHeader currentStep={currentStep} />
      <div className="workflow-layout studio-layout">
        <WorkflowRail currentStep={currentStep} />
        <div className="workflow-main photo-stage" data-testid="workflow-main">
          {!showAnalysis && !showResult && (
            <UploadPanel
              inviteToken={inviteToken}
              apiClient={apiClient}
              getOperationKey={operationKeyStore.get}
              onTaskUpdate={handleTaskUpdate}
              onPreviewChange={handlePreviewChange}
              onTaskReset={resetWorkflow}
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
              onBackToUpload={resetWorkflow}
              onReviewResults={() => setReviewRequested(true)}
            />
          )}
          {showResult && task && (
            <ResultPanel
              task={task}
              originalUrl={previewUrl ?? task.originalAssetUrl?.url ?? ""}
              inviteToken={inviteToken}
              apiClient={apiClient}
              createGenerationKey={createIdempotencyKey}
              onTaskUpdate={handleTaskUpdate}
              onResetWorkflow={resetWorkflow}
              onRestoreOriginal={() => {
                setTask((current) =>
                  current
                    ? {
                        ...current,
                        versions: current.versions.map((version) => ({
                          ...version,
                          selected: false,
                        })),
                      }
                    : current,
                );
              }}
            />
          )}
        </div>
        <aside className="workflow-aside control-rail" data-testid="workflow-aside">
          <div className="studio-control-card">
            <p className="eyebrow">NOW IN THE STUDIO</p>
            <strong>{currentStep === "upload" ? "准备一张照片" : currentStep === "analysis" ? "选择想变好的地方" : "挑一张最像你的"}</strong>
            <span>所有改变都会先给你确认。</span>
          </div>
          <p className="studio-rail-note">每一步都由你确认，原图和角色感都会好好保留。</p>
          {task?.status === "failed" && task.taskId !== "local-upload" && (
            <TaskProgress status={task.status} error={task.error} onRecover={handleRecovery} />
          )}
          {task?.status === "expired" && task.taskId !== "local-upload" && (
            <TaskProgress status={task.status} error={task.error} onRecover={handleRecovery} />
          )}
        </aside>
      </div>
    </main>
  );
}
