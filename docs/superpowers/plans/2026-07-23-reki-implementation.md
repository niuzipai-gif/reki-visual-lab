# Reki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a responsive, browser-local static image editor for cosers that matches every annotation capability shown in the supplied competitor screenshot and video, then adds presets, AI face/hand/pose landmarks, local projects, and high-resolution image export.

**Architecture:** Initialize the Product Design `prototype` template, then keep the React shell thin while domain logic lives in focused modules. A normalized project model and reducer drive Konva-based annotation layers, a Canvas 2D filter/export pipeline handles pixels, MediaPipe adapters produce editable landmarks, and IndexedDB persists projects without accounts or server uploads.

**Tech Stack:** React 19, Vite 6, Vitest, Testing Library, Konva/react-konva, MediaPipe Tasks Vision, IndexedDB via `idb-keyval`, Lucide React, Canvas 2D, CSS, Product Design prototype worker, Sites-compatible build.

---

## Planned file structure

```text
src/
  App.jsx                         # Product shell and route/state orchestration
  main.jsx                        # React entrypoint
  styles.css                      # Global silver-mist/yolk design tokens and responsive shell
  test/setup.js                   # Vitest DOM/canvas/indexedDB setup
  domain/
    project.js                    # Project schema, object factories, migrations
    project.test.js
    reducer.js                    # Editor reducer, undo/redo, layer operations
    reducer.test.js
    geometry.js                   # Paths, curves, bounds, normalized coordinates
    geometry.test.js
  features/import/
    decodeImage.js                # File validation, EXIF-safe browser decode, preview sizing
    decodeImage.test.js
    ImportPanel.jsx
  features/canvas/
    EditorCanvas.jsx              # Konva stage and editable annotation rendering
    AnnotationNode.jsx            # Per-object renderers and selection handles
    useCanvasGestures.js          # Mouse/touch pan and zoom behavior
  features/tools/
    toolDefinitions.js            # Competitor-parity tool registry
    ToolRail.jsx
    PresetStrip.jsx
    Inspector.jsx
    LayersPanel.jsx
    presets.js                    # Reki visual preset definitions
    presets.test.js
  features/filters/
    filterPipeline.js             # Threshold, halftone, grain, chromatic, scanline, duotone
    filterPipeline.test.js
    FilterPanel.jsx
  features/ai/
    landmarkModel.js              # Lazy MediaPipe loading and result normalization
    landmarkModel.test.js
    AiScanPanel.jsx
  features/storage/
    projectStore.js               # IndexedDB autosave/list/load/delete
    projectStore.test.js
    ProjectBrowser.jsx
  features/export/
    exportImage.js                # Full composition and transparent overlay exports
    exportImage.test.js
    ExportDialog.jsx
  components/
    TopBar.jsx
    StatusBar.jsx
    BottomDock.jsx
    BottomSheet.jsx
    GlassPanel.jsx
tests/
  app-smoke.test.jsx              # First-run and editor integration smoke tests
  competitor-parity.test.jsx      # Required controls and flows from reference
```

The protected Product Design hosting files remain unchanged:

```text
.openai/hosting.json
worker/index.js
scripts/prepare-sites-build.mjs
tests/sites-worker.test.mjs
```

### Task 1: Initialize the Product Design prototype and test harness

**Files:**
- Create from template: `package.json`, `package-lock.json`, `vite.config.mjs`, `index.html`, `src/App.jsx`, `src/main.jsx`, `src/styles.css`
- Preserve from template: `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, `tests/sites-worker.test.mjs`
- Create: `vitest.config.js`
- Create: `src/test/setup.js`
- Create: `tests/app-smoke.test.jsx`
- Modify: `AGENTS.md`

- [ ] **Step 1: Initialize the selected Product Design prototype**

Use the Product Design image-to-code workflow to copy
`C:\Users\Administrator\.codex\plugins\cache\openai-curated-remote\product-design\0.1.52\templates\prototype`
into `F:\数据运营` without replacing `docs/` or `.git/`.

- [ ] **Step 2: Install focused runtime and test dependencies**

Run:

```powershell
npm install konva react-konva @mediapipe/tasks-vision idb-keyval lucide-react
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event fake-indexeddb
```

Expected: `package-lock.json` records the packages and `npm audit` does not block installation.

- [ ] **Step 3: Write the failing first-run smoke test**

Create `tests/app-smoke.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import App from "../src/App.jsx";

