# Reki AI Style Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Reki reliable for cosplay image annotation by fixing original-image comparison, applying the user’s supplied character image as branding, adding a MiniMax-backed style-advice flow with offline fallback, and adding one-click layer clearing.

**Architecture:** Keep image rendering, style analysis, and editor state changes separate. `BackgroundLayer` owns source/canvas cache invalidation; `styleAdvisor` produces validated style recommendations and a server-proxy client; `AiStylePanel` renders recommendations and dispatches one atomic reducer action. All remote credentials remain server-side environment variables.

**Tech Stack:** React 18, Vite, Vitest, Testing Library, Konva, Cloudflare-style worker asset proxy, MiniMax-compatible HTTP API.

---

### Task 1: Lock the original-image comparison contract

**Files:**
- Modify: `src/features/canvas/BackgroundLayer.jsx`
- Modify: `src/features/canvas/EditorCanvas.jsx`
- Modify: `src/components/TopBar.jsx`
- Test: `src/features/canvas/BackgroundLayer.test.jsx`
- Test: `src/features/canvas/EditorCanvas.test.jsx`

- [ ] **Step 1: Write failing tests for source switching**

Add tests that render a project with a real `originalFile`, a decoded working source, active filters, and a marker; click the top-bar comparison control; assert `data-original` changes to `true`, canvas redraws from the original source, and marker DOM remains present. Add a second test that toggles twice and asserts the working preview is restored.

- [ ] **Step 2: Run focused tests**

Run `npm test -- --run src/features/canvas/BackgroundLayer.test.jsx src/features/canvas/EditorCanvas.test.jsx`.
Expected: the new source-switching tests fail because the renderer currently reuses a stale cached source/pixel buffer.

- [ ] **Step 3: Implement explicit source generations**

In `BackgroundLayer`, add a `sourceGenerationRef` and include `showOriginal` in the cache key. Resolve `image.originalFile` through a dedicated `originalResource()` decoder when `showOriginal` is true; never reuse processed pixels for that branch. On every resource or mode change, increment the generation, clear the cache, cancel the scheduled frame, and only commit a draw if the generation still matches.

- [ ] **Step 4: Verify focused tests**

Run the same command and expect all source-switching tests to pass. Run `npm test -- --run src/features/canvas/BackgroundLayer.test.jsx` to confirm existing filter and error tests remain green.

- [ ] **Step 5: Commit**

```powershell
git add src/features/canvas/BackgroundLayer.jsx src/features/canvas/EditorCanvas.jsx src/components/TopBar.jsx src/features/canvas/BackgroundLayer.test.jsx src/features/canvas/EditorCanvas.test.jsx
git commit -m "fix: make original image comparison redraw reliably"
```

### Task 2: Replace branding with the supplied character image and B background

**Files:**
- Create: `public/brand/reki-character.png`
- Create: `public/brand/reki-character-mark.png`
- Modify: `public/reki-mark.svg`
- Modify: `public/favicon.svg`
- Modify: `index.html`
- Modify: `src/components/TopBar.jsx`
- Modify: `src/styles.css`
- Test: `src/styles.test.js`

- [ ] **Step 1: Add exact supplied artwork assets**

Copy the user-supplied PNG into `public/brand/reki-character.png`, create a transparent square crop as `reki-character-mark.png`, and use those files as the canonical brand assets. Do not use a screenshot or generated replacement for the logo.

- [ ] **Step 2: Write failing asset and layout assertions**

Assert `index.html` includes `/brand/reki-character-mark.png` as the favicon, `TopBar` renders `/brand/reki-character-mark.png`, and the stylesheet contains the B palette tokens (`#efe4d4`, `#b02f3e`) plus non-interactive background layers with `pointer-events: none`.

- [ ] **Step 3: Implement B styling**

Update the brand lockup to use the PNG mark and set the workbench background to a low-contrast cream glass treatment. Keep the canvas surface dark enough for red annotations, add responsive opacity reduction below 720px, and put all decorative layers behind the canvas.

- [ ] **Step 4: Verify**

