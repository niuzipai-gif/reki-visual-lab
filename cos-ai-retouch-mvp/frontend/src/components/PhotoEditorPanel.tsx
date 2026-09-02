import { useMemo, useRef, useState } from "react";

import {
  DEFAULT_ADJUSTMENTS,
  type AdjustmentValues,
  type EditorDocument,
  type EditorLayer,
  type EditorMaskStroke,
} from "../domain/editor";
import { clampAdjustments, createInitialEditorDocument, normalizeMaskStrokes } from "../editor/operations";
import { buildPsdBytes, createAuraProjectJson, createJpgBlob, downloadBlob, downloadJson, loadImageData } from "../editor/exporters";
import EditorCanvas from "./EditorCanvas";
import EditorControls, { type EditorAdjustmentKey, type EditorModule, type EditorTool } from "./EditorControls";
import EditorLayers from "./EditorLayers";

interface PhotoEditorPanelProps {
  filename: string;
  sourceUrl: string;
  onBack: () => void;
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

export default function PhotoEditorPanel({ filename, sourceUrl, onBack }: PhotoEditorPanelProps) {
  const initialDocument = useMemo(() => makeEditorDocument(filename, sourceUrl), [filename, sourceUrl]);
  const [editorDocument, setEditorDocument] = useState<EditorDocument>(initialDocument);
  const [selectedLayerId, setSelectedLayerId] = useState("light-base");
  const [tool, setTool] = useState<EditorTool>("select");
  const [brushWidth, setBrushWidth] = useState(28);
  const [lastChange, setLastChange] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
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
    const operation = {
      id: layerId,
      label,
      module,
      kind: "ai" as const,
      scope: "local" as const,
      adjustments: {},
      preserve: ["face identity", "main pose", "costume design", "composition"],
      requiresRemoteAi: true,
    };
    const layer: EditorLayer = {
      id: layerId,
      name: `${label} · 待云端 AI`,
      kind: "ai",
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
    setTool("mask-add");
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
        <EditorControls selectedLayer={selectedLayer} tool={tool} brushWidth={brushWidth} lastChange={lastChange} onToolChange={setTool} onBrushWidthChange={setBrushWidth} onAdjustmentChange={handleAdjustmentChange} onAddModule={handleAddModule} onRestore={handleRestore} onUndo={handleUndo} onExportPsd={handleExportPsd} onExportJpg={handleExportJpg} onSaveProject={handleSaveProject} />
      </div>
      {exportMessage && <p className="editor-export-message" role="status">{exportMessage}</p>}
    </section>
  );
}