test("shows Reki upload entry without requiring login", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "REKI" })).toBeInTheDocument();
  expect(screen.getByText("视觉标注实验室")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "选择照片" })).toBeInTheDocument();
  expect(screen.queryByText(/登录|注册/)).not.toBeInTheDocument();
});
```

- [ ] **Step 4: Add the Vitest configuration and setup**

Create `vitest.config.js`:

```js
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.js"],
    include: ["src/**/*.test.{js,jsx}", "tests/**/*.test.{js,jsx}"],
  },
});
```

Create `src/test/setup.js`:

```js
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

let uuidCounter = 0;
Object.defineProperty(globalThis.crypto, "randomUUID", {
  configurable: true,
  value: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`,
});

if (!globalThis.ImageData) {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }),
});
```

Add `"test": "vitest run"` to `package.json`.

- [ ] **Step 5: Run the test and verify it fails**

Run:

```powershell
npm test -- tests/app-smoke.test.jsx
```

Expected: FAIL because the starter does not expose the Reki upload entry.

- [ ] **Step 6: Add the minimal branded upload entry**

Replace `src/App.jsx` with:

```jsx
export default function App() {
  return (
    <main className="reki-entry">
      <header>
        <h1>REKI</h1>
        <p>视觉标注实验室</p>
      </header>
      <button type="button">选择照片</button>
      <small>照片仅在本机处理</small>
    </main>
  );
}
```

- [ ] **Step 7: Verify the baseline**

Run:

```powershell
npm test -- tests/app-smoke.test.jsx
npm run build
npm run test:sites
```

Expected: all commands PASS and the build emits `dist/client/index.html` and `dist/server/index.js`.

- [ ] **Step 8: Record durable design decisions**

Append to `AGENTS.md`:

```markdown
## Reki product decisions

- Audience: cosers creating experimental static photo edits.
- Visual direction: silver-mist glass with restrained yolk-yellow states.
- Layout: hybrid workbench; desktop uses a tool rail and floating inspector, mobile uses a bottom dock and bottom sheet.
- Privacy: images and AI inference remain in the browser.
- Scope: static images only; competitor annotation capabilities are the minimum feature line.
```

- [ ] **Step 9: Commit**

```powershell
git add package.json package-lock.json vite.config.mjs vitest.config.js index.html src tests AGENTS.md .openai worker scripts
git commit -m "chore: initialize Reki prototype"
```

### Task 2: Define the project schema and editor history

**Files:**
- Create: `src/domain/project.js`
- Create: `src/domain/project.test.js`
- Create: `src/domain/reducer.js`
- Create: `src/domain/reducer.test.js`

- [ ] **Step 1: Write failing project and history tests**

Create `src/domain/project.test.js`:

```js
import { createProject, createAnnotation } from "./project.js";

test("creates a versioned local project", () => {
  const project = createProject({ width: 1080, height: 1350 });
  expect(project.version).toBe(1);
  expect(project.canvas).toEqual({ width: 1080, height: 1350, backgroundVisible: true });
  expect(project.layers).toEqual([]);
});

test("creates normalized path annotations", () => {
  const item = createAnnotation("path", [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }]);
  expect(item.type).toBe("path");
  expect(item.style.lineColor).toBe("#efbe3b");
  expect(item.points).toHaveLength(2);
});
```

Create `src/domain/reducer.test.js`:

```js
import { createEditorState, editorReducer } from "./reducer.js";
import { createAnnotation } from "./project.js";

test("supports add, undo, redo, and layer movement", () => {
  const start = createEditorState();
  const layer = createAnnotation("box", [{ x: 0.2, y: 0.3 }, { x: 0.5, y: 0.7 }]);
  const added = editorReducer(start, { type: "layer/add", layer });
  const undone = editorReducer(added, { type: "history/undo" });
  const redone = editorReducer(undone, { type: "history/redo" });
  expect(added.present.layers).toHaveLength(1);
  expect(undone.present.layers).toHaveLength(0);
  expect(redone.present.layers).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- src/domain/project.test.js src/domain/reducer.test.js
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the schema and factories**

Create `src/domain/project.js` with exported defaults:

```js
export const DEFAULT_STYLE = Object.freeze({
  lineColor: "#efbe3b",
  textColor: "#fff2c4",
  anchorColor: "#efbe3b",
  lineWidth: 2,
  fontSize: 14,
  anchorSize: 5,
  dash: [],
  opacity: 1,
  curveTension: 0,
});

export function createProject({ width = 1080, height = 1350 } = {}) {
  return {
    id: crypto.randomUUID(),
    version: 1,
    name: "未命名项目",
    updatedAt: Date.now(),
    canvas: { width, height, backgroundVisible: true },
    image: null,
    filters: {},
    layers: [],
  };
}

export function createAnnotation(type, points = [], overrides = {}) {
  return {
    id: crypto.randomUUID(),
    type,
    name: `${type}_${String(Date.now()).slice(-4)}`,
    points,
    visible: true,
    locked: false,
    label: "label_01",
    value: null,
    style: { ...DEFAULT_STYLE },
    ...overrides,
  };
}
```

- [ ] **Step 4: Implement immutable history and layer actions**

Create `src/domain/reducer.js` exporting:

```js
import { createProject } from "./project.js";

export function createEditorState(project = createProject()) {
  return { past: [], present: project, future: [], selectedLayerId: null };
}

function commit(state, nextPresent) {
  return { ...state, past: [...state.past, state.present], present: nextPresent, future: [] };
}

export function editorReducer(state, action) {
  if (action.type === "history/undo" && state.past.length) {
    return {
      ...state,
      past: state.past.slice(0, -1),
      present: state.past.at(-1),
      future: [state.present, ...state.future],
    };
  }
  if (action.type === "history/redo" && state.future.length) {
    return {
      ...state,
      past: [...state.past, state.present],
      present: state.future[0],
      future: state.future.slice(1),
    };
  }
  if (action.type === "layer/add") {
    return commit(state, { ...state.present, layers: [...state.present.layers, action.layer] });
  }
  if (action.type === "layer/update") {
    return commit(state, {
      ...state.present,
      layers: state.present.layers.map((layer) =>
        layer.id === action.id ? { ...layer, ...action.patch } : layer,
      ),
    });
  }
  if (action.type === "layer/remove") {
    return commit(state, {
      ...state.present,
      layers: state.present.layers.filter((layer) => layer.id !== action.id),
    });
  }
  return state;
}
```

Extend the reducer in the same file with these explicit cases before the final `return state`:

```js
if (action.type === "layer/move") {
  const layers = [...state.present.layers];
  const from = layers.findIndex((layer) => layer.id === action.id);
  if (from < 0) return state;
  const [layer] = layers.splice(from, 1);
  const to = Math.max(0, Math.min(action.toIndex, layers.length));
  layers.splice(to, 0, layer);
  return commit(state, { ...state.present, layers });
}
if (action.type === "layer/duplicate") {
  const source = state.present.layers.find((layer) => layer.id === action.id);
  if (!source) return state;
  const copy = { ...structuredClone(source), id: crypto.randomUUID(), name: `${source.name}_copy` };
  return commit(state, { ...state.present, layers: [...state.present.layers, copy] });
}
if (action.type === "layer/toggle" || action.type === "layer/lock") {
  const key = action.type === "layer/toggle" ? "visible" : "locked";
  return commit(state, {
    ...state.present,
    layers: state.present.layers.map((layer) =>
      layer.id === action.id ? { ...layer, [key]: !layer[key] } : layer,
    ),
  });
}
if (action.type === "canvas/update") {
  return commit(state, {
    ...state.present,
    canvas: { ...state.present.canvas, ...action.patch },
  });
}
if (action.type === "filters/update") {
  return commit(state, {
    ...state.present,
    filters: { ...state.present.filters, ...action.patch },
  });
}
if (action.type === "project/load") {
  return createEditorState(action.project);
}
if (action.type === "selection/set") {
  return { ...state, selectedLayerId: action.id };
}
```

- [ ] **Step 5: Run the domain tests**

Run:

```powershell
npm test -- src/domain/project.test.js src/domain/reducer.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/domain
git commit -m "feat: add Reki project model and history"
```

### Task 3: Implement geometry and competitor-parity annotation objects

**Files:**
- Create: `src/domain/geometry.js`
- Create: `src/domain/geometry.test.js`
- Create: `src/features/tools/toolDefinitions.js`
- Create: `src/features/canvas/AnnotationNode.jsx`
- Create: `src/features/canvas/EditorCanvas.jsx`

- [ ] **Step 1: Write failing normalized-coordinate tests**

Create `src/domain/geometry.test.js`:

```js
import { denormalizePoint, normalizePoint, makeCurvePoints } from "./geometry.js";

test("round-trips normalized canvas positions", () => {
  const normalized = normalizePoint({ x: 270, y: 675 }, { width: 1080, height: 1350 });
  expect(normalized).toEqual({ x: 0.25, y: 0.5 });
  expect(denormalizePoint(normalized, { width: 1080, height: 1350 })).toEqual({ x: 270, y: 675 });
});

test("returns a stable curve point list", () => {
  const points = makeCurvePoints(
    [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }],
    0.45,
  );
  expect(points[0]).toEqual({ x: 0, y: 0 });
  expect(points.at(-1)).toEqual({ x: 1, y: 0 });
  expect(points.length).toBeGreaterThan(3);
});
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- src/domain/geometry.test.js
```

Expected: FAIL because geometry functions do not exist.

- [ ] **Step 3: Implement normalized geometry**

Create `src/domain/geometry.js`:

```js
export function normalizePoint(point, size) {
  return { x: point.x / size.width, y: point.y / size.height };
}

export function denormalizePoint(point, size) {
  return { x: point.x * size.width, y: point.y * size.height };
}

export function makeCurvePoints(points, tension = 0) {
  if (points.length < 3 || tension <= 0) return points;
  const output = [points[0]];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    output.push(
      { x: a.x + (b.x - a.x) * tension, y: a.y + (b.y - a.y) * tension },
      { x: b.x - (b.x - a.x) * tension, y: b.y - (b.y - a.y) * tension },
      b,
    );
  }
  return output;
}
```

- [ ] **Step 4: Define every parity tool**

Create `src/features/tools/toolDefinitions.js`:

```js
export const TOOL_DEFINITIONS = [
  { id: "select", label: "选择", objectType: null },
  { id: "point-box", label: "点框工具", objectType: "box" },
  { id: "stack-box", label: "叠框工具", objectType: "stackBox" },
  { id: "node-path", label: "节点路径", objectType: "path" },
  { id: "leader", label: "单侧引线", objectType: "leader" },
  { id: "global-nodes", label: "全局节点", objectType: "nodeCloud" },
  { id: "random-nodes", label: "随机节点", objectType: "randomNodes" },
  { id: "orbit", label: "轨道圆环", objectType: "orbit" },
  { id: "label", label: "标签文字", objectType: "label" },
  { id: "filter", label: "底图效果", objectType: null },
];
```

- [ ] **Step 5: Implement Konva annotation renderers**

In `AnnotationNode.jsx`, map `box`, `stackBox`, `path`, `leader`, `nodeCloud`, `randomNodes`, `orbit`, and `label` to focused Konva groups. All renderers must accept:

```js
{
  layer,
  canvasSize,
  selected,
  onSelect,
  onChange,
}
```

Use `Line` with `tension={layer.style.curveTension}`, `Rect` for boxes, `Circle` for anchors and orbit rings, and `Text` for labels. Convert normalized points with `denormalizePoint` before rendering and normalize positions in drag callbacks.

- [ ] **Step 6: Implement the editor stage**

`EditorCanvas.jsx` must:

- render the background image only when `project.canvas.backgroundVisible` is true;
- render visible layers in array order;
- call `onSelectLayer(id)` from object interactions;
- expose click-to-create behavior for the active tool;
- expose `data-testid="editor-canvas"` for integration tests.

- [ ] **Step 7: Run geometry tests and build**

Run:

```powershell
npm test -- src/domain/geometry.test.js
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/domain/geometry* src/features/tools/toolDefinitions.js src/features/canvas
git commit -m "feat: render editable annotation tools"
```

### Task 4: Add presets, inspector, layers, and responsive workbench

**Files:**
- Create: `src/features/tools/presets.js`
- Create: `src/features/tools/presets.test.js`
- Create: `src/features/tools/ToolRail.jsx`
- Create: `src/features/tools/PresetStrip.jsx`
- Create: `src/features/tools/Inspector.jsx`
- Create: `src/features/tools/LayersPanel.jsx`
- Create: `src/components/TopBar.jsx`
- Create: `src/components/StatusBar.jsx`
- Create: `src/components/BottomDock.jsx`
- Create: `src/components/BottomSheet.jsx`
- Create: `src/components/GlassPanel.jsx`
- Modify: `src/App.jsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing preset coverage tests**