Run `npm test -- --run src/styles.test.js src/components/TopBar.test.jsx` and `npm run build`.

- [ ] **Step 5: Commit**

```powershell
git add public/brand public/reki-mark.svg public/favicon.svg index.html src/components/TopBar.jsx src/styles.css src/styles.test.js
git commit -m "feat: use supplied Reki character branding and cream glass theme"
```

### Task 3: Add validated style-advisor data model and offline recommendations

**Files:**
- Create: `src/features/ai/styleAdvisor.js`
- Create: `src/features/ai/styleAdvisor.test.js`
- Create: `src/features/ai/stylePresets.js`
- Create: `src/features/ai/stylePresets.test.js`
- Modify: `src/domain/reducer.js`
- Modify: `src/domain/reducer.test.js`

- [ ] **Step 1: Write failing model tests**

Test `analyzeImageFeatures()` returns bounded luminance, contrast, saturation, aspect ratio, and subject hints; `validateStyleAdvice()` rejects malformed JSON; `getOfflineRecommendations()` returns exactly three deterministic recommendations; and `styleToEditorPatch()` creates a filter patch plus annotation layers without mutating the input project.

- [ ] **Step 2: Run focused tests**

Run `npm test -- --run src/features/ai/styleAdvisor.test.js src/features/ai/stylePresets.test.js src/domain/reducer.test.js`.
Expected: new tests fail because the modules and `style/apply` reducer action do not exist.

- [ ] **Step 3: Implement deterministic offline analysis**

Implement pure functions with this shape:

```js
export function getOfflineRecommendations(features) {
  return [
    createRecommendation("红线档案", { contrast: 1.16, saturation: 0.82, grain: 0.12 }, "path"),
    createRecommendation("银雾肖像", { brightness: 1.04, contrast: 1.08, saturation: 0.74 }, "orbit"),
    createRecommendation("机械节点", { contrast: 1.22, saturation: 0.68, grain: 0.18 }, "nodeCloud"),
  ];
}
```

Validate numeric ranges, allowed annotation types, label modes, and a maximum of 3 recommendations before they reach React state.

- [ ] **Step 4: Add atomic reducer action**

Add `style/apply` that commits `{filters, layers}` together, assigns `source: "ai-style"` to generated layers, selects the first generated layer, and creates one undo entry. Keep `layers/removeBySource` unchanged for the existing AI scan.

- [ ] **Step 5: Verify and commit**

Run the focused tests again, then:

```powershell
git add src/features/ai/styleAdvisor.js src/features/ai/styleAdvisor.test.js src/features/ai/stylePresets.js src/features/ai/stylePresets.test.js src/domain/reducer.js src/domain/reducer.test.js
git commit -m "feat: add validated offline style recommendations"
```

### Task 4: Add secure MiniMax analysis proxy and UI flow

**Files:**
- Create: `src/features/ai/styleAdvisorClient.js`
- Create: `src/features/ai/styleAdvisorClient.test.js`
- Create: `src/features/ai/AiStylePanel.jsx`
- Create: `src/features/ai/AiStylePanel.test.jsx`
- Modify: `src/Workbench.jsx`
- Modify: `worker/index.js`
- Modify: `.gitignore`
- Modify: `README.md`

- [ ] **Step 1: Write failing client and panel tests**

Mock `fetch` and assert the client sends a bounded JSON feature payload to `/api/style-advice`, classifies timeout/401/429/invalid JSON, and falls back to offline recommendations. Render the panel and assert three cards, a loading state, an error with offline fallback, and an “应用此方案” button that calls the supplied callback with a validated recommendation.

- [ ] **Step 2: Implement client without exposing credentials**

Implement `requestStyleAdvice(features, {signal, fetchImpl = fetch})` with an 8-second timeout, `AbortController` composition, response-size guard, and schema validation. The browser only calls `/api/style-advice`; no key or provider URL is bundled into `src`.

- [ ] **Step 3: Implement worker proxy**

