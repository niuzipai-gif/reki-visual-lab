import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BottomDock } from "./components/BottomDock.jsx";
import { BottomSheet } from "./components/BottomSheet.jsx";
import { GlassPanel } from "./components/GlassPanel.jsx";
import { StatusBar } from "./components/StatusBar.jsx";
import { TopBar } from "./components/TopBar.jsx";
import { createAnnotation, createProject } from "./domain/project.js";
import { createEditorState, editorReducer } from "./domain/reducer.js";
import { AiScanPanel } from "./features/ai/AiScanPanel.jsx";
import {
  scanImage,
  supportsInterruptibleLandmarkScan,
} from "./features/ai/landmarkModel.js";
import { EditorCanvas } from "./features/canvas/EditorCanvas.jsx";
import { ExportDialog } from "./features/export/ExportDialog.jsx";
import { FilterPanel } from "./features/filters/FilterPanel.jsx";
import { DEFAULT_FILTER_SETTINGS } from "./features/filters/filterPipeline.js";
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

function drawableImageSource(image) {
  if (!image || image.demo || typeof image === "string") return null;
  const wrapped = image.source ?? image.element ?? image.bitmap ?? image.image;
  if (wrapped && typeof wrapped !== "string") return wrapped;
  if (
    !image.url &&
    Number.isFinite(image.width) &&
    Number.isFinite(image.height)
  ) {
    return image;
  }
  return null;
}

