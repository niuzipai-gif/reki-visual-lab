# COS AI Retouch Soft Studio Motion Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 COS AI 修图前端改造成 B 方向「柔光写真馆」，用专业照片舞台、步骤轨道、轻量控制栏和克制动效替代当前普通卡片式工作台。

**Architecture:** 保留 `App` 现有任务状态和业务面板，将品牌头部与步骤轨道拆成展示组件；通过 `data-stage`、语义 class 和 CSS tokens 连接布局与状态。动效全部使用 CSS transition/keyframes，不引入动画依赖，不改变 API 或任务状态。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、Testing Library、CSS media queries、CSS `prefers-reduced-motion`。

---

### Task 1: 抽离工作室品牌头部与步骤轨道

**Files:**
- Create: `frontend/src/components/StudioHeader.tsx`
- Create: `frontend/src/components/WorkflowRail.tsx`
- Modify: `frontend/src/app/App.tsx:113-222`
- Test: `frontend/src/test/App.test.tsx`

- [ ] **Step 1: Write the failing test**

在现有 `opens the upload workspace directly without showing InviteGate` 测试中增加以下断言，锁定展示结构而不改变业务行为：

```tsx
expect(screen.getByText("AURA STUDIO")).toBeVisible();
expect(screen.getByText("角色写真后期工作室")).toBeVisible();
expect(screen.getByRole("navigation", { name: "修图步骤" })).toBeVisible();
expect(screen.getByRole("navigation", { name: "修图步骤" })).toHaveAttribute(
  "data-current-step",
  "upload",
);
expect(screen.getByText("照片会是主角，工具只在需要时出现。")).toBeVisible();
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
Set-Location F:\数据运营\.worktrees\cos-ai-retouch-mvp\cos-ai-retouch-mvp\frontend
npm test -- --run src/test/App.test.tsx
```

Expected: FAIL because the current header has neither `AURA STUDIO` nor the named step navigation.

- [ ] **Step 3: Implement the display components**

Create `StudioHeader.tsx` with a `currentStep: "upload" | "analysis" | "result"` prop. Render `AURA STUDIO`, `角色写真后期工作室`, a short current-step label, and the existing privacy message. Create `WorkflowRail.tsx` with the same step type and render:

```tsx
<nav className="workflow-rail" aria-label="修图步骤" data-current-step={currentStep}>
  <p className="eyebrow">STUDIO FLOW</p>
  <ol className="step-list">
    <li className={currentStep === "upload" ? "active" : "complete"}><span>01</span>上传照片</li>
    <li className={currentStep === "analysis" ? "active" : currentStep === "result" ? "complete" : "pending"}><span>02</span>选择修图</li>
    <li className={currentStep === "result" ? "active" : "pending"}><span>03</span>生成预览</li>
  </ol>
  <p className="aside-copy">照片会是主角，工具只在需要时出现。</p>
</nav>
```

In `App.tsx`, derive `currentStep` after `showAnalysis` and `showResult` are known, render `StudioHeader`, and replace the existing inline `aside-card` step markup with `WorkflowRail`. Keep `TaskProgress` in the aside below the rail. Pass no new API or task props.

- [ ] **Step 4: Run the focused test and verify it passes**

Run the same Vitest command. Expected: the App test file passes and the existing upload-flow assertions remain green.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/components/StudioHeader.tsx frontend/src/components/WorkflowRail.tsx frontend/src/app/App.tsx frontend/src/test/App.test.tsx
git commit -m "feat: add soft studio workflow shell"
```

### Task 2: 重做工作台布局和视觉 tokens

**Files:**
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/test/App.test.tsx`

- [ ] **Step 1: Write the failing structural assertion**

Add to the App workspace test:

```tsx
expect(screen.getByRole("main")).toHaveAttribute("data-stage", "upload");
expect(screen.getByRole("main")).toHaveClass("studio-shell");
expect(screen.getByTestId("workflow-main")).toHaveClass("photo-stage");
expect(screen.getByTestId("workflow-aside")).toHaveClass("control-rail");
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npm test -- --run src/test/App.test.tsx
```

Expected: FAIL because the current `main`, workflow wrapper, and columns do not expose the studio layout hooks.

