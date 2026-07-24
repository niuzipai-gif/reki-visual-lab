# Reki Motion Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every base-image effect visible and controllable, animate individual annotation layers, provide resizable editing panes, and export static images, short videos, GIFs, or a Live Photo conversion bundle locally.

**Architecture:** Migrate the legacy `project.filters` object into a serializable `project.effectStack` of named, visible, opacity-aware effect layers. Use one pure animation runtime in both Konva preview and canvas frame rendering so the exported result matches the editor. Render motion locally in deterministic 24fps frames, using WebCodecs + `mp4-muxer` where supported and MediaRecorder WebM otherwise; package a JPEG cover plus the generated video with `fflate`.

**Tech Stack:** React 19, react-konva, Canvas/OffscreenCanvas, WebCodecs, MediaRecorder, `mp4-muxer`, `gifenc`, `fflate`, Vitest, Testing Library.

---

## File structure

- `src/features/filters/effectStack.js` — migration, effect-layer sanitization, compositing and compatibility projection.
- `src/features/filters/effectStack.test.js` — deterministic compositing/order/opacity/migration tests.
- `src/features/filters/EffectStackPanel.jsx` — named effect cards and accessible controls.
- `src/features/filters/EffectStackPanel.test.jsx` — user controls, visibility, opacity and deletion tests.
- `src/features/motion/animationRuntime.js` — pure time-to-transform contract shared by preview and export.
- `src/features/motion/animationRuntime.test.js` — time, loop, delay and edge-case tests.
- `src/features/motion/MotionPanel.jsx` — selected-layer animation controls and global timeline.
- `src/features/motion/MotionPanel.test.jsx` — panel interaction tests.
- `src/features/motion/motionRenderer.js` — frame stepping, codec selection, GIF/video/bundle generation.
- `src/features/motion/motionRenderer.test.js` — frame plan, capability selection, cancellation and package tests.
- `src/features/layout/useResizablePanels.js` — bounded persisted desktop/mobile layout preference hook.
- `src/features/layout/useResizablePanels.test.js` — bounds/persistence tests.
- `src/domain/project.js`, `src/domain/reducer.js` — project defaults, migration and history-safe actions.
- `src/features/canvas/AnnotationNode.jsx`, `src/features/canvas/EditorCanvas.jsx`, `src/features/canvas/BackgroundLayer.jsx` — preview render with effect stack and animation transform.
- `src/features/export/exportImage.js`, `src/features/export/ExportDialog.jsx` — static frame renderer and unified image/motion output flow.
- `src/Workbench.jsx`, `src/styles.css`, `package.json` — integration, resizable panes, dependencies and responsive styling.

### Task 1: Effect-stack domain model and legacy migration

**Files:**
- Create: `src/features/filters/effectStack.js`
- Test: `src/features/filters/effectStack.test.js`
- Modify: `src/domain/project.js`
- Modify: `src/domain/reducer.js`
- Modify: `src/domain/project.test.js`
- Modify: `src/domain/reducer.test.js`

- [ ] **Step 1: Write failing migration and opacity tests**

```js
it("migrates legacy filters into named enabled effect layers", () => {
  const project = normalizeProject({ ...createProject(), filters: { grain: 0.5, rgbOffset: 8 } });
  expect(project.effectStack.map(({ type, visible }) => [type, visible]))
    .toEqual([["grain", true], ["rgbOffset", true]]);
});

it("blends one effect by its opacity and leaves disabled effects untouched", () => {
  const output = applyEffectStack(pixel([100, 100, 100, 255]), [
    effect("threshold", { threshold: 128, opacity: 0.5 }),
    effect("grain", { grain: 1, visible: false }),
  ]);
  expect(Array.from(output.data.slice(0, 3))).toEqual([178, 178, 178]);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm test -- --run src/features/filters/effectStack.test.js src/domain/project.test.js`

Expected: FAIL because `normalizeProject`, `effect`, and `applyEffectStack` do not exist.

- [ ] **Step 3: Implement serializable effects and project normalization**

