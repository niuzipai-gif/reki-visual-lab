import type { AdjustmentValues, EditorLayer, EditorLayerKind, EditorOperationStep, EditorPresetId } from "../domain/editor";

export type EditorTool = "select" | "mask-add" | "mask-erase";
export type EditorAdjustmentKey = keyof AdjustmentValues;
export type EditorModule = EditorOperationStep["module"];

interface EditorControlsProps {
  selectedLayer: EditorLayer | undefined;
  tool: EditorTool;
  brushWidth: number;
  lastChange: string | null;
  onToolChange: (tool: EditorTool) => void;
  onBrushWidthChange: (width: number) => void;
  onAdjustmentChange: (key: EditorAdjustmentKey, value: number) => void;
  onAddModule: (module: EditorModule) => void;
  onApplyPreset: (preset: EditorPresetId) => void;
  onApplyAutoPreset: () => void;
  plannerBusy?: boolean;
  onRestore: () => void;
  onUndo: () => void;
  onExportPsd: () => void;
  onExportJpg: () => void;
  onSaveProject: () => void;
  onImportProject: () => void;
  onRunRemoteAi: () => void;
  remoteAiAvailable?: boolean;
  remoteAiBusy?: boolean;
}

const MODULES: Array<{ id: EditorModule; label: string; icon: string; kind: EditorLayerKind }> = [
  { id: "skin", label: "面部精修", icon: "✦", kind: "ai" },
  { id: "hair", label: "发丝整理", icon: "⌁", kind: "ai" },
  { id: "costume", label: "服装修复", icon: "◇", kind: "ai" },
  { id: "body", label: "身形边缘", icon: "⌁", kind: "ai" },
  { id: "background", label: "背景清理", icon: "□", kind: "ai" },
  { id: "light", label: "光影重塑", icon: "☼", kind: "adjustment" },
  { id: "style", label: "风格质感", icon: "◌", kind: "adjustment" },
];

const PRESETS: Array<{ id: EditorPresetId; label: string; note: string }> = [
  { id: "natural-studio", label: "自然棚拍", note: "提亮 · 肤色 · 柔光" },
  { id: "clear-japanese", label: "清透日系", note: "亮肤 · 空气感 · 发丝" },
  { id: "retro-film", label: "复古胶片", note: "褪色 · 暖调 · 颗粒" },
  { id: "dark-cinema", label: "暗调电影", note: "对比 · 冷暖 · 清场" },
];

const ADJUSTMENTS: Array<{ key: EditorAdjustmentKey; label: string; min: number; max: number }> = [
  { key: "exposure", label: "曝光", min: -100, max: 100 },
  { key: "contrast", label: "对比度", min: -100, max: 100 },
  { key: "saturation", label: "饱和度", min: -100, max: 100 },
  { key: "temperature", label: "色温", min: -100, max: 100 },
  { key: "sharpness", label: "锐度", min: 0, max: 100 },
  { key: "grain", label: "颗粒", min: 0, max: 100 },
  { key: "vignette", label: "暗角", min: 0, max: 100 },
];

