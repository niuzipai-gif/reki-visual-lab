import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BottomDock } from "./components/BottomDock.jsx";
import { BottomSheet } from "./components/BottomSheet.jsx";
import { GlassPanel } from "./components/GlassPanel.jsx";
import { StatusBar } from "./components/StatusBar.jsx";
import { TopBar } from "./components/TopBar.jsx";
import { createAnnotation, createProject } from "./domain/project.js";
import { createEditorState, editorReducer } from "./domain/reducer.js";
import { AiScanPanel } from "./features/ai/AiScanPanel.jsx";
import { AiStylePanel } from "./features/ai/AiStylePanel.jsx";
import {
  scanImage,
  supportsInterruptibleLandmarkScan,
} from "./features/ai/landmarkModel.js";
import { EditorCanvas } from "./features/canvas/EditorCanvas.jsx";
import { OriginalComparisonPane } from "./features/canvas/OriginalComparisonPane.jsx";
import { ExportDialog } from "./features/export/ExportDialog.jsx";
import { FilterPanel } from "./features/filters/FilterPanel.jsx";
import { MotionPanel } from "./features/motion/MotionPanel.jsx";
import { Inspector } from "./features/tools/Inspector.jsx";
import { LayersPanel } from "./features/tools/LayersPanel.jsx";
import { PresetStrip } from "./features/tools/PresetStrip.jsx";
import { ToolRail } from "./features/tools/ToolRail.jsx";
import { TOOL_DEFINITIONS } from "./features/tools/toolDefinitions.js";
import { useResizablePanels } from "./hooks/useResizablePanels.js";
import { publicAsset } from "./publicAsset.js";

const PREVIEW_FRAME_INTERVAL_MS = 1000 / 30;
const MOBILE_BREAKPOINT_QUERY = "(max-width: 759px)";

function initialWorkbenchZoom() {
  return globalThis.matchMedia?.(MOBILE_BREAKPOINT_QUERY).matches ? 100 : 72;
}

const StableTopBar = React.memo(TopBar, (previous, next) => (
  previous.canUndo === next.canUndo &&
  previous.canRedo === next.canRedo &&
  previous.comparisonVisible === next.comparisonVisible &&
  previous.canCompare === next.canCompare &&
  previous.canvas === next.canvas
));
const StableToolRail = React.memo(
  ToolRail,
  (previous, next) => previous.activeTool === next.activeTool,
);
const StablePresetStrip = React.memo(
  PresetStrip,
  (previous, next) => previous.activePreset === next.activePreset,
);
const StableFilterPanel = React.memo(
  FilterPanel,
  (previous, next) => previous.effects === next.effects,
);
const StableLayersPanel = React.memo(LayersPanel, (previous, next) => (
  previous.layers === next.layers &&
  previous.selectedLayerId === next.selectedLayerId
));
const StableInspector = React.memo(
  Inspector,
  (previous, next) => (
    previous.layer === next.layer &&
    previous.layerList === next.layerList
  ),
);
const StableStatusBar = React.memo(StatusBar, (previous, next) => (
  previous.zoom === next.zoom &&
  previous.grid === next.grid &&
  previous.canvas === next.canvas &&
  previous.saveStatus === next.saveStatus
));
const StableBottomDock = React.memo(BottomDock, (previous, next) => (
  previous.activeSheet === next.activeSheet &&
  previous.activeTool === next.activeTool &&
  previous.canCompare === next.canCompare &&
  previous.comparisonVisible === next.comparisonVisible
));