```js
export const EFFECT_TYPES = ["threshold", "halftone", "grain", "rgbOffset", "scanline", "duotone"];

export function effect(type, settings = {}) {
  return {
    id: settings.id ?? crypto.randomUUID(), type,
    name: EFFECT_LABELS[type], visible: settings.visible !== false,
    opacity: clamp(settings.opacity ?? 1, 0, 1), settings: pickSettings(type, settings),
  };
}

export function normalizeProject(project) {
  const effectStack = Array.isArray(project.effectStack)
    ? project.effectStack.map(sanitizeEffect).filter(Boolean)
    : legacyFiltersToEffects(project.filters);
  return { ...project, version: 2, effectStack, filters: {} };
}
```

Apply each active effect to a copied `ImageData`, alpha-mix it with the prior buffer according to the effect-layer opacity, and keep the existing pixel algorithms as the source of truth.

- [ ] **Step 4: Add reducer actions with one undo entry per user mutation**

```js
case "effects/add": return commit(state, { ...state.present, effectStack: [...state.present.effectStack, action.effect] });
case "effects/update": return updateEffect(state, action.id, action.patch);
case "effects/remove": return removeEffect(state, action.id);
case "effects/move": return moveEffect(state, action.id, action.toIndex);
case "effects/reset": return commit(state, { ...state.present, effectStack: [] });
case "project/load": return createEditorState(normalizeProject(action.project));
```

Update `preset/apply` and `style/apply` to convert incoming legacy filter patches into explicit effects instead of mutating a hidden global filter object.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- --run src/features/filters/effectStack.test.js src/domain/project.test.js src/domain/reducer.test.js`

Expected: PASS.

```bash
git add src/domain/project.js src/domain/project.test.js src/domain/reducer.js src/domain/reducer.test.js src/features/filters/effectStack.js src/features/filters/effectStack.test.js
git commit -m "feat: add non-destructive effect stack"
```

### Task 2: Effect-stack panel and unified preview/export pipeline

**Files:**
- Create: `src/features/filters/EffectStackPanel.jsx`
- Test: `src/features/filters/EffectStackPanel.test.jsx`
- Modify: `src/features/filters/FilterPanel.jsx`
- Modify: `src/features/canvas/BackgroundLayer.jsx`
- Modify: `src/features/canvas/BackgroundLayer.test.jsx`
- Modify: `src/features/export/exportImage.js`
- Modify: `src/features/export/exportImage.test.js`
- Modify: `src/Workbench.jsx`

- [ ] **Step 1: Write failing UI and parity tests**

```jsx
it("lets a user hide, fade and delete a named effect", async () => {
  render(<EffectStackPanel effects={[effect("rgbOffset", { id: "rgb", opacity: 1 })]} onAction={onAction} />);
  await user.click(screen.getByRole("button", { name: "隐藏 RGB 偏移" }));
  await user.clear(screen.getByLabelText("RGB 偏移透明度"));
  await user.type(screen.getByLabelText("RGB 偏移透明度"), "35");
  await user.click(screen.getByRole("button", { name: "删除 RGB 偏移" }));
  expect(onAction.mock.calls.map(([action]) => action)).toEqual(["toggle", "opacity", "remove"]);
});

