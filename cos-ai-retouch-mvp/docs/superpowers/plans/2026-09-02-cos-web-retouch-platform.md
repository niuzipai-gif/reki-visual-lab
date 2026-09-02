# COS Web Retouch Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-only COS photo retouch workstation with non-destructive layers, real local adjustments and masks, PSD export, and an orchestration-ready operation model.

**Architecture:** Keep the existing React/Vite and FastAPI boundaries, but add a local editor mode that starts from a browser-selected image and does not depend on invite validation or MiniMax image generation. Store an editor document as serializable layers plus normalized mask strokes; render the composite in Canvas 2D and export that same document through `ag-psd`. Keep remote AI providers behind a future operation adapter so MiniMax remains an optional planner rather than the image renderer.

**Tech Stack:** React 19, TypeScript, Canvas 2D, `ag-psd`, Vitest, Testing Library, Playwright, FastAPI.

---

### Task 1: Add the editor document model and deterministic image operations

**Files:**
- Create: `frontend/src/domain/editor.ts`
- Create: `frontend/src/editor/operations.ts`
- Test: `frontend/src/test/editorOperations.test.ts`

- [ ] **Step 1: Write failing tests** for layer creation, adjustment clamping, preset expansion, and normalized mask add/erase behavior.
- [ ] **Step 2: Run `npm test -- --run src/test/editorOperations.test.ts` and confirm the missing module failure.**
- [ ] **Step 3: Implement serializable editor types and pure helpers.** The helpers must not read DOM globals; they accept `ImageData` or plain document values, clamp adjustment ranges, preserve original pixels when intensity is zero, and represent mask strokes with normalized `0..1` points.
- [ ] **Step 4: Run the focused test and then the complete frontend test suite.**
- [ ] **Step 5: Commit `feat: add browser retouch document model`.**

### Task 2: Build the browser editor canvas, toolbar, layers and COS modules

**Files:**
- Create: `frontend/src/components/PhotoEditorPanel.tsx`
- Create: `frontend/src/components/EditorCanvas.tsx`
- Create: `frontend/src/components/EditorLayers.tsx`
- Create: `frontend/src/components/EditorControls.tsx`
- Modify: `frontend/src/app/App.tsx`
- Modify: `frontend/src/components/UploadPanel.tsx`
- Modify: `frontend/src/components/StudioHeader.tsx`
- Test: `frontend/src/test/PhotoEditorPanel.test.tsx`

- [ ] **Step 1: Add failing component tests** for entering the editor from a selected local file, seeing the COS module buttons, changing a slider, adding a layer, hiding a layer, undoing a stroke, and restoring the original.
- [ ] **Step 2: Verify the new tests fail because the editor entry and components do not exist.**
- [ ] **Step 3: Implement the editor mode in `App.tsx`.** The editor receives a local `File`/object URL and has an explicit back-to-upload action; it must not call the task API just to open the editor.
- [ ] **Step 4: Implement canvas rendering and interaction.** Render the original image, active adjustment output and mask overlay; support zoom-to-fit, pointer brush add/erase, and an accessible button toolbar. Use an offscreen canvas for export-sized rendering and keep the original `ImageBitmap`/image untouched.
- [ ] **Step 5: Implement the layers panel and COS module controls.** Include locked original, light/color, skin, hair, costume, background and style groups; each new operation gets a visible layer and a serializable operation record. Mark operations that require a remote AI provider as “云端 AI 可选” instead of pretending they have executed locally.
- [ ] **Step 6: Run focused tests, then all frontend tests and build.**
- [ ] **Step 7: Commit `feat: add browser COS retouch workstation`.**

