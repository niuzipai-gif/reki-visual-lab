import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BottomDock } from "./components/BottomDock.jsx";
import { BottomSheet } from "./components/BottomSheet.jsx";
import { GlassPanel } from "./components/GlassPanel.jsx";
import { StatusBar } from "./components/StatusBar.jsx";
import { TopBar } from "./components/TopBar.jsx";
import { createAnnotation, createProject } from "./domain/project.js";
import { createEditorState, editorReducer } from "./domain/reducer.js";
import { EditorCanvas } from "./features/canvas/EditorCanvas.jsx";
import { Inspector } from "./features/tools/Inspector.jsx";
import { LayersPanel } from "./features/tools/LayersPanel.jsx";
import { PresetStrip } from "./features/tools/PresetStrip.jsx";
import { ToolRail } from "./features/tools/ToolRail.jsx";
import { TOOL_DEFINITIONS } from "./features/tools/toolDefinitions.js";

export function createDemoProject() {
  const project = createProject({ width: 1080, height: 1350 });
  return {
    ...project,
    id: "reki-demo",
    name: "银黄实验 04",
    image: { demo: true },
    filters: { saturation: 0.76, contrast: 1.08 },
    layers: [
      createAnnotation("path", [
        { x: 0.2, y: 0.6 },
        { x: 0.42, y: 0.28 },
        { x: 0.68, y: 0.38 },
        { x: 0.78, y: 0.72 },
      ], { id: "demo-path", name: "神经路径", label: "NODE_07" }),
      createAnnotation("orbit", [
        { x: 0.52, y: 0.46 },
        { x: 0.78, y: 0.46 },
      ], { id: "demo-orbit", name: "圣像轨道" }),
      createAnnotation("leader", [
        { x: 0.48, y: 0.36 },
        { x: 0.82, y: 0.26 },
      ], { id: "demo-label", name: "机械标签", label: "label_03 · 0.925", value: 0.925 }),
    ],
  };
}

