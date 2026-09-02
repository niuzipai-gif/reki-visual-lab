import { useMemo, useRef, useState, type ChangeEvent } from "react";

import {
  DEFAULT_ADJUSTMENTS,
  type AdjustmentValues,
  type EditorDocument,
  type EditorLayer,
  type EditorMaskStroke,
  type EditorPresetId,
} from "../domain/editor";
import { applyPreset, clampAdjustments, createInitialEditorDocument, normalizeMaskStrokes } from "../editor/operations";
import { buildPsdBytes, createAuraProjectJson, createJpgBlob, downloadBlob, downloadJson, loadImageData, readAuraProjectJson } from "../editor/exporters";
import type { WorkflowPlanView } from "../domain/editor";
import {
  getUserSafeErrorState,
  apiClient as defaultApiClient,
  type ApiClient,
} from "../app/api";
import {
  DEFAULT_INTEGRATION,
  DEFAULT_PRESERVE,
  DEFAULT_VALIDATION,
  type EditPlanInput,
  type TaskView,
} from "../domain/task";
import EditorCanvas from "./EditorCanvas";
import EditorControls, { type EditorAdjustmentKey, type EditorModule, type EditorTool } from "./EditorControls";
import EditorLayers from "./EditorLayers";

interface PhotoEditorPanelProps {
  filename: string;
  sourceUrl: string;
  sourceFile?: File;
  onBack: () => void;
  planWorkflow?: ApiClient["planWorkflow"];
  apiClient?: ApiClient;
}

const MODULE_LABELS: Record<EditorModule, string> = {
  light: "光影重塑",
  skin: "面部精修",
  hair: "发丝整理",
  costume: "服装修复",
  body: "身形边缘",
  background: "背景清理",
  style: "风格质感",
};

function makeEditorDocument(filename: string, sourceUrl: string): EditorDocument {
  const document = createInitialEditorDocument(filename, 1200, 800);
  return { ...document, sourceDataUrl: sourceUrl };
}

function workflowAdjustments(operation: WorkflowPlanView["operations"][number]): AdjustmentValues {
  const intensity = operation.intensity - 50;
  switch (operation.module) {
    case "light": return { ...DEFAULT_ADJUSTMENTS, exposure: Math.round(intensity * 0.8), contrast: Math.round(intensity * 0.45) };
    case "style": return { ...DEFAULT_ADJUSTMENTS, saturation: Math.round(-Math.max(0, operation.intensity - 35) * 0.35), temperature: Math.round(intensity * 0.2), vignette: Math.max(0, operation.intensity - 30) };
    case "skin": return { ...DEFAULT_ADJUSTMENTS, saturation: -4, sharpness: Math.round(operation.intensity * 0.18) };
    default: return { ...DEFAULT_ADJUSTMENTS };
  }
}

function applyWorkflowPlan(document: EditorDocument, plan: WorkflowPlanView): EditorDocument {
  const retainedLayers = document.layers.filter((layer) => !layer.id.startsWith("workflow-"));
  const workflowLayers: EditorLayer[] = plan.operations.map((operation) => ({
    id: `workflow-${operation.id}`,
    name: operation.requiresRemoteAi ? `${operation.label} · 待云端 AI` : operation.label,
    kind: operation.kind,
    module: operation.module,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    scope: operation.scope,
    adjustments: workflowAdjustments(operation),
    maskStrokes: [],
    operation: {
      id: operation.id,
      label: operation.label,
      module: operation.module,
      kind: operation.kind,
      scope: operation.scope,
      adjustments: workflowAdjustments(operation),
      preserve: operation.preserve,
      requiresRemoteAi: operation.requiresRemoteAi,
    },
  }));
  return { ...document, layers: [...retainedLayers, ...workflowLayers] };
}