### Task 3: Add PSD and AURA project export

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/src/editor/exporters.ts`
- Modify: `frontend/src/components/PhotoEditorPanel.tsx`
- Test: `frontend/src/test/editorExporters.test.ts`

- [ ] **Step 1: Add failing exporter tests** that build a PSD from a small in-memory document, verify the `8BPS` header, read it back with `ag-psd`, and verify the original, adjustment and mask layers are present. Add an AURA JSON round-trip assertion.
- [ ] **Step 2: Run the focused exporter test and confirm the dependency/module failure.**
- [ ] **Step 3: Add the pinned `ag-psd` dependency and implement export.** Use raw `ImageData`/canvas output for layers, preserve dimensions, write layer names, opacity and masks, and include operation metadata in the AURA JSON sidecar. Do not put API keys or remote signed URLs into the project file.
- [ ] **Step 4: Add `导出 PSD`, `导出 JPG`, and `保存项目 JSON` actions with disabled/busy states.**
- [ ] **Step 5: Run exporter tests, all frontend tests, and production build.**
- [ ] **Step 6: Commit `feat: export layered COS projects`.**

### Task 4: Add local automation presets and operation registry

**Files:**
- Modify: `frontend/src/domain/editor.ts`
- Modify: `frontend/src/editor/operations.ts`
- Create: `frontend/src/editor/presets.ts`
- Modify: `frontend/src/components/EditorControls.tsx`
- Test: `frontend/src/test/editorPresets.test.ts`

- [ ] **Step 1: Write failing tests** for `自然棚拍`, `清透日系`, `复古胶片`, and `暗调电影` preset expansion, including stable step IDs and rollback metadata.
- [ ] **Step 2: Verify focused tests fail before preset implementation.**
- [ ] **Step 3: Implement the preset registry.** A preset is a list of bounded operations with human-readable labels, target module, defaults, and preserve constraints. Executing a preset must create separate layers and a history entry per step; it must never overwrite the original layer.
- [ ] **Step 4: Add the “自动执行方案” control with progress and one-click undo-all for the preset run.**
- [ ] **Step 5: Run focused and full frontend tests/build, then commit `feat: add COS retouch automation presets`.**

### Task 5: Add planner-ready backend contract without image generation dependency

**Files:**
- Modify: `backend/app/config.py`
- Create: `backend/app/services/workflow_planner.py`
- Create: `backend/app/api/routes_workflows.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_workflow_planner.py`
- Modify: `shared/task-contract.md`

- [ ] **Step 1: Write failing backend tests** for deterministic fallback planning, operation allow-list validation, and a planner response that contains no provider key or image bytes.
- [ ] **Step 2: Verify the focused backend tests fail.**
- [ ] **Step 3: Implement a rule-based planner as the safe default.** It converts natural-language COS requests into validated operation steps and marks remote-AI-required steps without executing them. Add optional MiniMax text-planner settings but do not call the image-generation endpoint from this route.
- [ ] **Step 4: Add `POST /api/v1/workflows/plan` with request size limits and safe structured output.** Keep provider errors retryable and keep secrets server-side.
- [ ] **Step 5: Run backend focused/full tests, Ruff, and compileall.**
- [ ] **Step 6: Commit `feat: add planner-only workflow endpoint`.**

### Task 6: Integrate planner preview, add browser smoke coverage and deploy

**Files:**
- Modify: `frontend/src/app/api.ts`
- Modify: `frontend/src/components/EditorControls.tsx`
- Modify: `frontend/src/components/PhotoEditorPanel.tsx`
- Modify: `frontend/e2e/invite-single-photo.spec.ts`
- Modify: `README.md`
- Modify: `docs/qa-checklist.md`

- [ ] **Step 1: Add failing tests** for entering a natural-language request, previewing the structured steps, rejecting an unsafe/unbounded step, and executing only approved local operations.
- [ ] **Step 2: Verify focused tests fail, then implement the planner client and confirmation UI.**
- [ ] **Step 3: Extend Playwright coverage** for local file import, actual slider change, mask stroke, layer toggle, preset run, JPG export and PSD download.
- [ ] **Step 4: Run complete frontend/backend checks and inspect the built app at desktop and 390px widths.**
- [ ] **Step 5: Run secret scan and verify that no MiniMax key is in source, build artifacts or logs.**
- [ ] **Step 6: Update deployment documentation and, only after fresh checks, publish the approved branch to GitHub Pages/Render.**

