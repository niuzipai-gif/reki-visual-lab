# Reki Marker Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every existing spatial marker into an optional, non-destructive original-image fragment that can be displaced, styled, animated and exported, while adding fast side-by-side original comparison and eliminating implicit effects.

**Architecture:** Add a serializable `extractedFragment` layer that references an original-image rectangle and source marker rather than copying a full image. Render the base image with source-hole masks, then render fragments and annotations in normal layer order; use a shared frame renderer for preview and exports. Keep original comparison in a cached, unfiltered sibling surface.

**Tech Stack:** React, react-konva, Canvas/OffscreenCanvas, existing effect stack, existing animation runtime, Vitest and Testing Library.

---

### Task 1: Fragment domain model, marker bounds and default-effect cleanup

**Files:**
- Create: `src/features/fragments/fragmentDomain.js`
- Test: `src/features/fragments/fragmentDomain.test.js`
- Modify: `src/domain/project.js`
- Modify: `src/domain/reducer.js`
- Modify: `src/domain/project.test.js`
- Modify: `src/domain/reducer.test.js`
- Modify: `src/Workbench.jsx`

- [ ] **Step 1: Write failing tests**

```js
it.each(MARKER_TYPES)("creates a source rectangle from %s", (type) => {
  const rect = markerSourceRect(createAnnotation(type, markerPoints[type]), canvas);
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
});

it("creates an extracted fragment with an empty local effect stack", () => {
  const fragment = createExtractedFragment({ marker, canvas });
  expect(fragment).toMatchObject({ type: "extractedFragment", sourceMarkerId: marker.id, sourceFill: "preserve", effects: [] });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- --run src/features/fragments/fragmentDomain.test.js src/domain/project.test.js`

Expected: FAIL because fragment utilities and layer type do not exist.

- [ ] **Step 3: Implement normalized fragment data and marker-derived rectangles**

```js
export function createExtractedFragment({ marker, canvas, sourceFill = "preserve" }) {
  const sourceRect = markerSourceRect(marker, canvas);
  return createAnnotation("extractedFragment", [], {
    sourceMarkerId: marker.id, sourceRect, linkedToMarker: true,
    sourceFill, transform: { x: sourceRect.x, y: sourceRect.y, width: sourceRect.width, height: sourceRect.height },
    effects: [], animation: structuredClone(DEFAULT_ANIMATION),
  });
}
```

Use existing annotation bounds for all spatial marker types; text uses text bounds and points use a minimum normalized rectangle. New projects and the demo project must start with `effectStack: []` and no implicit brightness/contrast/saturation values.

- [ ] **Step 4: Add undoable reducer actions**

```js
case "fragment/create": return commit(state, addFragment(state.present, action.markerId, action.sourceFill), action.selectedLayerId);
case "fragment/update": return updateFragment(state, action.id, action.patch);
case "fragment/sourceFill": return updateFragment(state, action.id, { sourceFill: action.sourceFill });
case "marker/boundsChanged": return syncLinkedFragments(state, action.markerId);
```