function editorPlanFromLayers(layers: EditorLayer[]): EditPlanInput {
  const aiLayers = layers.filter((layer) => layer.kind === "ai" && layer.visible);
  return {
    goals: ["natural_retouch"],
    preserve: [...DEFAULT_PRESERVE],
    regions: [],
    maskStrokes: aiLayers.flatMap((layer) => layer.maskStrokes),
    operations: aiLayers.map((layer) => ({
      id: layer.operation?.id || layer.id,
      kind: layer.operation?.module || layer.module,
      goal: "natural_retouch" as const,
      regionIds: [],
      intensity: Math.min(100, Math.max(0, Math.round(50 + layer.adjustments.sharpness * 0.2))),
      enabled: true,
      instructions: `${layer.name}。仅处理该模块允许的局部细节，保留脸部身份、姿势、服装设计、构图和原始光线。`,
    })),
    intensity: 55,
    integration: [...DEFAULT_INTEGRATION],
    validation: [...DEFAULT_VALIDATION],
    notes: "来自浏览器 COS 工作台的局部 AI 图层；用户已确认后提交。",
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function PhotoEditorPanel({ filename, sourceUrl, sourceFile, onBack, planWorkflow, apiClient = defaultApiClient }: PhotoEditorPanelProps) {
  const initialDocument = useMemo(() => makeEditorDocument(filename, sourceUrl), [filename, sourceUrl]);
  const [editorDocument, setEditorDocument] = useState<EditorDocument>(initialDocument);
  const [selectedLayerId, setSelectedLayerId] = useState("light-base");
  const [tool, setTool] = useState<EditorTool>("select");
  const [brushWidth, setBrushWidth] = useState(28);
  const [lastChange, setLastChange] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteTask, setRemoteTask] = useState<TaskView | null>(null);
  const [remoteMessage, setRemoteMessage] = useState<string | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const historyRef = useRef<EditorDocument[]>([]);
  const projectInputRef = useRef<HTMLInputElement>(null);

  const selectedLayer = editorDocument.layers.find((layer) => layer.id === selectedLayerId);

  function commit(nextDocument: EditorDocument, message: string) {
    historyRef.current.push(editorDocument);
    setEditorDocument({ ...nextDocument, history: [...editorDocument.history, message] });
    setLastChange(message);
  }

  function updateLayer(layerId: string, update: (layer: EditorLayer) => EditorLayer, message: string) {
    commit({
      ...editorDocument,
      layers: editorDocument.layers.map((layer) => layer.id === layerId ? update(layer) : layer),
    }, message);
  }

  function handleAdjustmentChange(key: EditorAdjustmentKey, value: number) {
    const layer = selectedLayer?.kind === "adjustment" || selectedLayer?.kind === "ai" ? selectedLayer : editorDocument.layers.find((item) => item.id === "light-base");
    if (!layer || layer.locked) return;
    const adjustments: AdjustmentValues = clampAdjustments({ ...layer.adjustments, [key]: value });
    setSelectedLayerId(layer.id);
    updateLayer(layer.id, (current) => ({ ...current, adjustments }), `已记录在「${layer.name}」图层`);
  }

  function handleAddModule(module: EditorModule) {
    if (module === "light") {
      setSelectedLayerId("light-base");
      setTool("select");
      setLastChange("已切换到「光影与色彩」图层");
      return;
    }
    const layerId = `module-${module}`;
    const existing = editorDocument.layers.find((layer) => layer.id === layerId);
    if (existing) {
      setSelectedLayerId(layerId);
      setLastChange(`已选中「${existing.name}」`);
      return;
    }
    const label = MODULE_LABELS[module];
    const isAdjustmentModule = module === "style";
    const operation = {
      id: layerId,
      label,
      module,
      kind: isAdjustmentModule ? "adjustment" as const : "ai" as const,
      scope: isAdjustmentModule ? "global" as const : "local" as const,
      adjustments: {},
      preserve: ["face identity", "main pose", "costume design", "composition"],
      ...(isAdjustmentModule ? {} : { requiresRemoteAi: true }),
    };
    const layer: EditorLayer = {
      id: layerId,
      name: isAdjustmentModule ? label : `${label} · 待云端 AI`,
      kind: isAdjustmentModule ? "adjustment" : "ai",
      module,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal",
      scope: "local",
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      maskStrokes: [],
      operation,
    };
    commit({ ...editorDocument, layers: [...editorDocument.layers, layer] }, `已加入「${label}」任务层`);
    setSelectedLayerId(layerId);
    setTool(isAdjustmentModule ? "select" : "mask-add");
  }

  function handleApplyPreset(preset: EditorPresetId, message = "已套用后期方案") {
    const next = applyPreset(editorDocument, preset);
    commit(next, `${message}：${preset}`);
    const firstPresetLayer = next.layers.find((layer) => layer.id.startsWith(`preset-${preset}-`));
    setSelectedLayerId(firstPresetLayer?.id || "light-base");
    setTool(firstPresetLayer?.scope === "local" ? "mask-add" : "select");
  }

  async function handleApplyAutoPreset() {
    if (!planWorkflow) {
      handleApplyPreset("natural-studio", "已完成自动 COS 人像基础链路");
      return;
    }
    setPlannerBusy(true);
    try {
      const plan = await planWorkflow({ filename, preset: "natural-studio", modules: [], hasMask: false });
      const next = applyWorkflowPlan(editorDocument, plan);
      commit(next, `智能体已完成后期拆解：${plan.operations.length} 个步骤`);
      const first = next.layers.find((layer) => layer.id.startsWith("workflow-"));
      setSelectedLayerId(first?.id || "light-base");
      setTool(first?.scope === "local" ? "mask-add" : "select");
    } catch {
      handleApplyPreset("natural-studio", "云端规划暂不可用，已切换本地自动方案");
    } finally {
      setPlannerBusy(false);
    }
  }

  async function handleRunRemoteAi() {
    const aiLayers = editorDocument.layers.filter((layer) => layer.kind === "ai" && layer.visible);
    if (!aiLayers.length) {
      setRemoteError("请先加入并显示一个局部 AI 图层。");
      return;
    }
    if (!sourceFile) {
      setRemoteError("当前照片不是从上传入口打开的，请返回后重新选择原图。");
      return;
    }
    setRemoteBusy(true);
    setRemoteError(null);
    setRemoteMessage("正在把原图安全上传到处理队列…");
    setRemoteTask(null);
    try {
      const created = await apiClient.createTask({
        filename: sourceFile.name,
        contentType: sourceFile.type,
        byteSize: sourceFile.size,
      });
      if (!created.uploadUrl) throw new Error("上传地址暂不可用");
      await apiClient.uploadOriginal(created.uploadUrl, sourceFile);

      const analysisKey = `editor-analyze-${created.taskId}`;
      let analyzed = created;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await apiClient.startAnalysis(created.taskId, null, analysisKey);
        analyzed = await apiClient.getTask(created.taskId);
        if (analyzed.status === "awaiting_confirmation") break;
        if (analyzed.status === "failed") throw new Error(analyzed.error?.message || "照片分析失败");
        if (analyzed.status !== "analyzing") break;
        if (attempt < 3) await wait(500);
      }
      if (analyzed.status !== "awaiting_confirmation") throw new Error("照片分析仍在进行，请稍后重试");

      await apiClient.savePlan(created.taskId, editorPlanFromLayers(aiLayers));
      const generationKey = `editor-generate-${created.taskId}`;
      let generated = await apiClient.getTask(created.taskId);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await apiClient.startGeneration(created.taskId, null, generationKey);
        generated = await apiClient.getTask(created.taskId);
        if (generated.status === "succeeded" || generated.status === "failed") break;
        await wait(700);
      }
      setRemoteTask(generated);
      if (generated.status === "succeeded") {
        setRemoteMessage("云端 AI 已完成，结果已回到工作台下方，可与原图对照。");
        setLastChange(`云端 AI 已完成：${generated.versions.length} 个候选结果`);
      } else if (generated.status === "failed") {
        throw new Error(generated.error?.message || "云端 AI 处理失败");
      } else {
        setRemoteMessage("任务已提交，云端仍在处理中；可稍后重新打开结果页查看。");
      }
    } catch (caught) {
      const safeState = getUserSafeErrorState(caught);
      setRemoteError(safeState.message || (caught instanceof Error ? caught.message : "云端 AI 暂不可用"));
      setRemoteMessage(null);
    } finally {
      setRemoteBusy(false);
    }
  }

  function handleImportProjectClick() {
    projectInputRef.current?.click();
  }

  async function handleImportProject(event: ChangeEvent<HTMLInputElement>) {
    const projectFile = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!projectFile) return;
    try {
      const restored = readAuraProjectJson(await projectFile.text(), sourceUrl);
      historyRef.current = [];
      setEditorDocument(restored);
      const firstEditable = restored.layers.find((layer) => !layer.locked) || restored.layers[0];
      setSelectedLayerId(firstEditable?.id || "light-base");
      setTool(firstEditable?.scope === "local" ? "mask-add" : "select");
      setLastChange(`已导入项目：${projectFile.name}；当前原图保持不变`);
      setRemoteTask(null);
      setRemoteError(null);
      setRemoteMessage(null);
    } catch (caught) {
      setRemoteError(caught instanceof Error ? caught.message : "项目 JSON 导入失败，请重试");
    }
  }

  function handleMaskStroke(stroke: EditorMaskStroke) {
    const layer = selectedLayer?.locked ? editorDocument.layers.find((item) => item.id === "light-base") : selectedLayer;
    if (!layer) return;
    const nextStrokes = normalizeMaskStrokes([...layer.maskStrokes, stroke]);
    setSelectedLayerId(layer.id);
    updateLayer(layer.id, (current) => ({ ...current, maskStrokes: nextStrokes }), `蒙版已更新：${nextStrokes.length} 笔`);
  }

  function handleToggleLayer(layerId: string) {
    const layer = editorDocument.layers.find((item) => item.id === layerId);
    if (!layer || layer.locked) return;
    updateLayer(layerId, (current) => ({ ...current, visible: !current.visible }), `${layer.name}：${layer.visible ? "已隐藏" : "已显示"}`);
  }

  function handleMoveLayer(layerId: string, direction: "up" | "down") {
    const index = editorDocument.layers.findIndex((layer) => layer.id === layerId);
    if (index < 0 || editorDocument.layers[index].locked) return;
    const target = direction === "up" ? index + 1 : index - 1;
    if (target < 0 || target >= editorDocument.layers.length || editorDocument.layers[target].locked) return;
    const layers = [...editorDocument.layers];
    [layers[index], layers[target]] = [layers[target], layers[index]];
    commit({ ...editorDocument, layers }, `${editorDocument.layers[index].name}：${direction === "up" ? "已上移" : "已下移"}`);
  }

  function handleUndo() {
    const previous = historyRef.current.pop();
    if (!previous) return;
    setEditorDocument(previous);
    setLastChange("已撤回上一操作");
  }

  function handleRestore() {
    commit(makeEditorDocument(filename, sourceUrl), "已恢复原图，所有修图层已清空");
    setSelectedLayerId("light-base");
    setTool("select");
  }

  async function withSourceImage(action: (source: ImageData) => void | Promise<void>, successMessage: string) {
    if (exportBusy) return;
    setExportBusy(true);
    setExportMessage("正在读取原图并生成文件…");
    try {
      const source = await loadImageData(sourceUrl);
      await action(source);
      setExportMessage(successMessage);
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "导出失败，请重试");
    } finally {
      setExportBusy(false);
    }
  }

  function handleExportPsd() {
    void withSourceImage((source) => {
      const bytes = buildPsdBytes(editorDocument, source);
      const stem = editorDocument.filename.replace(/\.[^.]+$/, "") || "aura-cos";
      downloadBlob(new Blob([bytes], { type: "image/vnd.adobe.photoshop" }), `${stem}-aura.psd`);
    }, "PSD 已导出：图层与蒙版均已保留");
  }

  function handleExportJpg() {
    void withSourceImage(async (source) => {
      const blob = await createJpgBlob(editorDocument, source);
      const stem = editorDocument.filename.replace(/\.[^.]+$/, "") || "aura-cos";
      downloadBlob(blob, `${stem}-aura.jpg`);
    }, "JPG 已导出：已按当前工作台效果合成");
  }

  function handleSaveProject() {
    const project = createAuraProjectJson(editorDocument);
    const stem = editorDocument.filename.replace(/\.[^.]+$/, "") || "aura-cos";
    downloadJson(project, `${stem}-aura-project.json`);
    setExportMessage("项目 JSON 已保存：下次可继续编辑");
  }

  return (
    <section className="photo-editor-panel studio-panel-enter" aria-labelledby="photo-editor-title">
      <div className="photo-editor-topbar">
        <div>
          <p className="eyebrow">AURA STUDIO / BROWSER EDITOR</p>
          <h2 id="photo-editor-title">COS 修图工作台</h2>
          <p className="photo-editor-subtitle">纯网页操作 · 原图不覆盖 · PSD 可导出</p>
        </div>
        <div className="photo-editor-top-actions">
          <span className="privacy-note">原图保护中</span>
          <button type="button" className="secondary-button" onClick={onBack}>返回照片选择</button>
        </div>
      </div>
      <div className="photo-editor-layout">
        <div className="photo-editor-left">
          <EditorCanvas sourceUrl={sourceUrl} document={editorDocument} selectedLayerId={selectedLayerId} tool={tool} brushWidth={brushWidth} onMaskStroke={handleMaskStroke} />
          <div className="editor-preserve-strip">
            <span>✦ 角色身份</span>
            <span>⌁ 姿势构图</span>
            <span>◇ 服装设计</span>
            <span>☼ 光线方向</span>
          </div>
        </div>
        <div className="photo-editor-middle">
          <EditorLayers layers={editorDocument.layers} selectedLayerId={selectedLayerId} onSelect={setSelectedLayerId} onToggle={handleToggleLayer} onMove={handleMoveLayer} />
        </div>
        <EditorControls selectedLayer={selectedLayer} tool={tool} brushWidth={brushWidth} lastChange={lastChange} onToolChange={setTool} onBrushWidthChange={setBrushWidth} onAdjustmentChange={handleAdjustmentChange} onAddModule={handleAddModule} onApplyPreset={handleApplyPreset} onApplyAutoPreset={() => void handleApplyAutoPreset()} plannerBusy={plannerBusy} onRestore={handleRestore} onUndo={handleUndo} onExportPsd={handleExportPsd} onExportJpg={handleExportJpg} onSaveProject={handleSaveProject} onImportProject={handleImportProjectClick} onRunRemoteAi={() => void handleRunRemoteAi()} remoteAiAvailable={Boolean(sourceFile && editorDocument.layers.some((layer) => layer.kind === "ai" && layer.visible))} remoteAiBusy={remoteBusy} />
      </div>
      <input ref={projectInputRef} className="visually-hidden" type="file" accept="application/json,.json" aria-label="导入 AURA 项目 JSON" onChange={(event) => void handleImportProject(event)} />
      {(remoteMessage || remoteError || remoteTask) && (
        <section className="editor-remote-result" aria-labelledby="editor-remote-result-title">
          <div>
            <p className="eyebrow">CLOUD AI / RESULT</p>
            <h2 id="editor-remote-result-title">云端 AI 结果</h2>
          </div>
          {remoteError && <p className="error-text" role="alert">{remoteError}</p>}
          {remoteMessage && <p className="editor-export-message" role="status">{remoteMessage}</p>}
          {remoteTask?.status === "succeeded" && remoteTask.versions.length > 0 && (
            <div className="editor-remote-result-grid">
              {remoteTask.versions.map((version) => (
                <figure key={version.id} className="editor-remote-result-card">
                  <img src={version.assetUrl.url} alt="云端 AI 修图结果" />
                  <figcaption>
                    <span>候选结果 · {version.validation.face_identity === "pass" ? "身份检查通过" : "建议复核"}</span>
                    <a href={version.assetUrl.url} target="_blank" rel="noreferrer">打开 / 下载结果</a>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>
      )}
      {exportMessage && <p className="editor-export-message" role="status">{exportMessage}</p>}
    </section>
  );
}