Create `src/features/tools/presets.test.js`:

```js
import { PRESETS } from "./presets.js";

test("ships all launch presets with deterministic layer recipes", () => {
  expect(PRESETS.map((preset) => preset.id)).toEqual([
    "neural-nodes",
    "archive-scan",
    "sacred-orbit",
    "mechanical-label",
    "anomaly-signal",
    "visual-measure",
  ]);
  for (const preset of PRESETS) {
    expect(preset.createLayers({ seed: 7 }).length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- src/features/tools/presets.test.js
```

Expected: FAIL because presets are not defined.

- [ ] **Step 3: Implement deterministic preset recipes**

Create `src/features/tools/presets.js` exporting `PRESETS`. Each preset has
`{ id, name, filters, createLayers }`; `filters` is a concrete partial filter settings object
and `createLayers({ seed, landmarks = [] })` returns annotation objects created by
`createAnnotation`. Seeded positions come from this small local linear-congruential generator:

```js
function randomFrom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
```

The six presets must combine at least two annotation types and one non-empty filter recipe each.
Extend the test loop with:

```js
expect(Object.keys(preset.filters).length).toBeGreaterThan(0);
expect(new Set(preset.createLayers({ seed: 7 }).map((layer) => layer.type)).size).toBeGreaterThan(1);
```