export function Workbench({
  initialDemoProject = globalThis.location?.search.includes("demo=1") ?? false,
} = {}) {
  const initialProject = useMemo(
    () =>
      initialDemoProject === true
        ? createDemoProject()
        : initialDemoProject || undefined,
    [initialDemoProject],
  );
  const [state, dispatch] = useReducer(
    editorReducer,
    initialProject,
    createEditorState,
  );
  const [activeTool, setActiveTool] = useState("select");
  const [mobileSheet, setMobileSheet] = useState(null);
  const [zoom, setZoom] = useState(72);
  const [grid, setGrid] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const presetSeed = useRef(40);
  const initializedSelection = useRef(false);
  const exportCloseRef = useRef(null);

  useEffect(() => {
    if (
      !initializedSelection.current &&
      initialProject?.layers?.length &&
      state.selectedLayerId === null &&
      state.present.layers.length
    ) {
      initializedSelection.current = true;
      dispatch({ type: "selection/set", id: state.present.layers[0].id });
    }
  }, [initialProject, state.present.layers, state.selectedLayerId]);

  useEffect(() => {
    if (!exportOpen) return undefined;
    const previouslyFocused = document.activeElement;
    const close = () => setExportOpen(false);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("keydown", handleKeyDown);
    exportCloseRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, [exportOpen]);

  if (!state.present.image) return null;

  const selectedLayer = state.present.layers.find(
    ({ id }) => id === state.selectedLayerId,
  ) ?? null;
  const activePreset = state.present.layers.findLast(
    ({ presetId }) => presetId,
  )?.presetId ?? null;

  const updateSelected = (patch) => {
    if (selectedLayer) dispatch({ type: "layer/update", id: selectedLayer.id, patch });
  };

  const applyStyle = (scope) => {
    if (!selectedLayer) return;
    dispatch({
      type: "layers/updateMany",
      updates: state.present.layers
        .filter(
          (layer) =>
            scope === "all" || layer.type === selectedLayer.type,
        )
        .map((layer) => ({
          id: layer.id,
          patch: { style: structuredClone(selectedLayer.style) },
        })),
    });
  };

  const batchLabel = (label) => {
    if (!selectedLayer) return;
    dispatch({
      type: "layers/updateMany",
      updates: state.present.layers
        .filter((layer) => layer.type === selectedLayer.type)
        .map((layer) => ({
          id: layer.id,
          patch: { label },
        })),
    });
  };

  const handleLayerAction = (action, layer, index) => {
    const actions = {
      toggle: { type: "layer/toggle", id: layer.id },
      lock: { type: "layer/lock", id: layer.id },
      duplicate: { type: "layer/duplicate", id: layer.id },
      remove: { type: "layer/remove", id: layer.id },
      top: { type: "layer/move", id: layer.id, toIndex: state.present.layers.length - 1 },
      bottom: { type: "layer/move", id: layer.id, toIndex: 0 },
      up: { type: "layer/move", id: layer.id, toIndex: index + 1 },
      down: { type: "layer/move", id: layer.id, toIndex: index - 1 },
    };
    dispatch(actions[action]);
  };

  const layersPanel = (
    <LayersPanel
      layers={state.present.layers}
      selectedLayerId={state.selectedLayerId}
      onSelect={(id) => dispatch({ type: "selection/set", id })}
      onAction={handleLayerAction}
    />
  );
  const inspector = (
    <Inspector
      layer={selectedLayer}
      onPatch={updateSelected}
      onBatchLabel={batchLabel}
      onApplyStyle={applyStyle}
      onDelete={() => selectedLayer && dispatch({ type: "layer/remove", id: selectedLayer.id })}
    />
  );

  const applyPreset = (preset) => {
    const layers = preset
      .createLayers({ seed: presetSeed.current++ })
      .map((layer) => ({ ...layer, presetId: preset.id }));
    dispatch({
      type: "preset/apply",
      layers,
      filters: preset.filters,
      selectedLayerId: layers[0]?.id ?? null,
    });
  };

  const specialSheet = ["tools", "presets", "ai"].includes(mobileSheet)
    ? {
        title: { tools: "工具", presets: "预设", ai: "AI 扫描" }[mobileSheet],
        content:
          mobileSheet === "tools" ? (
            <div className="mobile-tool-grid">
              {TOOL_DEFINITIONS.map((tool) => (
                <button key={tool.id} type="button" aria-pressed={activeTool === tool.id} onClick={() => { setActiveTool(tool.id); setMobileSheet(null); }}>
                  {tool.label}
                </button>
              ))}
            </div>
          ) : mobileSheet === "presets" ? (
            <PresetStrip activePreset={activePreset} onApply={(preset) => { applyPreset(preset); setMobileSheet(null); }} />
          ) : (
            <p className="pending-copy">AI 模型功能将在后续阶段接入；所有手动标注工具仍可使用。</p>
          ),
      }
    : null;

  return (
    <main className="workbench-shell" role="region" aria-label="编辑工作台">
      <TopBar
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        backgroundVisible={state.present.canvas.backgroundVisible}
        canvas={state.present.canvas}
        onUndo={() => dispatch({ type: "history/undo" })}
        onRedo={() => dispatch({ type: "history/redo" })}
        onToggleBackground={() => dispatch({ type: "canvas/update", patch: { backgroundVisible: !state.present.canvas.backgroundVisible } })}
        onExport={() => setExportOpen(true)}
      />
      <ToolRail activeTool={activeTool} onSelectTool={setActiveTool} onAiScan={() => setMobileSheet("ai")} />
      <PresetStrip activePreset={activePreset} onApply={applyPreset} />
      <section className={`canvas-workspace${grid ? " grid-visible" : ""}`} aria-label="画布工作区">
        <div
          className={`canvas-stage-wrap${
            state.present.image?.demo &&
            state.present.canvas.backgroundVisible
              ? " demo-canvas"
              : ""
          }`}
        >
          <EditorCanvas
            project={state.present}
            selectedLayerId={state.selectedLayerId}
            activeTool={activeTool}
            zoom={zoom}
            grid={grid}
            onSelectLayer={(id) => dispatch({ type: "selection/set", id })}
            onCreateLayer={(layer) => {
              dispatch({ type: "layer/add", layer });
              dispatch({ type: "selection/set", id: layer.id });
            }}
            onChangeLayer={(id, patch) => dispatch({ type: "layer/update", id, patch })}
          />
        </div>
        <GlassPanel className="desktop-inspector" aria-label="高级检查器">{inspector}</GlassPanel>
        <GlassPanel className="desktop-layers" aria-label="图层">{layersPanel}</GlassPanel>
      </section>
      <StatusBar zoom={zoom} grid={grid} canvas={state.present.canvas} onZoomChange={setZoom} onToggleGrid={() => setGrid((value) => !value)} />
      <BottomDock activeSheet={mobileSheet} onOpen={setMobileSheet} onExport={() => setExportOpen(true)} />
      <BottomSheet
        tab={mobileSheet}
        onTabChange={setMobileSheet}
        onClose={() => setMobileSheet(null)}
        inspector={inspector}
        layers={layersPanel}
        specialTitle={specialSheet?.title}
        specialContent={specialSheet?.content}
      />
      {exportOpen ? (
        <div className="pending-dialog-backdrop">
          <GlassPanel role="dialog" aria-modal="true" aria-label="导出设置" className="pending-dialog">
            <h2>导出图片</h2><p>高清导出将在下一阶段接入。当前画布状态已准备好。</p>
            <button ref={exportCloseRef} type="button" aria-label="关闭导出设置" className="primary-button" onClick={() => setExportOpen(false)}>完成</button>
          </GlassPanel>
        </div>
      ) : null}
    </main>
  );
}

export default Workbench;
