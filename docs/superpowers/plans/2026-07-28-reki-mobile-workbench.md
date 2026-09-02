# Reki Mobile Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Reki mobile editor canvas-first, with a one-tap return to selection and compact menus that leave the image visible.

**Architecture:** Keep responsive default zoom and editor-state updates in `Workbench`. Extend the existing dock and sheet components with explicit `onSelect`, `activeTool`, and `compact` props. Scope layout changes to the current 759px mobile breakpoint so desktop behavior remains unchanged.

**Tech Stack:** React 19, Vitest, Testing Library, CSS media queries, lucide-react.

---

### Task 1: Protect mobile navigation with tests

**Files:**
- Modify: `src/components/BottomDock.test.jsx`
- Modify: `src/components/Workbench.test.jsx`
- Modify: `src/components/BottomDock.jsx`
- Modify: `src/Workbench.jsx`

- [ ] **Step 1: Write the failing dock test**

```jsx
test("returns to selection in one tap without opening a sheet", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const onOpen = vi.fn();
  render(<BottomDock activeSheet="tools" activeTool="pointBox" onSelect={onSelect} onOpen={onOpen} onExport={vi.fn()} onToggleComparison={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "移动端返回选择模式" }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onOpen).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "打开预设面板" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the dock test and verify it fails**

Run: `npm test -- src/components/BottomDock.test.jsx`

Expected: FAIL because the dock has no direct selection event and still renders its preset entry.

- [ ] **Step 3: Write the failing workbench tests**

```jsx
test("uses a fitted 100 percent starting zoom on a mobile viewport", () => {
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  renderDemo();
  expect(screen.getByRole("application", { name: "标注画布" })).toHaveAttribute("data-zoom", "100");
});

test("returns to selection and closes a mobile tool sheet in one action", async () => {
  const user = userEvent.setup();
  renderDemo();
  await user.click(screen.getByRole("button", { name: "打开工具面板" }));
  await user.click(screen.getByRole("button", { name: "点框工具" }));
  await user.click(screen.getByRole("button", { name: "移动端返回选择模式" }));
  expect(screen.getByRole("application", { name: "标注画布" })).toHaveAttribute("data-active-tool", "select");
  expect(screen.queryByRole("dialog", { name: "移动端编辑面板" })).not.toBeInTheDocument();
});
```

- [ ] **Step 4: Run the workbench tests and verify they fail**

Run: `npm test -- src/components/Workbench.test.jsx`

Expected: FAIL because zoom remains 72 and the selection action is absent.

- [ ] **Step 5: Implement the narrow navigation change**

```jsx
const initialWorkbenchZoom = () =>
  globalThis.matchMedia?.("(max-width: 759px)").matches ? 100 : 72;

const [zoom, setZoom] = useState(initialWorkbenchZoom);

<StableBottomDock
  activeSheet={mobileSheet}
  activeTool={activeTool}
  onSelect={() => { setActiveTool("select"); setMobileSheet(null); }}
  onOpen={(sheet) => setMobileSheet(sheet)}
  ...
/>
```

Render direct selection before the sheet actions and remove only the duplicate dock `presets` item. Keep the top preset strip unchanged.

- [ ] **Step 6: Run focused navigation tests**

Run: `npm test -- src/components/BottomDock.test.jsx src/components/Workbench.test.jsx`

Expected: PASS with direct selection, no dock preset entry, and a 100% mobile default.

### Task 2: Compact simple mobile sheets

**Files:**
- Modify: `src/components/BottomSheet.jsx`
- Modify: `src/components/Workbench.test.jsx`
- Modify: `src/Workbench.jsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write the failing compact-sheet test**

```jsx
test("marks tools and presets as compact mobile sheets", async () => {
  const user = userEvent.setup();
  renderDemo();
  await user.click(screen.getByRole("button", { name: "打开工具面板" }));
  expect(screen.getByRole("dialog", { name: "移动端编辑面板" })).toHaveAttribute("data-compact", "true");
  expect(screen.queryByRole("separator", { name: "调整移动端面板高度" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the compact-sheet test and verify it fails**

Run: `npm test -- src/components/Workbench.test.jsx`

Expected: FAIL because every sheet has the same resizer and no compact state.

- [ ] **Step 3: Implement the compact sheet boundary**

```jsx
export function BottomSheet({ compact = false, resizeHandleProps, ...props }) {
  return (
    <GlassPanel className="bottom-sheet" data-compact={compact ? "true" : undefined} ...>
      {!compact ? <div className="sheet-resize-handle" {...resizeHandleProps}>...</div> : null}
      ...
    </GlassPanel>
  );
}

const specialSheet = ["tools", "presets", "ai", "filter"].includes(mobileSheet)
  ? { ..., compact: mobileSheet === "tools" || mobileSheet === "presets" }
  : null;
```

Pass `compact={specialSheet?.compact}` from `Workbench`.

- [ ] **Step 4: Add mobile-only geometry**

```css
@media (max-width: 759px) {
  .bottom-sheet[data-compact="true"] { height: min(44vh, calc(100dvh - 100px)); }
}
```

- [ ] **Step 5: Run compact and resize tests**

Run: `npm test -- src/components/Workbench.test.jsx src/hooks/useResizablePanels.test.jsx`

Expected: PASS; compact menus omit the resizer and regular sheets retain their existing resize behavior.

### Task 3: Complete regression and responsive verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-28-reki-mobile-workbench.md`

- [ ] **Step 1: Run automated checks**

Run:

```bash
npm test
npm run build
npm run test:sites
git diff --check
```

Expected: all tests pass, production build emits the standard Sites output, and the diff has no whitespace errors.

- [ ] **Step 2: Verify the 390 × 844 demo workflow**

Check a visibly larger initial canvas, the compact tools sheet, direct selection after choosing a drawing tool, AI, layers, comparison, and export entry.

- [ ] **Step 3: Commit the implementation**

```bash
git add src/components/BottomDock.jsx src/components/BottomDock.test.jsx src/components/BottomSheet.jsx src/components/Workbench.test.jsx src/Workbench.jsx src/styles.css docs/superpowers/plans/2026-07-28-reki-mobile-workbench.md
git commit -m "feat: improve mobile workbench flow"
```