export function Workbench({
  initialDemoProject = globalThis.location?.search.includes("demo=1") ?? false,
  scanLandmarks = scanImage,
  onProjectChange,
  onReplacePhoto,
  saveStatus = "idle",
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
  const [exportBusy, setExportBusy] = useState(false);
  const [filterPreview, setFilterPreview] = useState(null);
  const [aiImageSource, setAiImageSource] = useState(() =>
    drawableImageSource(initialProject?.image),
  );
  const presetSeed = useRef(40);
  const initializedSelection = useRef(false);
  const exportCloseRef = useRef(null);
  const lastNotifiedProject = useRef(state.present);
  const replaceInputRef = useRef(null);
  const [replaceFeedback, setReplaceFeedback] = useState(null);

  useEffect(() => {
    if (lastNotifiedProject.current === state.present) return;
    lastNotifiedProject.current = state.present;
    onProjectChange?.(state.present);
  }, [onProjectChange, state.present]);

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
    setAiImageSource(drawableImageSource(state.present.image));
  }, [state.present.image]);

  useEffect(() => {
    if (!exportOpen) return undefined;
    const previouslyFocused = document.activeElement;
    const close = () => setExportOpen(false);
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !exportBusy) close();
    };

    document.addEventListener("keydown", handleKeyDown);
    exportCloseRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };
  }, [exportBusy, exportOpen]);

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
  const visibleFilters = filterPreview ?? state.present.filters;
  const previewFilters = (patch) => {
    setFilterPreview((current) => ({
      ...(current ?? state.present.filters),
      ...patch,
    }));
  };
  const commitFilters = (patch) => {
    const filters = {
      ...(filterPreview ?? state.present.filters),
      ...patch,
    };
    setFilterPreview(null);
    dispatch({ type: "filters/update", patch: filters });
  };
  const filterPanel = (
    <FilterPanel
      settings={visibleFilters}
      onPreview={previewFilters}
      onCommit={commitFilters}
      onReset={() => {
        setFilterPreview(null);
        dispatch({
          type: "filters/reset",
          filters: DEFAULT_FILTER_SETTINGS,
        });
      }}
    />
  );

  const applyPreset = (preset) => {
    setFilterPreview(null);
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

  const hasAiResults = state.present.layers.some(
    ({ source }) => source === "ai",
  );
  const createAiPanel = () => (
    <AiScanPanel
      imageSource={aiImageSource}
      hasResults={hasAiResults}
      scan={scanLandmarks}
      interruptible={
        scanLandmarks !== scanImage || supportsInterruptibleLandmarkScan()
      }
      onAddLayers={(layers) =>
        dispatch({
          type: "layers/addMany",
          layers,
          selectedLayerId: layers[0]?.id ?? null,
        })
      }
      onClearResults={() =>
        dispatch({ type: "layers/removeBySource", source: "ai" })
      }
    />
  );

  const specialSheet = ["tools", "presets", "ai", "filter"].includes(mobileSheet)
    ? {
        title: {
          tools: "工具",
          presets: "预设",
          ai: "AI 扫描",
          filter: "底图效果",
        }[mobileSheet],
        content:
          mobileSheet === "tools" ? (
            <div className="mobile-tool-grid">
              {TOOL_DEFINITIONS.map((tool) => (
                <button key={tool.id} type="button" aria-pressed={activeTool === tool.id} onClick={() => {
                  setActiveTool(tool.id);
                  setMobileSheet(tool.id === "filter" ? "filter" : null);
                }}>
                  {tool.label}
                </button>
              ))}
            </div>
          ) : mobileSheet === "presets" ? (
            <PresetStrip activePreset={activePreset} onApply={(preset) => { applyPreset(preset); setMobileSheet(null); }} />
          ) : mobileSheet === "filter" ? (
            filterPanel
          ) : (
            createAiPanel()
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
        onUndo={() => {
          setFilterPreview(null);
          dispatch({ type: "history/undo" });
        }}
        onRedo={() => {
          setFilterPreview(null);
          dispatch({ type: "history/redo" });
        }}
        onToggleBackground={() => dispatch({ type: "canvas/update", patch: { backgroundVisible: !state.present.canvas.backgroundVisible } })}
        onExport={() => setExportOpen(true)}
      />
      <ToolRail
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        onAiScan={() => {
          setActiveTool("ai");
          setMobileSheet(null);
        }}
      />
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
            project={{ ...state.present, filters: visibleFilters }}
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
            onImageSourceReady={setAiImageSource}
          />
          {!state.present.image ? (
            <div className="missing-source-panel" role="status">
              <b>原始照片缺失</b>
              <span>标注已保留。添加原照片或选择替代照片即可继续。</span>
              <input
                ref={replaceInputRef}
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="添加或替换照片"
                onChange={async (event) => {
                  const [file] = event.target.files ?? [];
                  event.target.value = "";
                  if (!file || !onReplacePhoto) return;
                  setReplaceFeedback("正在读取照片…");
                  try {
                    const nextProject = await onReplacePhoto(file);
                    if (nextProject) {
                      dispatch({ type: "project/load", project: nextProject });
                      setReplaceFeedback("照片已恢复");
                    }
                  } catch (error) {
                    setReplaceFeedback(
                      error instanceof Error
                        ? error.message
                        : "无法读取这张图片",
                    );
                  }
                }}
              />
              <button
                type="button"
                className="primary-button"
                onClick={() => replaceInputRef.current?.click()}
              >
                添加或替换照片
              </button>
              {replaceFeedback ? <small>{replaceFeedback}</small> : null}
            </div>
          ) : null}
        </div>
        <GlassPanel className="desktop-inspector" aria-label="高级检查器">
          {activeTool === "ai" && mobileSheet !== "ai"
            ? createAiPanel()
            : activeTool === "filter"
              ? filterPanel
              : inspector}
        </GlassPanel>
        <GlassPanel className="desktop-layers" aria-label="图层">{layersPanel}</GlassPanel>
      </section>
      <StatusBar zoom={zoom} grid={grid} canvas={state.present.canvas} saveStatus={saveStatus} onZoomChange={setZoom} onToggleGrid={() => setGrid((value) => !value)} />
      <BottomDock
        activeSheet={mobileSheet}
        onOpen={(sheet) => setMobileSheet(sheet)}
        onExport={() => setExportOpen(true)}
      />
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
        <ExportDialog
          project={state.present}
          closeButtonRef={exportCloseRef}
          onBusyChange={setExportBusy}
          onClose={() => { if (!exportBusy) setExportOpen(false); }}
        />
      ) : null}
    </main>
  );
}

export default Workbench;
