# Reki 反馈修复与品牌资产 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Reki 的标记编辑、红色视觉、原图对比和品牌资产，并将已验证版本发布到用户 GitHub。

**Architecture:** 复用现有 domain/reducer、Konva 画布和本地存储契约；新增独立的缩放几何辅助函数和品牌 SVG 资产，避免把视觉资产写入业务组件。所有行为先以 Vitest 测试锁定，再改 UI 和部署元数据。

**Tech Stack:** React 19, Vite, Konva/React Konva, Vitest, SVG, GitHub CLI/remote。

---

### Task 1: 固定缩放几何契约

**Files:**
- Create: `src/domain/transform.js`
- Test: `src/domain/transform.test.js`
- Modify: `src/domain/reducer.js`

- [ ] **Step 1: Write failing tests** for resizing normalized points from a box handle, clamping to 0–1, and preserving locked layers.
- [ ] **Step 2: Run `npm test -- src/domain/transform.test.js` and confirm failure.**
- [ ] **Step 3: Implement `getNormalizedBounds`, `resizeNormalizedPoints`, and a reducer `RESIZE_LAYER` action.**
- [ ] **Step 4: Run the focused test and commit `feat: add normalized layer resizing`.**

### Task 2: Connect Konva handles to resize and drag

**Files:**
- Modify: `src/features/canvas/AnnotationNode.jsx`
- Modify: `src/features/canvas/EditorCanvas.jsx`
- Test: `src/features/canvas/EditorCanvas.test.jsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add failing tests** for visible eight-direction handles, resize callback payloads, and locked-layer handle suppression.
- [ ] **Step 2: Run focused canvas tests and confirm failure.**
- [ ] **Step 3: Add a Transformer with `boundBoxFunc`, drag-end normalization, and resize-end dispatch.**
- [ ] **Step 4: Keep existing layer selection/history/autosave wiring intact.**
- [ ] **Step 5: Run `npm test -- src/features/canvas/EditorCanvas.test.jsx` and commit `feat: enable annotation drag and resize`.**

### Task 3: Switch annotation defaults and presets to red

**Files:**
- Modify: `src/domain/project.js`
- Modify: `src/features/tools/presets.js`
- Modify: `src/features/ai/landmarkModel.js`
- Test: existing `src/domain/project.test.js`, `src/features/tools/presets.test.js`, `src/features/ai/landmarkModel.test.js`

- [ ] **Step 1: Update failing expectations to `#e5484d`, `#ff6b6b`, and warm-white label text.**
- [ ] **Step 2: Run focused tests and confirm failures.**
- [ ] **Step 3: Update only annotation style defaults; preserve yolk UI tokens.**
- [ ] **Step 4: Run focused tests and commit `feat: use red annotation styling`.**

### Task 4: Repair original-image comparison

**Files:**
- Modify: `src/components/TopBar.jsx`
- Modify: `src/features/canvas/BackgroundLayer.jsx`
- Modify: `src/Workbench.jsx`
- Test: `src/components/Workbench.test.jsx`, `src/features/canvas/BackgroundLayer.test.jsx`

- [ ] **Step 1: Add tests** for toggling original source without removing layers, disabled state when no source exists, and restoration after toggle.
- [ ] **Step 2: Run focused tests and confirm failure.**
- [ ] **Step 3: Make the comparison state explicit and pass `showOriginal` to the background layer only.**
- [ ] **Step 4: Run focused tests and commit `fix: restore original comparison`.**

### Task 5: Add original Reki SVG brand assets

**Files:**
- Create: `public/reki-mark.svg`
- Create: `public/favicon.svg`
- Modify: `src/components/TopBar.jsx`
- Modify: `src/features/import/ImportPanel.jsx`
- Modify: `index.html`
- Modify: `src/styles.css`
- Test: `src/styles.test.js`

- [ ] **Step 1: Add asset-reference tests** ensuring the new mark and favicon are used.
- [ ] **Step 2: Create a compact hand-drawn SVG based on the user reference mood, with no screenshot embedding.**
- [ ] **Step 3: Replace text-only brand icon and add favicon link.**
- [ ] **Step 4: Run focused tests and commit `feat: add Reki brand mark`.**

### Task 6: Documentation, full validation, and GitHub publish

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md` if durable brand decisions need recording
- Modify: `.openai/hosting.json` only if the GitHub handoff changes no Sites metadata

- [ ] **Step 1: Write README sections for features, controls, privacy, local development, build, and public URL.**
- [ ] **Step 2: Run `npm test`, `npm run build`, `npm run test:sites`, and `git diff --check`.**
- [ ] **Step 3: Check `gh --version` and `gh auth status`; inspect `git status -sb` and `git diff`.**
- [ ] **Step 4: Commit documentation and implementation changes, push the intended branch to `niuzipai-gif`, and create/update a clear PR or repository branch according to the authenticated GitHub context.**
- [ ] **Step 5: Redeploy the validated public Sites version and smoke-test the public URL.**