- [ ] **Step 4: Build the workbench components**

Component responsibilities:

- `TopBar`: brand, undo, redo, original comparison, canvas ratio, export.
- `ToolRail`: all `TOOL_DEFINITIONS`.
- `PresetStrip`: six presets with active selection.
- `Inspector`: common style fields plus type-specific controls; batch label update and “apply style to all.”
- `LayersPanel`: visible, locked, duplicate, delete, top, bottom, up, down.
- `StatusBar`: zoom, grid, dimensions, local-processing state.
- `BottomDock`: mobile tool access.
- `BottomSheet`: mobile inspector/layers tabs.

- [ ] **Step 5: Compose the hybrid workbench in `App.jsx`**

Use a reducer-driven state boundary:

```jsx
const [editor, dispatch] = useReducer(editorReducer, undefined, createEditorState);
const [activeTool, setActiveTool] = useState("select");
const [mobileSheet, setMobileSheet] = useState(null);
```

Render the import entry while `editor.present.image` is null; otherwise render the responsive workbench.

- [ ] **Step 6: Implement silver-mist/yolk responsive CSS**

Define tokens in `src/styles.css`:

```css
:root {
  --reki-bg: #ece8dd;
  --reki-surface: rgba(255, 255, 255, 0.58);
  --reki-surface-strong: rgba(250, 248, 241, 0.78);
  --reki-edge: rgba(49, 43, 27, 0.13);
  --reki-ink: #29271f;
  --reki-muted: #716c61;
  --reki-yolk: #efbe3b;
  --reki-radius-panel: 22px;
  --reki-blur: 24px;
}
```