it("uses the same effect stack when rendering a static export", async () => {
  const blob = await renderProjectToBlob({ project: projectWithEffects, sourceBitmap });
  expect(await readPixel(blob)).toEqual(previewPixel);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/features/filters/EffectStackPanel.test.jsx src/features/canvas/BackgroundLayer.test.jsx src/features/export/exportImage.test.js`

Expected: FAIL because `EffectStackPanel` and `effectStack` render support are absent.

- [ ] **Step 3: Render named effect cards and preserve the old editor affordances**

Each card has a visible label, eye toggle, 0–100% opacity slider, settings disclosure, move up/down controls, delete button, and an accessible `aria-label` derived from the effect name. `FilterPanel` becomes an “add effect” palette plus settings editor for the selected effect; it no longer writes hidden global filters.

- [ ] **Step 4: Replace legacy filter calls with `applyEffectStack`**

```js
const activeEffects = showOriginal ? [] : project.effectStack;
const output = applyEffectStack(context.getImageData(0, 0, width, height), activeEffects);
context.putImageData(output, 0, 0);
```

Use this in both `BackgroundLayer` and `renderProjectToBlob`; original-image comparison always supplies an empty stack.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- --run src/features/filters/EffectStackPanel.test.jsx src/features/canvas/BackgroundLayer.test.jsx src/features/export/exportImage.test.js`

Expected: PASS.

```bash
git add src/features/filters src/features/canvas/BackgroundLayer.jsx src/features/canvas/BackgroundLayer.test.jsx src/features/export/exportImage.js src/features/export/exportImage.test.js src/Workbench.jsx
git commit -m "feat: expose controllable effect layers"
```

### Task 3: Resizable inspector and layer work areas

**Files:**
- Create: `src/features/layout/useResizablePanels.js`
- Test: `src/features/layout/useResizablePanels.test.js`
- Modify: `src/Workbench.jsx`
- Modify: `src/components/BottomSheet.jsx`
- Modify: `src/styles.css`
- Test: `src/components/Workbench.test.jsx`

- [ ] **Step 1: Write failing persistence and bounds tests**

```js
it("clamps desktop panel width and persists a valid value", () => {
  expect(clampPanelSize(80, { min: 240, max: 520 })).toBe(240);
  expect(clampPanelSize(900, { min: 240, max: 520 })).toBe(520);
});
```

```jsx
it("exposes a keyboard-accessible layer-panel resize handle", () => {
  render(<Workbench initialDemoProject />);
  expect(screen.getByRole("separator", { name: "调整图层区域宽度" })).toBeVisible();
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/features/layout/useResizablePanels.test.js src/components/Workbench.test.jsx`

Expected: FAIL because the hook and resize separator do not exist.

- [ ] **Step 3: Implement pointer and keyboard resize behavior**

```js
export function useResizablePanels({ storageKey, initial, min, max }) {
  const [size, setSize] = useState(() => clamp(readNumber(storageKey, initial), min, max));
  const update = useCallback((next) => setSize(clamp(next, min, max)), [min, max]);
  useEffect(() => localStorage.setItem(storageKey, String(size)), [size, storageKey]);
  return { size, update, onKeyDown: (event) => keyboardResize(event, size, update, min, max) };
}
```

Desktop uses a `role="separator"` handle between canvas and the right dock. Mobile exposes a vertical handle that clamps the bottom sheet to 38–82vh. Do not persist a value until it is clamped.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm test -- --run src/features/layout/useResizablePanels.test.js src/components/Workbench.test.jsx`

Expected: PASS.

```bash
git add src/features/layout src/Workbench.jsx src/components/BottomSheet.jsx src/components/Workbench.test.jsx src/styles.css
git commit -m "feat: make editor panes resizable"
```

### Task 4: Deterministic annotation animation runtime

**Files:**
- Create: `src/features/motion/animationRuntime.js`
- Test: `src/features/motion/animationRuntime.test.js`
- Modify: `src/domain/project.js`
- Modify: `src/domain/reducer.js`
- Modify: `src/domain/reducer.test.js`

- [ ] **Step 1: Write failing transform tests for every declared animation**

```js
it.each(["fade", "draw", "pulse", "glitch", "orbit", "scan"])("returns a bounded transform for %s", (type) => {
  const frame = resolveAnimation({ type, durationMs: 1000, delayMs: 0, loop: true, amplitude: 0.5 }, 500);
  expect(frame.opacity).toBeGreaterThanOrEqual(0);
  expect(frame.opacity).toBeLessThanOrEqual(1);
  expect(Number.isFinite(frame.translateX + frame.translateY + frame.scale + frame.rotation)).toBe(true);
});

it("keeps a non-animated layer visually static", () => {
  expect(resolveAnimation(undefined, 777)).toEqual(DEFAULT_ANIMATION_FRAME);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/features/motion/animationRuntime.test.js src/domain/reducer.test.js`

Expected: FAIL because the runtime and animation property are absent.

- [ ] **Step 3: Implement a pure time-to-frame contract and safe project defaults**

```js
export const DEFAULT_ANIMATION = Object.freeze({ type: "none", durationMs: 900, delayMs: 0, loop: true, amplitude: 0.35, direction: "normal" });
export const DEFAULT_ANIMATION_FRAME = Object.freeze({ opacity: 1, translateX: 0, translateY: 0, scale: 1, rotation: 0, drawProgress: 1, flash: 1 });

export function resolveAnimation(animation, timeMs) {
  const config = sanitizeAnimation(animation);
  if (config.type === "none") return DEFAULT_ANIMATION_FRAME;
  const progress = localProgress(config, timeMs);
  return animationFrameFor(config, progress);
}
```

Add `animation: DEFAULT_ANIMATION` in `createAnnotation`, sanitizer bounds (`durationMs` 200–6000, `delayMs` 0–6000, `amplitude` 0–1), and `layer/animation` reducer action that commits one history item.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm test -- --run src/features/motion/animationRuntime.test.js src/domain/reducer.test.js`

Expected: PASS.

```bash
git add src/features/motion/animationRuntime.js src/features/motion/animationRuntime.test.js src/domain/project.js src/domain/reducer.js src/domain/reducer.test.js
git commit -m "feat: add serializable layer animations"
```

### Task 5: Live motion preview, selected-layer controls and timeline

**Files:**
- Create: `src/features/motion/MotionPanel.jsx`
- Test: `src/features/motion/MotionPanel.test.jsx`
- Modify: `src/features/canvas/AnnotationNode.jsx`
- Modify: `src/features/canvas/EditorCanvas.jsx`
- Modify: `src/features/canvas/EditorCanvas.test.jsx`
- Modify: `src/Workbench.jsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing preview and control tests**

```jsx
it("applies the animation runtime frame to a selected annotation", () => {
  render(<AnnotationNode layer={animatedLayer} canvasSize={size} selected animationTimeMs={250} />);
  expect(screen.getByTestId("annotation-layer")).toHaveAttribute("data-motion", "glitch");
});

it("updates the selected layer animation and pauses the timeline", async () => {
  render(<MotionPanel layer={layer} playing timeMs={120} onChange={onChange} onPlayChange={onPlayChange} />);
  await user.selectOptions(screen.getByLabelText("动画类型"), "pulse");
  await user.click(screen.getByRole("button", { name: "暂停动画预览" }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: "pulse" }));
  expect(onPlayChange).toHaveBeenCalledWith(false);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/features/motion/MotionPanel.test.jsx src/features/canvas/EditorCanvas.test.jsx`

Expected: FAIL because no motion controls or animation time props exist.

- [ ] **Step 3: Apply runtime frame consistently to shapes and labels**

`AnnotationNode` receives `animationTimeMs`, resolves the frame once, nests all visible geometry in a transformed Konva group, multiplies the layer’s own `style.opacity` by frame opacity, and uses `drawProgress` to clip paths. For `glitch`, render two non-interactive color-offset ghost groups plus the primary group; they never create duplicate hit targets.

- [ ] **Step 4: Add MotionPanel to the inspector and stable requestAnimationFrame clock**

The clock resets only when the user presses restart; it stops updating when paused and cleans up its animation frame on unmount. The inspector shows the panel for every selected layer, including AI/preset-generated layers, and sends `{ type: "layer/animation", id, animation }` to the reducer.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- --run src/features/motion/MotionPanel.test.jsx src/features/canvas/EditorCanvas.test.jsx src/components/Workbench.test.jsx`

Expected: PASS.

```bash
git add src/features/motion/MotionPanel.jsx src/features/motion/MotionPanel.test.jsx src/features/canvas/AnnotationNode.jsx src/features/canvas/EditorCanvas.jsx src/features/canvas/EditorCanvas.test.jsx src/Workbench.jsx src/styles.css
git commit -m "feat: preview animated annotation layers"
```

### Task 6: Shared animation frame renderer

**Files:**
- Modify: `src/features/export/exportImage.js`
- Test: `src/features/export/exportImage.test.js`
- Modify: `src/features/motion/animationRuntime.js`

- [ ] **Step 1: Write failing frame-render parity tests**

```js
it("renders an animation frame at a supplied timeline time", async () => {
  const blob = await renderProjectFrameToBlob({ project: animatedProject, sourceBitmap, timeMs: 250, format: "png" });
  expect(await readPixel(blob, 62, 90)).toEqual([229, 72, 77, 255]);
});

it("draw progress hides the un-grown portion of a path", () => {
  expect(clipPoints(pathPoints, 0.5)).toHaveLength(2);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/features/export/exportImage.test.js src/features/motion/animationRuntime.test.js`

Expected: FAIL because `renderProjectFrameToBlob` and frame-aware annotation drawing are absent.

- [ ] **Step 3: Make static rendering a zero-time wrapper around frame rendering**

```js
export async function renderProjectFrameToBlob({ project, sourceBitmap, timeMs = 0, ...options }) {
  const canvas = createCanvas(plan.width, plan.height);
  drawBackgroundWithEffectStack(context, sourceBitmap, plan, project.effectStack);
  for (const layer of project.layers ?? []) drawAnimatedAnnotationToContext(context, layer, project.canvas, scale, timeMs);
  return canvasBlob(canvas, options.format, options.quality);
}

export const renderProjectToBlob = (options) => renderProjectFrameToBlob({ ...options, timeMs: 0 });
```

Use the same `resolveAnimation` and geometry clipping helpers as preview. Preserve transparent-overlay semantics.

- [ ] **Step 4: Run focused tests and commit**

Run: `npm test -- --run src/features/export/exportImage.test.js src/features/motion/animationRuntime.test.js`

Expected: PASS.

```bash
git add src/features/export/exportImage.js src/features/export/exportImage.test.js src/features/motion/animationRuntime.js
git commit -m "feat: render export frames with layer animation"
```

### Task 7: Local video, GIF and Live Photo conversion-bundle renderer

**Files:**
- Create: `src/features/motion/motionRenderer.js`
- Test: `src/features/motion/motionRenderer.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add runtime dependencies and write failing capability tests**

Run: `npm install mp4-muxer gifenc fflate`

```js
it("prefers MP4 only when WebCodecs H.264 is available", async () => {
  await expect(selectVideoEncoder({ VideoEncoder: supportedEncoder, MediaRecorder: supportedRecorder }))
    .resolves.toMatchObject({ container: "mp4", extension: "mp4" });
});

it("falls back to WebM instead of lying about an MP4 extension", async () => {
  await expect(selectVideoEncoder({ MediaRecorder: supportedRecorder })).resolves.toMatchObject({ container: "webm", extension: "webm" });
});

it("returns a cover plus a video in a conversion bundle", async () => {
  const archive = await createLivePhotoBundle({ cover: jpegBlob, video: mp4Blob, videoExtension: "mp4" });
  expect(await unzipNames(archive)).toEqual(["cover.jpg", "motion.mp4", "README.txt"]);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/features/motion/motionRenderer.test.js`

Expected: FAIL because the renderer and encoder selector are absent.

- [ ] **Step 3: Implement bounded, cancelable 720p frame generation**

```js
export const MOTION_PRESET = Object.freeze({ durationMs: 4000, fps: 24, maxEdge: 1280 });

export async function renderMotion({ project, sourceBitmap, kind, signal, onProgress }) {
  const plan = createMotionPlan(project.canvas, MOTION_PRESET);
  for (let frameIndex = 0; frameIndex < plan.frameCount; frameIndex += 1) {
    throwIfAborted(signal);
    const blob = await renderProjectFrameToBlob({ project, sourceBitmap, timeMs: frameIndex * plan.frameDurationMs, scale: plan.scale, format: "png" });
    await encoder.addFrame(blob, frameIndex);
    onProgress?.(frameIndex + 1, plan.frameCount);
  }
  return encoder.finalize();
}
```

Validate H.264 support with `VideoEncoder.isConfigSupported`; write MP4 via `mp4-muxer`. If absent, drive a canvas stream through MediaRecorder and label the file `.webm`. Encode GIF with `gifenc` at a lower maximum edge (640) and show this constraint in the returned metadata. `AbortSignal` must stop the frame loop, close codecs/recorders, and prevent a download.

- [ ] **Step 4: Implement the conversion bundle without claiming native iOS Live Photo**

```js
export async function createLivePhotoBundle({ cover, video, videoExtension }) {
  return zipSync({
    "cover.jpg": new Uint8Array(await cover.arrayBuffer()),
    [`motion.${videoExtension}`]: new Uint8Array(await video.arrayBuffer()),
    "README.txt": strToU8("导入美图秀秀等应用后可转换为 iPhone 实况照片。"),
  });
}
```

Return a `application/zip` Blob named `*-live-photo-materials.zip`; do not use a `.livephoto` extension or claim iOS metadata compatibility.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- --run src/features/motion/motionRenderer.test.js`

Expected: PASS.

```bash
git add package.json package-lock.json src/features/motion/motionRenderer.js src/features/motion/motionRenderer.test.js
git commit -m "feat: render local motion exports"
```

### Task 8: Unified export dialog and end-to-end verification

**Files:**
- Modify: `src/features/export/ExportDialog.jsx`
- Modify: `src/features/export/ExportDialog.test.jsx`
- Modify: `src/Workbench.jsx`
- Modify: `src/styles.css`
- Modify: `tests/competitor-parity.test.jsx`
- Modify: `README.md`

- [ ] **Step 1: Write failing export-choice tests**

```jsx
it("lets the user choose an image, video, GIF, or live-photo materials", async () => {
  render(<ExportDialog project={animatedProject} />);
  await user.click(screen.getByLabelText("动画视频"));
  expect(screen.getByRole("button", { name: "导出视频" })).toBeEnabled();
  await user.click(screen.getByLabelText("实况素材包"));
  expect(screen.getByText("封面图 + 短视频，可导入美图秀秀转换")).toBeVisible();
});

it("cancels a running animation export without triggering a download", async () => {
  render(<ExportDialog project={animatedProject} motionRenderer={deferredRenderer} />);
  await user.click(screen.getByRole("button", { name: "导出视频" }));
  await user.click(screen.getByRole("button", { name: "取消导出" }));
  expect(deferredRenderer.signal.aborted).toBe(true);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/features/export/ExportDialog.test.jsx tests/competitor-parity.test.jsx`

Expected: FAIL because image-only export has no motion choices or cancellation control.

- [ ] **Step 3: Integrate the choice UI, capability fallback and progress**

The dialog has a first-level `输出类型` radio group: `图片`, `动画视频`, `GIF`, `实况素材包`. Image keeps PNG/JPEG and scale options. Motion shows 4s/24fps/720p metadata, selected container capability, progress, cancel button, and an offline-only privacy note. `downloadBlob` derives extensions only from renderer metadata.

- [ ] **Step 4: Add parity coverage and documentation**

The competitor-parity scenario must import an image, add a marker, set `glitch`, hide an effect, resize the layer area, open export, and select video without console errors. README documents local-only rendering, MP4/WebM fallback, GIF limit, and the fact that the materials ZIP needs a downstream app to create a true iPhone Live Photo.

- [ ] **Step 5: Run full verification and commit**

Run: `npm test -- --run`

Expected: PASS with no test failures.

Run: `npm run build; npm run test:sites; git diff --check`

Expected: all commands exit 0.

```bash
git add src/features/export/ExportDialog.jsx src/features/export/ExportDialog.test.jsx src/Workbench.jsx src/styles.css tests/competitor-parity.test.jsx README.md
git commit -m "feat: offer image and motion export choices"
```

## Final acceptance checklist

- [ ] Existing projects with `filters` load as visible effect cards and retain equivalent visuals.
- [ ] Every effect layer can be toggled, faded, reordered and removed, and static export matches preview.
- [ ] Desktop and mobile panels resize within tested bounds and remain keyboard accessible.
- [ ] Each marker animation previews, pauses and exports deterministically.
- [ ] PNG/JPEG remain available; video chooses MP4 only when supported, WebM otherwise; GIF and material ZIP work or show a clear browser limitation.
- [ ] No image or animation frame is uploaded to AI or any renderer service.