In `worker/index.js`, handle `POST /api/style-advice`, read `env.MINIMAX_API_KEY` and `env.MINIMAX_API_URL`, reject missing credentials with 503, cap request body to 256 KB, forward only the sanitized feature payload, enforce a 12-second upstream timeout, and return normalized JSON. Never echo request headers or provider errors containing secrets.

- [ ] **Step 4: Add panel and reducer wiring**

Add an “AI 风格建议” panel next to the existing local keypoint scanner. The panel displays “本机分析” and “远端建议” status, renders three recommendation cards, and calls `dispatch({ type: "style/apply", recommendation })` only after the user clicks apply. Keep the existing local scan button available as a separate tool.

- [ ] **Step 5: Verify focused tests**

Run `npm test -- --run src/features/ai/styleAdvisorClient.test.js src/features/ai/AiStylePanel.test.jsx tests/sites-worker.test.js` and `npm run build`.

- [ ] **Step 6: Commit**

```powershell
git add src/features/ai/styleAdvisorClient.js src/features/ai/styleAdvisorClient.test.js src/features/ai/AiStylePanel.jsx src/features/ai/AiStylePanel.test.jsx src/Workbench.jsx worker/index.js .gitignore README.md
git commit -m "feat: add secure AI style advice workflow"
```

### Task 5: Add clear-all-layers control

**Files:**
- Modify: `src/features/tools/LayersPanel.jsx`
- Modify: `src/Workbench.jsx`
- Modify: `src/domain/reducer.js`
- Test: `src/features/tools/LayersPanel.test.jsx`
- Test: `src/components/Workbench.test.jsx`

- [ ] **Step 1: Write failing interaction test**

Render a project with two layers, click `清除全部图层`, assert a confirmation dialog appears, cancel and verify both layers remain, confirm and verify the list is empty, then click undo and verify both layers return.

- [ ] **Step 2: Implement reducer action**

Add `layers/clear` that returns the unchanged state for an empty list and otherwise commits the same project with `layers: []` and `selectedLayerId: null`.

- [ ] **Step 3: Implement panel control**

Add a disabled-on-empty danger button with accessible label and native confirmation dialog. Wire confirmation to `dispatch({ type: "layers/clear" })` and show an empty-state hint.

- [ ] **Step 4: Verify and commit**

Run `npm test -- --run src/features/tools/LayersPanel.test.jsx src/components/Workbench.test.jsx src/domain/reducer.test.js`.

```powershell
git add src/features/tools/LayersPanel.jsx src/features/tools/LayersPanel.test.jsx src/components/Workbench.test.jsx src/domain/reducer.js
git commit -m "feat: add undoable clear-all-layers action"
```

### Task 6: Full verification, deploy, and publish

**Files:**
- Modify: `.openai/hosting.json` only if the deployment build needs the worker secret binding.
- Modify: `README.md` with environment-variable setup and AI privacy notes.

- [ ] **Step 1: Run the full test and build suite**

Run:

```powershell
npm test -- --run
npm run build
npm run test:sites
git diff --check
```

Expected: all tests pass, the production build succeeds, the worker smoke tests pass, and no whitespace errors are reported.

- [ ] **Step 2: Run the manual smoke flow**

Open the local production preview and verify: import the supplied image, toggle original comparison twice, open AI style advice, apply one recommendation, clear all layers, undo the clear, and export a PNG. Confirm the network panel never exposes `MINIMAX_API_KEY`.

- [ ] **Step 3: Configure deployment secret out-of-band**

Set `MINIMAX_API_KEY` and `MINIMAX_API_URL` in the hosting environment only. Do not add either value to `.env`, source, test fixtures, README examples, or Git history. If the hosting platform cannot provide a secret binding, ship offline recommendations and report remote AI as disabled rather than embedding the key.

- [ ] **Step 4: Deploy and verify**

Deploy the validated build, check the public URL returns 200, and repeat the smoke flow against the public deployment. Verify the GitHub repository contains only source/assets/docs and no key material.

- [ ] **Step 5: Commit final documentation and push**

```powershell
git add README.md .openai/hosting.json
git commit -m "docs: document AI style advice setup and verification"
git push -u origin feature/reki-build:main
```