export default function EditorControls({
  selectedLayer,
  tool,
  brushWidth,
  lastChange,
  onToolChange,
  onBrushWidthChange,
  onAdjustmentChange,
  onAddModule,
  onApplyPreset,
  onApplyAutoPreset,
  plannerBusy = false,
  onRestore,
  onUndo,
  onExportPsd,
  onExportJpg,
  onSaveProject,
  onImportProject,
  onRunRemoteAi,
  remoteAiAvailable = false,
  remoteAiBusy = false,
}: EditorControlsProps) {
  const values = selectedLayer?.adjustments;
  const isAdjustmentLayer = selectedLayer?.kind === "adjustment" || selectedLayer?.kind === "ai";

  return (
    <aside className="editor-controls" aria-label="COS 修图控制区">
      <section className="editor-control-section editor-tool-section" aria-labelledby="editor-tools-title">
        <div className="editor-section-heading">
          <div>
            <p className="eyebrow">TOOLS</p>
            <h2 id="editor-tools-title">编辑工具</h2>
          </div>
        </div>
        <div className="editor-tool-grid">
          <button type="button" className={tool === "select" ? "is-active" : ""} aria-pressed={tool === "select"} onClick={() => onToolChange("select")}>选择 / 移动画布</button>
          <button type="button" className={tool === "mask-add" ? "is-active" : ""} aria-pressed={tool === "mask-add"} onClick={() => onToolChange("mask-add")}>画笔蒙版</button>
          <button type="button" className={tool === "mask-erase" ? "is-active" : ""} aria-pressed={tool === "mask-erase"} onClick={() => onToolChange("mask-erase")}>擦除蒙版</button>
        </div>
        {(tool === "mask-add" || tool === "mask-erase") && (
          <div className="editor-brush-control">
            <label htmlFor="editor-brush-width">蒙版画笔大小</label>
            <input id="editor-brush-width" type="range" min="4" max="120" value={brushWidth} onChange={(event) => onBrushWidthChange(Number(event.target.value))} />
            <output htmlFor="editor-brush-width">{brushWidth}px</output>
          </div>
        )}
        {tool !== "select" && <p className="editor-tool-hint">蒙版模式：{tool === "mask-add" ? "画出要处理的地方" : "擦掉多余区域"}</p>}
      </section>

      <section className="editor-control-section" aria-labelledby="editor-cos-title">
        <div className="editor-section-heading">
          <div>
            <p className="eyebrow">COS RETOUCH KIT</p>
            <h2 id="editor-cos-title">角色写真模块</h2>
          </div>
          <span className="editor-tip">按需启用</span>
        </div>
        <div className="editor-module-grid">
          {MODULES.map((module) => (
            <button type="button" className={`editor-module-button module-${module.kind}`} key={module.id} onClick={() => onAddModule(module.id)}>
              <span aria-hidden="true">{module.icon}</span>
              {module.label}
            </button>
          ))}
        </div>
        <p className="editor-control-note">光影和风格可在浏览器即时预览；面部、发丝、服装等局部任务会等你点击执行后才提交云端。</p>
      </section>

      <section className="editor-control-section editor-preset-section" aria-labelledby="editor-preset-title">
        <div className="editor-section-heading">
          <div>
            <p className="eyebrow">ONE-CLICK LOOK</p>
            <h2 id="editor-preset-title">一键后期方案</h2>
          </div>
          <span className="editor-tip">可撤回</span>
        </div>
        <button type="button" className="editor-auto-preset" onClick={onApplyAutoPreset} disabled={plannerBusy}>
          <span aria-hidden="true">✦</span>
          <span><strong>{plannerBusy ? "智能体正在拆解后期任务…" : "自动执行 · COS 人像基础链路"}</strong><small>保留身份、姿势、服装与原始光向</small></span>
          <span aria-hidden="true">›</span>
        </button>
        <div className="editor-preset-grid">
          {PRESETS.map((preset) => (
            <button type="button" className="editor-preset-button" key={preset.id} onClick={() => onApplyPreset(preset.id)}>
              <strong>{preset.label}</strong><small>{preset.note}</small>
            </button>
          ))}
        </div>
        <p className="editor-control-note">自动方案先拆成可编辑图层，局部 AI 不会在套用方案时偷偷消耗额度。</p>
      </section>

      <section className="editor-control-section" aria-labelledby="editor-adjust-title">
        <div className="editor-section-heading">
          <div>
            <p className="eyebrow">NON-DESTRUCTIVE ADJUST</p>
            <h2 id="editor-adjust-title">当前图层调整</h2>
          </div>
          <span className="editor-active-layer">{selectedLayer?.name || "未选择"}</span>
        </div>
        {isAdjustmentLayer ? ADJUSTMENTS.map((adjustment) => (
          <label className="editor-slider-row" key={adjustment.key}>
            <span>{adjustment.label}</span>
            <input
              type="range"
              min={adjustment.min}
              max={adjustment.max}
              value={values?.[adjustment.key] ?? 0}
              aria-label={adjustment.label}
              onChange={(event) => onAdjustmentChange(adjustment.key, Number(event.target.value))}
            />
            <output>{values?.[adjustment.key] ?? 0}</output>
          </label>
        )) : <p className="editor-control-note">请选择一个可调整图层；原图层始终锁定并保持不变。</p>}
        {lastChange && <p className="editor-change-note">{lastChange}</p>}
      </section>

      <section className="editor-action-section" aria-label="编辑操作">
        <button type="button" className="secondary-button" disabled={lastChange === null} onClick={onUndo}>撤回上一笔</button>
        <button type="button" className="secondary-button" onClick={onRestore}>恢复原图</button>
        <div className="editor-cloud-action">
          <button type="button" className="primary-button editor-cloud-button" disabled={!remoteAiAvailable || remoteAiBusy} onClick={onRunRemoteAi}>
            {remoteAiBusy ? "正在执行云端 AI…" : "执行云端 AI 修图"}
          </button>
          <small>{remoteAiAvailable ? "只提交当前显示的局部 AI 图层" : "先加入面部、发丝或服装等 AI 图层"}</small>
        </div>
        <div className="editor-export-actions">
          <button type="button" className="primary-button" onClick={onExportPsd}>导出 PSD</button>
          <button type="button" className="secondary-button" onClick={onExportJpg}>导出 JPG</button>
          <button type="button" className="secondary-button" onClick={onSaveProject}>保存项目 JSON</button>
          <button type="button" className="secondary-button" onClick={onImportProject}>导入项目 JSON</button>
        </div>
      </section>
    </aside>
  );
}