export function createDemoProject() {
  const project = createProject({ width: 1080, height: 1350 });
  return {
    ...project,
    id: "reki-demo",
    name: "银黄实验 04",
    image: { demo: true },
    filters: {},
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
  const [zoom, setZoom] = useState(initialWorkbenchZoom);
  const [grid, setGrid] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [motionPlaying, setMotionPlaying] = useState(false);
  const [motionTimeMs, setMotionTimeMs] = useState(0);
  const [motionClockEpoch, setMotionClockEpoch] = useState(0);
  const [comparisonVisible, setComparisonVisible] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
  );
  const [aiImageSource, setAiImageSource] = useState(() =>
    drawableImageSource(initialProject?.image),
  );
  const [aiImageAnalysis, setAiImageAnalysis] = useState(null);
  const presetSeed = useRef(40);
  const initializedSelection = useRef(false);
  const exportCloseRef = useRef(null);
  const lastNotifiedProject = useRef(state.present);
  const replaceInputRef = useRef(null);
  const motionTimeRef = useRef(0);
  const lastMotionPublishRef = useRef(Number.NEGATIVE_INFINITY);
  const [replaceFeedback, setReplaceFeedback] = useState(null);
  const timelineDurationMs = state.present.motion?.durationMs ?? 4000;
  const {
    desktopWidth,
    sheetHeight,
    desktopSeparatorProps,
    sheetSeparatorProps,
  } = useResizablePanels();

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
    setAiImageAnalysis(null);
  }, [state.present.image]);

  useEffect(() => {
    const media = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return undefined;
    const syncPreference = () => setPrefersReducedMotion(Boolean(media.matches));
    syncPreference();
    media.addEventListener?.("change", syncPreference);
    return () => media.removeEventListener?.("change", syncPreference);
  }, []);

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

  useEffect(() => {
    if (!motionPlaying || typeof requestAnimationFrame !== "function") {
      return undefined;
    }

    const startedAt = performance.now() - motionTimeRef.current;
    let frameId = null;
    const tick = (now) => {
      const next = (now - startedAt) % timelineDurationMs;
      motionTimeRef.current = next;
      if (now - lastMotionPublishRef.current >= PREVIEW_FRAME_INTERVAL_MS) {
        lastMotionPublishRef.current = now;
        setMotionTimeMs(next);
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [motionClockEpoch, motionPlaying, timelineDurationMs]);

  const selectedLayer = state.present.layers.find(
    ({ id }) => id === state.selectedLayerId,
  ) ?? null;
  const activePreset = state.present.layers.findLast(
    ({ presetId }) => presetId,
  )?.presetId ?? null;

  const updateSelected = (patch) => {
    if (selectedLayer) dispatch({ type: "layer/update", id: selectedLayer.id, patch });
  };

  const setPreviewTime = (timeMs, durationMs = timelineDurationMs) => {
    const next = Math.max(0, Math.min(durationMs, Number(timeMs) || 0));
    motionTimeRef.current = next;
    setMotionTimeMs(next);
  };

  const updateSelectedAnimation = (animation) => {
    if (!selectedLayer) return;
    dispatch({ type: "layer/animation", id: selectedLayer.id, animation });
    if (animation.type !== "none" && !prefersReducedMotion) setMotionPlaying(true);
  };

  const restartMotionPreview = () => {
    setPreviewTime(0);
    setMotionClockEpoch((epoch) => epoch + 1);
  };

  const updateTimelineDuration = (durationMs) => {
    const duration = Math.max(1000, Math.min(10000, Math.round(Number(durationMs) || 4000)));
    dispatch({ type: "motion/update", patch: { durationMs: duration } });
    setPreviewTime(motionTimeRef.current, duration);
    setMotionClockEpoch((epoch) => epoch + 1);
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
  const handleImageSourceReady = useCallback((source, analysis) => {
    setAiImageSource(source);
    setAiImageAnalysis(analysis ?? null);
  }, []);

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

  const handleFragmentEffectAction = (operation, effect, patch) => {
    if (selectedLayer?.type !== "extractedFragment") return;
    dispatch({
      type: "fragment/effects",
      id: selectedLayer.id,
      operation,
      effect,
      patch: operation === "move" ? undefined : patch,
      toIndex: operation === "move" ? patch : undefined,
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

  const clearAllLayers = () => {
    if (!state.present.layers.length) return;
    if (!window.confirm("确定清除全部图层吗？此操作可通过撤销恢复。")) return;
    dispatch({ type: "layers/clear" });
  };

  const layersPanel = (
    <StableLayersPanel
      layers={state.present.layers}
      selectedLayerId={state.selectedLayerId}
      onSelect={(id) => dispatch({ type: "selection/set", id })}
      onAction={handleLayerAction}
      onClearAll={clearAllLayers}
    />
  );
  const inspector = (
    <div className="inspector-motion-stack">
      <StableInspector
        layer={selectedLayer}
        layerList={state.present.layers}
        onPatch={updateSelected}
        onBatchLabel={batchLabel}
        onApplyStyle={applyStyle}
        onExtract={() => {
          if (selectedLayer) {
            dispatch({ type: "fragment/create", markerId: selectedLayer.id });
          }
        }}
        onRelink={() => {
          if (selectedLayer?.type === "extractedFragment") {
            dispatch({
              type: "fragment/update",
              id: selectedLayer.id,
              patch: { linkedToMarker: true },
            });
          }
        }}
        onFragmentEffectAction={handleFragmentEffectAction}
        onDelete={() => selectedLayer && dispatch({ type: "layer/remove", id: selectedLayer.id })}
      />
      {selectedLayer ? (
        <MotionPanel
          layer={selectedLayer}
          playing={motionPlaying}
          timeMs={motionTimeMs}
          timelineDurationMs={timelineDurationMs}
          onChange={updateSelectedAnimation}
          onPlayChange={setMotionPlaying}
          onRestart={restartMotionPreview}
          onTimelineDurationChange={updateTimelineDuration}
          onTimelineChange={(timeMs) => {
            setMotionPlaying(false);
            setPreviewTime(timeMs);
          }}
        />
      ) : null}
    </div>
  );
  const handleEffectAction = (action, id, patch) => {
    if (action === "add") dispatch({ type: "effects/add", effect: id });
    if (action === "update") dispatch({ type: "effects/update", id, patch });
    if (action === "remove") dispatch({ type: "effects/remove", id });
    if (action === "move") dispatch({ type: "effects/move", id, toIndex: patch });
    if (action === "reset") dispatch({ type: "effects/reset", effects: [] });
  };
  const filterPanel = (
    <StableFilterPanel
      effects={state.present.effectStack}
      onAction={handleEffectAction}
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

  const hasAiResults = state.present.layers.some(
    ({ source }) => source === "ai",
  );
  const createAiPanel = () => (
    <div className="ai-panels-stack">
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
      <AiStylePanel
        imageSource={aiImageSource}
        analysisSource={aiImageAnalysis ?? aiImageSource}
        dispatch={dispatch}
      />
    </div>
  );

  const specialSheet = ["tools", "ai", "filter"].includes(mobileSheet)
    ? {
        compact: mobileSheet === "tools",
        title: {
          tools: "工具",
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
          ) : mobileSheet === "filter" ? (
            filterPanel
          ) : (
            createAiPanel()
          ),
      }
    : null;

  return (
    <main className="workbench-shell" role="region" aria-label="编辑工作台">
      <StableTopBar
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        comparisonVisible={comparisonVisible}
        canCompare={Boolean(state.present.image)}
        canvas={state.present.canvas}
        onUndo={() => {
          dispatch({ type: "history/undo" });
        }}
        onRedo={() => {
          dispatch({ type: "history/redo" });
        }}
        onToggleBackground={() => {
          setComparisonVisible((visible) => !visible);
        }}
        onExport={() => setExportOpen(true)}
      />
      <StableToolRail
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        onAiScan={() => {
          setActiveTool("ai");
          setMobileSheet(null);
        }}
      />
      <StablePresetStrip activePreset={activePreset} onApply={applyPreset} />
      <section
        className={`canvas-workspace${grid ? " grid-visible" : ""}`}
        aria-label="画布工作区"
        style={{ "--reki-panel-preference": `${desktopWidth}px` }}
      >
        <img
          className="canvas-brand-mark"
          src={publicAsset("brand/reki-character-mark.png")}
          alt=""
          aria-hidden="true"
        />
        <div className={`canvas-comparison-layout${comparisonVisible ? " is-comparing" : ""}`}>
          <div className={`canvas-stage-wrap${state.present.image?.demo ? " demo-canvas" : ""}`}>
            <EditorCanvas
              project={state.present}
              selectedLayerId={state.selectedLayerId}
              activeTool={activeTool}
              zoom={zoom}
              grid={grid}
              animationTimeMs={motionTimeMs}
              onSelectLayer={(id) => dispatch({ type: "selection/set", id })}
              onCreateLayer={(layer) => {
                dispatch({ type: "layer/add", layer });
                dispatch({ type: "selection/set", id: layer.id });
              }}
              onChangeLayer={(id, patch) => dispatch({ type: "layer/update", id, patch })}
              onImageSourceReady={handleImageSourceReady}
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
          {comparisonVisible ? (
            <OriginalComparisonPane
              image={state.present.image}
              canvasSize={state.present.canvas}
              zoom={zoom}
              hidden={!comparisonVisible}
            />
          ) : null}
        </div>
        <div className="desktop-panel-resizer" {...desktopSeparatorProps} />
        <GlassPanel className="desktop-inspector" aria-label="高级检查器">
          {activeTool === "ai" && mobileSheet !== "ai"
            ? createAiPanel()
            : activeTool === "filter"
              ? filterPanel
              : inspector}
        </GlassPanel>
        <GlassPanel className="desktop-layers" aria-label="图层">{layersPanel}</GlassPanel>
      </section>
      <StableStatusBar zoom={zoom} grid={grid} canvas={state.present.canvas} saveStatus={saveStatus} onZoomChange={setZoom} onToggleGrid={() => setGrid((value) => !value)} />
      <StableBottomDock
        activeSheet={mobileSheet}
        activeTool={activeTool}
        canCompare={Boolean(state.present.image)}
        comparisonVisible={comparisonVisible}
        onOpen={(sheet) => setMobileSheet(sheet)}
        onSelect={() => {
          setActiveTool("select");
          setMobileSheet(null);
        }}
        onExport={() => setExportOpen(true)}
        onToggleComparison={() => setComparisonVisible((visible) => !visible)}
      />
      <BottomSheet
        tab={mobileSheet}
        onTabChange={setMobileSheet}
        onClose={() => setMobileSheet(null)}
        inspector={inspector}
        layers={layersPanel}
        specialTitle={specialSheet?.title}
        specialContent={specialSheet?.content}
        compact={specialSheet?.compact}
        height={sheetHeight}
        resizeHandleProps={sheetSeparatorProps}
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
