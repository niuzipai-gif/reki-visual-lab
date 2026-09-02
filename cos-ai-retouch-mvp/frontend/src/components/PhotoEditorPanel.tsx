import { useMemo, useRef, useState } from "react";

import {
  DEFAULT_ADJUSTMENTS,
  type AdjustmentValues,
  type EditorDocument,
  type EditorLayer,
  type EditorMaskStroke,
  type EditorPresetId,
} from "../domain/editor";
import { applyPreset, clampAdjustments, createInitialEditorDocument, normalizeMaskStrokes } from "../editor/operations";
import { buildPsdBytes, createAuraProjectJson, createJpgBlob, downloadBlob, downloadJson, loadImageData } from "../editor/exporters";
import type { WorkflowPlanView } from "../domain/editor";
import type { ApiClient } from "../app/api";
import EditorCanvas from "./EditorCanvas";
import EditorControls, { type EditorAdjustmentKey, type EditorModule, type EditorTool } from "./EditorControls";
import EditorLayers from "./EditorLayers";

interface PhotoEditorPanelProps {
  filename: string;
  sourceUrl: string;
  onBack: () => void;
  planWorkflow?: ApiClient["planWorkflow"];
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

export default function PhotoEditorPanel({ filename, sourceUrl, onBack, planWorkflow }: PhotoEditorPanelProps) {
  const initialDocument = useMemo(() => makeEditorDocument(filename, sourceUrl), [filename, sourceUrl]);
  const [editorDocument, setEditorDocument] = useState<EditorDocument>(initialDocument);
  const [selectedLayerId, setSelectedLayerId] = useState("light-base");
  const [tool, setTool] = useState<EditorTool>("select");
  const [brushWidth, setBrushWidth] = useState(28);
  const [lastChange, setLastChange] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [plannerBusy, setPlannerBusy] = useState(false);
  const historyRef = useRef<EditorDocument[]>([]);

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
        <EditorControls selectedLayer={selectedLayer} tool={tool} brushWidth={brushWidth} lastChange={lastChange} onToolChange={setTool} onBrushWidthChange={setBrushWidth} onAdjustmentChange={handleAdjustmentChange} onAddModule={handleAddModule} onApplyPreset={handleApplyPreset} onApplyAutoPreset={() => void handleApplyAutoPreset()} plannerBusy={plannerBusy} onRestore={handleRestore} onUndo={handleUndo} onExportPsd={handleExportPsd} onExportJpg={handleExportJpg} onSaveProject={handleSaveProject} />
      </div>
      {exportMessage && <p className="editor-export-message" role="status">{exportMessage}</p>}
    </section>
  );
}