Validate source fill against `transparent`, `black`, `white`, `preserve`; reject invalid source rectangles. Unlink a fragment when its transform is directly changed.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- --run src/features/fragments/fragmentDomain.test.js src/domain/project.test.js src/domain/reducer.test.js`

Expected: PASS.

```bash
git add src/features/fragments src/domain/project.js src/domain/project.test.js src/domain/reducer.js src/domain/reducer.test.js src/Workbench.jsx
git commit -m "feat: add marker extraction fragments"
```

### Task 2: Side-by-side original comparison and cached composition

**Files:**
- Create: `src/features/canvas/OriginalComparisonPane.jsx`
- Test: `src/features/canvas/OriginalComparisonPane.test.jsx`
- Modify: `src/features/canvas/EditorCanvas.jsx`
- Modify: `src/features/canvas/BackgroundLayer.jsx`
- Modify: `src/features/canvas/BackgroundLayer.test.jsx`
- Modify: `src/Workbench.jsx`
- Modify: `src/styles.css`
- Test: `src/components/Workbench.test.jsx`

- [ ] **Step 1: Write failing comparison tests**

```jsx
it("shows an unfiltered sibling original surface during comparison", async () => {
  render(<Workbench initialDemoProject={projectWithEffects} />);
  await user.click(screen.getByRole("button", { name: "原图对比" }));
  expect(screen.getByLabelText("原图实时对照")).toBeVisible();
  expect(screen.getByLabelText("原图实时对照")).toHaveAttribute("data-effect-count", "0");
});
```

- [ ] **Step 2: Run failing test**

Run: `npm test -- --run src/features/canvas/OriginalComparisonPane.test.jsx src/components/Workbench.test.jsx`

Expected: FAIL because comparison replaces the editing canvas instead of rendering a sibling.

- [ ] **Step 3: Implement cached sibling original pane**

`OriginalComparisonPane` accepts the decoded source and presentation size, displays no layers/effects/animation, and uses a memoized source cache keyed by image identity plus dimensions. `EditorCanvas` always remains the editing side. CSS changes the workspace to two equal panes only while compare mode is on, with a safe stacked mobile fallback.

- [ ] **Step 4: Add performance guard tests**

```js
it("does not call applyEffectStack when toggling original comparison", async () => {
  render(<Workbench initialDemoProject={projectWithEffects} />);
  await user.click(screen.getByRole("button", { name: "原图对比" }));
  expect(applyEffectStack).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- --run src/features/canvas/OriginalComparisonPane.test.jsx src/features/canvas/BackgroundLayer.test.jsx src/components/Workbench.test.jsx`

Expected: PASS.

```bash
git add src/features/canvas src/Workbench.jsx src/styles.css src/components/Workbench.test.jsx
git commit -m "feat: show cached original beside editor"
```

### Task 3: Fragment preview, source-hole rendering and inspector controls

**Files:**
- Create: `src/features/fragments/FragmentNode.jsx`
- Create: `src/features/fragments/FragmentInspector.jsx`
- Test: `src/features/fragments/FragmentNode.test.jsx`
- Test: `src/features/fragments/FragmentInspector.test.jsx`
- Modify: `src/features/canvas/EditorCanvas.jsx`
- Modify: `src/features/canvas/BackgroundLayer.jsx`
- Modify: `src/features/tools/Inspector.jsx`
- Modify: `src/Workbench.jsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing fragment interaction tests**

```jsx
it("moves an extracted fragment without moving its source marker", async () => {
  render(<EditorCanvas project={projectWithFragment} />);
  drag(screen.getByTestId("fragment-layer-fragment-1"), { x: 80, y: 20 });
  expect(onChangeLayer).toHaveBeenCalledWith("fragment-1", expect.objectContaining({ linkedToMarker: false }));
});

it("sets the original source-hole fill from fragment inspector", async () => {
  render(<FragmentInspector layer={fragment} onSourceFill={onSourceFill} />);
  await user.selectOptions(screen.getByLabelText("原位置"), "black");
  expect(onSourceFill).toHaveBeenCalledWith("black");
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- --run src/features/fragments/FragmentNode.test.jsx src/features/fragments/FragmentInspector.test.jsx`

Expected: FAIL because fragment render and controls do not exist.

- [ ] **Step 3: Render base-hole and movable fragment**

Background composition draws the base source, then applies each non-preserve source rectangle with `destination-out` for transparent or `fillRect` black/white. Fragment node draws its source rectangle from the cached original into a local canvas/image surface, uses existing transform handles, and keeps pixel effects deferred while `isDragging` is true.

- [ ] **Step 4: Add inspector integration**

Existing markers show an “提取框内原图” action. Extracted fragments show `原位置` select, `重新关联标记` button, per-fragment empty effect list and existing MotionPanel. Do not add a new toolbar crop tool.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- --run src/features/fragments/FragmentNode.test.jsx src/features/fragments/FragmentInspector.test.jsx src/features/canvas/EditorCanvas.test.jsx`

Expected: PASS.

```bash
git add src/features/fragments src/features/canvas src/features/tools/Inspector.jsx src/Workbench.jsx src/styles.css
git commit -m "feat: render movable marker fragments"
```

### Task 4: Local fragment effects, animation/export parity and final verification

**Files:**
- Modify: `src/features/filters/effectStack.js`
- Modify: `src/features/export/exportImage.js`
- Modify: `src/features/export/exportImage.test.js`
- Modify: `src/features/motion/motionRenderer.js`
- Modify: `src/features/motion/motionRenderer.test.js`
- Modify: `src/features/export/ExportDialog.test.jsx`
- Modify: `tests/competitor-parity.test.jsx`
- Modify: `README.md`

- [ ] **Step 1: Write failing composite parity tests**

```js
it("renders a local fragment effect and its source hole in a static frame", async () => {
  const blob = await renderProjectFrameToBlob({ project: fragmentProject, sourceBitmap, timeMs: 400 });
  expect(await readPixel(blob, holeX, holeY)).toEqual([0, 0, 0, 255]);
  expect(await readPixel(blob, movedFragmentX, movedFragmentY)).not.toEqual(sourcePixel);
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- --run src/features/export/exportImage.test.js src/features/motion/motionRenderer.test.js`

Expected: FAIL because export does not render extracted fragments.

- [ ] **Step 3: Implement shared local fragment compositing**

```js
drawBaseWithSourceHoles(context, project, sourceBitmap, plan);
for (const layer of project.layers) {
  if (layer.type === "extractedFragment") drawAnimatedFragmentToContext(context, layer, sourceBitmap, project.canvas, scale, timeMs);
  else drawAnimatedAnnotationToContext(context, layer, project.canvas, scale, timeMs);
}
```

Use `applyEffectStack` only on the cropped fragment offscreen canvas when the fragment has effects. Reuse existing animation runtime. Motion renderer inherits the frame output without a separate fragment code path.

- [ ] **Step 4: Add end-to-end and documentation coverage**

Competitor parity imports a photo, creates each representative marker, extracts a fragment, sets black source fill, moves it, applies a local effect and animation, opens comparison, then selects image and video exports. README documents non-destructive extraction, source-hole modes, local-only processing, and default-empty effects.

- [ ] **Step 5: Run full verification and commit**

Run: `npm test -- --run; npm run build; npm run test:sites; git diff --check`

Expected: all commands exit 0.

```bash
git add src/features/filters/effectStack.js src/features/export src/features/motion/motionRenderer.js src/features/motion/motionRenderer.test.js tests/competitor-parity.test.jsx README.md
git commit -m "feat: export marker extraction fragments"
```