- [ ] **Step 3: Add the stable layout hooks and CSS system**

In `App.tsx`, add `className="app-shell studio-shell" data-stage={currentStep}` to the main element, `data-testid="workflow-main" className="workflow-main photo-stage"` to the main column, and `data-testid="workflow-aside" className="workflow-aside control-rail"` to the aside.

In `styles.css`, replace the current top-level layout rules with a three-zone desktop system:

```css
.studio-shell { width:min(1480px, calc(100% - 64px)); padding:32px 0 72px; }
.studio-header { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:end; gap:24px; padding:0 4px 24px; margin-bottom:22px; border-bottom:1px solid var(--line); }
.studio-layout { display:grid; grid-template-columns:190px minmax(0,1fr) 260px; gap:22px; align-items:start; }
.photo-stage { min-width:0; min-height:620px; }
.control-rail { position:sticky; top:18px; display:grid; gap:14px; }
.workflow-rail { padding:22px 16px; border:1px solid var(--line); border-radius:22px; background:rgba(255,252,248,.58); }
.photo-stage > .panel { min-height:620px; }
```

Update the tokens to cream, fog-pink, champagne, berry-plum, warm ink and low-opacity warm shadows. Keep the existing success/warning/danger colors and all focus-visible styles. Do not use a dark grid, neon gradient, or black shadow.

- [ ] **Step 4: Run test and build**

Run:

```powershell
npm test -- --run src/test/App.test.tsx
npm run build
```

Expected: focused tests pass and TypeScript/Vite build completes without warnings treated as errors.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/app/App.tsx frontend/src/styles.css frontend/src/test/App.test.tsx
git commit -m "feat: shape the soft studio workspace"
```

### Task 3: 加入照片舞台、面板切换和显影动效

**Files:**
- Modify: `frontend/src/components/UploadPanel.tsx`
- Modify: `frontend/src/components/AnalysisPanel.tsx`
- Modify: `frontend/src/components/ResultPanel.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/test/App.test.tsx`, `frontend/src/test/UploadPanel.test.tsx`

- [ ] **Step 1: Write the failing behavior assertions**

In `App.test.tsx`, after the direct workspace render, assert the upload panel is staged:

```tsx
expect(screen.getByRole("region", { name: "先放一张你喜欢的照片" })).toHaveClass("studio-panel-enter");
```

In `UploadPanel.test.tsx`, after a valid file is selected, assert the panel has the preview state class:

```tsx
expect(screen.getByRole("region", { name: "先放一张你喜欢的照片" })).toHaveClass("upload-panel-ready");
```

- [ ] **Step 2: Run the focused tests and verify the new assertions fail**

```powershell
npm test -- --run src/test/App.test.tsx src/test/UploadPanel.test.tsx
```

Expected: FAIL because the panels do not expose staged/ready classes.

- [ ] **Step 3: Add presentation classes without changing state logic**

Add `studio-panel-enter` to the upload, analysis and result section class names. In `UploadPanel`, add `upload-panel-ready` when `previewUrl` is truthy:

```tsx
<section className={`panel upload-panel studio-panel-enter ${previewUrl ? "upload-panel-ready" : ""}`} ...>
```

Add `analysis-panel` and `result-panel` hooks where their section class names already exist. Do not modify API calls, retry behavior, task statuses, or file validation.

- [ ] **Step 4: Implement the motion rules**

Add these CSS behaviors:

```css
@keyframes studio-panel-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
@keyframes studio-photo-reveal { from { opacity:0; transform:scale(1.025); filter:saturate(.82) blur(2px); } to { opacity:1; transform:scale(1); filter:none; } }
@keyframes studio-sheen { 0% { transform:translateX(-120%); opacity:0; } 35% { opacity:.34; } 100% { transform:translateX(120%); opacity:0; } }
.studio-panel-enter { animation:studio-panel-in .52s cubic-bezier(.22,.8,.24,1) both; }
.upload-panel-ready .preview-wrap { animation:studio-photo-reveal .62s cubic-bezier(.22,.8,.24,1) both; }
.photo-stage .analysis-preview::before { content:""; position:absolute; inset:0; z-index:2; width:34%; background:linear-gradient(90deg,transparent,rgba(255,255,255,.48),transparent); transform:translateX(-120%); pointer-events:none; }
.photo-stage .analysis-preview:hover::before { animation:studio-sheen 1.2s ease-out both; }
.primary-button:hover:not(:disabled) { box-shadow:0 13px 34px rgba(146,74,104,.26); }
```

Use transition delays on `.studio-header`, `.workflow-rail`, `.photo-stage`, and `.control-rail` to create a total staged entrance under 600ms. Keep the existing reduced-motion media query and extend it to set `animation:none` and `transition-duration:.01ms` for the new classes.

- [ ] **Step 5: Run the focused tests and build**

```powershell
npm test -- --run src/test/App.test.tsx src/test/UploadPanel.test.tsx src/test/AnalysisPanel.test.tsx src/test/ResultPanel.test.tsx
npm run build
```

Expected: all selected tests pass and the production build completes.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/components/UploadPanel.tsx frontend/src/components/AnalysisPanel.tsx frontend/src/components/ResultPanel.tsx frontend/src/styles.css frontend/src/test/App.test.tsx frontend/src/test/UploadPanel.test.tsx
git commit -m "feat: add soft studio photo motion"
```