At widths below `760px`, hide the desktop rail/inspector, show the bottom dock/sheet, keep export visible, and give the canvas the remaining viewport height.

- [ ] **Step 7: Run tests and build**

Run:

```powershell
npm test -- src/features/tools/presets.test.js tests/app-smoke.test.jsx
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/App.jsx src/styles.css src/components src/features/tools
git commit -m "feat: add responsive Reki workbench"
```

### Task 5: Import images and add the complete static filter pipeline

**Files:**
- Create: `src/features/import/decodeImage.js`
- Create: `src/features/import/decodeImage.test.js`
- Create: `src/features/import/ImportPanel.jsx`
- Create: `src/features/filters/filterPipeline.js`
- Create: `src/features/filters/filterPipeline.test.js`
- Create: `src/features/filters/FilterPanel.jsx`

- [ ] **Step 1: Write failing image validation and pixel filter tests**

Create `src/features/import/decodeImage.test.js`:

```js
import { validateImageFile, previewSize } from "./decodeImage.js";

test("accepts launch formats and rejects video", () => {
  expect(validateImageFile({ type: "image/png", size: 100 })).toEqual({ ok: true });
  expect(validateImageFile({ type: "video/mp4", size: 100 }).ok).toBe(false);
});

test("limits preview dimensions without changing aspect ratio", () => {
  expect(previewSize(4000, 2000, 1600)).toEqual({ width: 1600, height: 800 });
});
```

Create `src/features/filters/filterPipeline.test.js`:

```js
import { applyPixelFilters } from "./filterPipeline.js";

test("applies threshold and duotone deterministically", () => {
  const input = new ImageData(new Uint8ClampedArray([120, 120, 120, 255]), 1, 1);
  const output = applyPixelFilters(input, {
    threshold: 128,
    duotone: { dark: [10, 20, 30], light: [240, 220, 170] },
  });
  expect(Array.from(output.data)).toEqual([10, 20, 30, 255]);
});
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- src/features/import/decodeImage.test.js src/features/filters/filterPipeline.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement safe browser decoding**

`decodeImage.js` must export:

```js
export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function validateImageFile(file) {
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    return { ok: false, message: "请选择 JPG、PNG 或 WebP 图片" };
  }
  if (file.size > 40 * 1024 * 1024) {
    return { ok: false, message: "图片不能超过 40 MB" };
  }
  return { ok: true };
}

export function previewSize(width, height, maxEdge = 1600) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
```

Also export async `decodeImage(file)` using `createImageBitmap(file, { imageOrientation: "from-image" })`, falling back to an object URL and `Image` when `createImageBitmap` is unavailable.

- [ ] **Step 4: Implement deterministic pixel filters**

`filterPipeline.js` must export `applyPixelFilters(imageData, settings)` and support:

- threshold;
- ordered 4×4 Bayer halftone;
- seeded monochrome grain;
- duotone;
- RGB channel offset;
- horizontal scanline darkening.

Preserve the alpha channel. Keep each transform in a focused private function so tests can cover combinations.

- [ ] **Step 5: Wire import and filter panels**

`ImportPanel.jsx` must support file input and desktop drag/drop, render validation messages, and show “照片仅在本机处理.”

`FilterPanel.jsx` must expose threshold, halftone, grain, chromatic offset, scanline, and duotone controls with reset.

- [ ] **Step 6: Run tests**

Run:

```powershell
npm test -- src/features/import/decodeImage.test.js src/features/filters/filterPipeline.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/features/import src/features/filters
git commit -m "feat: import and stylize source photos"
```

### Task 6: Add lazy on-device AI landmarks

**Files:**
- Create: `src/features/ai/landmarkModel.js`
- Create: `src/features/ai/landmarkModel.test.js`
- Create: `src/features/ai/AiScanPanel.jsx`
- Modify: `src/features/tools/presets.js`

- [ ] **Step 1: Write failing landmark normalization tests**

Create `src/features/ai/landmarkModel.test.js`:

```js
import { normalizeLandmarks, selectLandmarkRegions } from "./landmarkModel.js";

test("normalizes model points into editable Reki points", () => {
  expect(normalizeLandmarks([{ x: 0.2, y: 0.4, visibility: 0.9 }], "pose")).toEqual([
    { x: 0.2, y: 0.4, confidence: 0.9, source: "pose", index: 0 },
  ]);
});

test("selects requested regions without changing point identity", () => {
  const points = [
    { index: 15, x: 0.1, y: 0.2, source: "pose" },
    { index: 27, x: 0.4, y: 0.8, source: "pose" },
  ];
  expect(selectLandmarkRegions(points, "pose", ["upper-body"])).toEqual([points[0]]);
});
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- src/features/ai/landmarkModel.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement MediaPipe adapters**

`landmarkModel.js` must:

- dynamically import `@mediapipe/tasks-vision`;
- load WASM from `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm`;
- load Face, Hand, and Pose landmarker `.task` files from the versioned Google MediaPipe model
  storage URLs declared as exported constants, so they can be replaced or self-hosted later;
- lazy-create FaceLandmarker, HandLandmarker, and PoseLandmarker only when requested;
- expose `scanImage(imageBitmap, modes)`;
- normalize model output to `{ x, y, confidence, source, index }`;
- expose region filters for eyes, face outline, fingers, upper body, and full pose;
- catch model/network errors and return `{ ok: false, code: "MODEL_LOAD_FAILED", message }`.

- [ ] **Step 4: Convert AI results to normal project layers**

Add `landmarksToLayers(result, options)` that returns `nodeCloud`, `path`, and optional `label` annotations. Generated layers must use the same schema and inspector controls as manual layers.

- [ ] **Step 5: Implement the AI scan panel**

`AiScanPanel.jsx` must expose:

- face, hands, pose toggles;
- region checkboxes;
- density slider;
- connection mode: none, anatomical, nearest-neighbor;
- scan, retry, and clear-result actions;
- loading, empty-result, and model-failure messages.

- [ ] **Step 6: Run tests and build**

Run:

```powershell
npm test -- src/features/ai/landmarkModel.test.js
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/features/ai src/features/tools/presets.js
git commit -m "feat: add on-device landmark scanning"
```

### Task 7: Add device-local projects and autosave

**Files:**
- Create: `src/features/storage/projectStore.js`
- Create: `src/features/storage/projectStore.test.js`
- Create: `src/features/storage/ProjectBrowser.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Write failing persistence tests**

Create `src/features/storage/projectStore.test.js`:

```js
import { saveProject, loadProject, listProjects, deleteProject } from "./projectStore.js";
import { createProject } from "../../domain/project.js";

test("saves, lists, loads, and deletes local projects", async () => {
  const project = createProject({ width: 1080, height: 1350 });
  project.name = "银雾测试";
  await saveProject(project);
  expect((await listProjects())[0].name).toBe("银雾测试");
  expect((await loadProject(project.id)).id).toBe(project.id);
  await deleteProject(project.id);
  expect(await listProjects()).toEqual([]);
});
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- src/features/storage/projectStore.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement IndexedDB storage**

Use `idb-keyval` with a dedicated store named `reki-projects`. Export:

```js
saveProject(project)
loadProject(id)
listProjects()
deleteProject(id)
```

Store searchable metadata separately from the full project. Sort `listProjects()` by `updatedAt` descending. Return a `STORAGE_FULL` error code for quota failures.

- [ ] **Step 4: Add debounced autosave and recovery**

In `App.jsx`, debounce saves by 700 ms after project changes. On launch, show the most recent recoverable project in `ProjectBrowser`, but do not open it without the user's choice.

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- src/features/storage/projectStore.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/features/storage src/App.jsx
git commit -m "feat: persist Reki projects locally"
```

### Task 8: Implement full-resolution and transparent export

**Files:**
- Create: `src/features/export/exportImage.js`
- Create: `src/features/export/exportImage.test.js`
- Create: `src/features/export/ExportDialog.jsx`
- Modify: `src/features/canvas/AnnotationNode.jsx`

- [ ] **Step 1: Write failing export-plan tests**

Create `src/features/export/exportImage.test.js`:

```js
import { createExportPlan } from "./exportImage.js";

test("creates exact 2x output dimensions", () => {
  expect(createExportPlan({ width: 1080, height: 1350 }, 2, false)).toEqual({
    width: 2160,
    height: 2700,
    includeBackground: true,
    estimatedBytes: 2160 * 2700 * 4,
  });
});

test("creates transparent overlay plans", () => {
  expect(createExportPlan({ width: 1080, height: 1350 }, 1, true).includeBackground).toBe(false);
});
```

- [ ] **Step 2: Verify failure**

Run:

```powershell
npm test -- src/features/export/exportImage.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement export planning and safety**

Create `src/features/export/exportImage.js`:

```js
export function createExportPlan(size, scale = 1, transparentOverlay = false) {
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  return {
    width,
    height,
    includeBackground: !transparentOverlay,
    estimatedBytes: width * height * 4,
  };
}

export function isSafeExport(plan, deviceMemory = navigator.deviceMemory ?? 4) {
  const allowance = Math.max(128, deviceMemory * 128) * 1024 * 1024;
  return plan.estimatedBytes * 2.5 < allowance;
}
```

- [ ] **Step 4: Implement composition export**

Export `renderProjectToBlob({ project, sourceBitmap, scale, format, quality, transparentOverlay })`. It must:

- create an offscreen canvas at exact plan dimensions;
- render the filtered source only when background is included;
- render every visible annotation using the same normalized geometry and style rules as the editor;
- use transparent pixels for overlay export;
- return PNG or JPEG Blob;
- throw a typed `EXPORT_MEMORY` error before unsafe allocation.

- [ ] **Step 5: Build the export dialog**

Expose:

- PNG or JPG;
- complete image or transparent effect layer;
- 1x, 2x, and conditionally enabled 4x;
- exact output dimensions;
- a memory warning and safe-size recommendation;
- “导出图片” action with progress and failure states.

- [ ] **Step 6: Run tests**

Run:

```powershell
npm test -- src/features/export/exportImage.test.js
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/features/export src/features/canvas/AnnotationNode.jsx
git commit -m "feat: export high-resolution Reki artwork"
```

### Task 9: Lock competitor parity and integration behavior

**Files:**
- Create: `tests/competitor-parity.test.jsx`
- Modify: `src/features/tools/Inspector.jsx`
- Modify: `src/features/tools/LayersPanel.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Write the parity integration test**

Create `tests/competitor-parity.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App.jsx";

