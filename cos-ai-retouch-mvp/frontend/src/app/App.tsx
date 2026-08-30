import { useState } from "react";

import { getUserSafeErrorMessage, apiClient as defaultApiClient, type ApiClient } from "./api";
import type { TaskView } from "../domain/task";
import AnalysisPanel from "../components/AnalysisPanel";
import InviteGate from "../components/InviteGate";
import TaskProgress from "../components/TaskProgress";
import UploadPanel from "../components/UploadPanel";

interface AppProps {
  apiClient?: ApiClient;
}

export default function App({ apiClient = defaultApiClient }: AppProps) {
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [task, setTask] = useState<TaskView | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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

  const showAnalysis = task && task.status !== "uploading" && task.status !== "created" && task.taskId !== "local-upload";

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
              onTaskUpdate={handleTaskUpdate}
              onPreviewChange={setPreviewUrl}
            />
          )}
          {showAnalysis && task && (
            <AnalysisPanel
              task={task}
              inviteToken={inviteToken}
              apiClient={apiClient}
              onTaskUpdate={handleTaskUpdate}
              previewUrl={previewUrl}
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