### Task 4: 响应式和可访问性验收

**Files:**
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/test/App.test.tsx`

- [ ] **Step 1: Add reduced-motion and responsive hooks**

Keep the existing semantic labels and add a test assertion that the step rail remains named and the primary upload control remains enabled/disabled according to existing file state. Do not assert animation timing in jsdom.

- [ ] **Step 2: Implement responsive rules**

At the existing 960px, 780px and 520px breakpoints:

```css
@media (max-width:960px) { .studio-layout { grid-template-columns:150px minmax(0,1fr); } .control-rail { grid-column:2; position:static; } }
@media (max-width:780px) { .studio-shell { width:min(100% - 24px, 680px); } .studio-header { display:block; } .studio-layout { display:flex; flex-direction:column; } .control-rail { width:100%; order:-1; } .photo-stage { width:100%; min-height:0; } .photo-stage > .panel { min-height:0; } .workflow-rail { width:100%; } .workflow-rail .step-list { display:flex; justify-content:space-between; } }
@media (prefers-reduced-motion:reduce) { .studio-panel-enter, .upload-panel-ready .preview-wrap { animation:none !important; } .photo-stage .analysis-preview::before { display:none; } }
```

Preserve the existing mobile rules for analysis grids, result cards, sliders, and mask controls. Ensure `overflow-x:hidden` is applied only to the page shell if the sheen would otherwise create horizontal scrolling.

- [ ] **Step 3: Run full frontend verification**

```powershell
npm test -- --run
npm run build
git diff --check
```

Expected: all frontend tests pass, the build succeeds, and `git diff --check` prints no errors.

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/styles.css frontend/src/test/App.test.tsx
git commit -m "test: verify soft studio responsive behavior"
```

### Task 5: 本地视觉验收与交付

**Files:**
- No new product files; inspect the running frontend at `http://127.0.0.1:4173`.

- [ ] **Step 1: Start or reuse the local Vite preview**

Run from `F:\数据运营\.worktrees\cos-ai-retouch-mvp\cos-ai-retouch-mvp\frontend`:

```powershell
npm run dev -- --host 127.0.0.1 --port 4173
```

Expected: `GET http://127.0.0.1:4173` returns HTTP 200.

- [ ] **Step 2: Verify the visual acceptance path**

Check the desktop view for the three-zone layout, direct upload entry, stable central photo stage, and right-side controls. Select a local JPG/PNG and verify the preview reveals without page jump. Use browser emulation or a narrow window to verify the rail becomes horizontal and the photo remains above controls.

- [ ] **Step 3: Record known boundary**

Do not claim Figma synchronization; this implementation uses the local frontend preview because the previous Starter MCP quota blocked further Figma edits.

- [ ] **Step 4: Final status check**

```powershell
git status --short
git log -5 --oneline
```

Expected: only intentionally generated local brainstorm artifacts remain untracked, and all product changes are committed.