test("exposes every competitor-baseline editing control", async () => {
  render(<App initialDemoProject />);
  for (const name of [
    "点框工具",
    "叠框工具",
    "节点路径",
    "单侧引线",
    "全局节点",
    "随机节点",
    "标签文字",
    "底图效果",
  ]) {
    expect(screen.getByRole("button", { name })).toBeInTheDocument();
  }
  await userEvent.click(screen.getByRole("button", { name: "高级设置" }));
  for (const label of [
    "线条颜色",
    "文字颜色",
    "锚点颜色",
    "线条粗细",
    "文字大小",
    "虚线",
    "透明度",
    "曲线张力",
  ]) {
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  }
  expect(screen.getByRole("button", { name: "批量修改标签" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "将当前样式应用到全部" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify the test catches missing controls**

Run:

```powershell
npm test -- tests/competitor-parity.test.jsx
```

Expected: FAIL listing any missing accessible control.

- [ ] **Step 3: Complete missing inspector and layer operations**

Add accessible controls for:

- label visibility;
- current label and numeric value format;
- batch label modification;
- background visibility;
- line/text/anchor colors;
- line width, text size, anchor size;
- solid/dashed style;
- opacity and curve tension;
- delete, duplicate, show/hide, lock;
- top, bottom, up, down;
- apply style to current type or all.

- [ ] **Step 4: Pass parity and full tests**

Run:

```powershell
npm test
```

Expected: all unit and integration tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add tests/competitor-parity.test.jsx src/features/tools src/App.jsx
git commit -m "test: enforce competitor feature parity"
```

### Task 10: Visual QA, responsive QA, Figma handoff, and final validation

**Files:**
- Modify as needed: `src/styles.css`, `src/App.jsx`, focused component files
- Preserve: `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, `tests/sites-worker.test.mjs`

- [ ] **Step 1: Start the local prototype**

Run:

```powershell
npm run dev
```

Expected: Vite prints a healthy local URL and the Reki entry opens without console errors.

- [ ] **Step 2: Verify the desktop core flow**

At a desktop viewport:

1. Upload the supplied reference image.
2. Apply “神经节点.”
3. Add a point box, path, curve, leader, random node set, orbit, and label.
4. Modify line, text, and anchor colors.
5. Batch-change labels.
6. Reorder layers.
7. Undo and redo.
8. Export a complete PNG and a transparent overlay PNG.

Expected: all actions are visible, persistent, and reflected in exports.

- [ ] **Step 3: Verify the mobile core flow**

At an iPhone-size viewport:

1. Upload an image.
2. Select a preset from the horizontal strip.
3. Open AI scan from the bottom dock.
4. Edit a selected layer in the bottom sheet.
5. Pinch-zoom and pan the canvas.
6. Export PNG.

Expected: no horizontal page overflow, export remains reachable, and no permanent desktop sidebars are visible.

- [ ] **Step 4: Compare source and implementation visuals**

Create same-state screenshots for desktop and mobile. Combine each screenshot with the corresponding approved browser mockup, inspect the pair, and fix:

- wrong silver/yolk balance;
- panel opacity and blur;
- spacing and density;
- incorrect border radii;
- canvas prominence;
- cropped or obscured controls;
- mobile bottom-sheet collisions.

- [ ] **Step 5: Create the editable Figma handoff**

Load `figma-create-new-file` and `figma-use` before any Figma write. Create a Reki design file containing:

- desktop workbench frame;
- mobile workbench frame;
- silver-mist/yolk tokens;
- reusable glass panel, button, preset chip, tool item, inspector row, and bottom dock components.

Use the verified prototype as the source of truth; do not invent a second visual system.

- [ ] **Step 6: Run final automated validation**

Run:

```powershell
npm test
npm run build
npm run test:sites
git status --short
```

Expected:

- all tests PASS;
- Sites worker test PASS;
- build contains `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`;
- only intentional files are modified.

- [ ] **Step 7: Commit the verified prototype**

```powershell
git add src tests package.json package-lock.json AGENTS.md
git commit -m "feat: complete Reki visual annotation lab"
```

- [ ] **Step 8: Hand off the working preview**

Open the verified local prototype in the in-app browser. Ask the user to inspect the core flow and decide whether to publish through Sites or connect a specific GitHub repository. Do not create a remote repository or production deployment without that explicit target choice.
