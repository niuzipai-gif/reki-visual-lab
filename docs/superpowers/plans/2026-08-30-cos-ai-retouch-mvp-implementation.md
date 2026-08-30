# COS AI 修图 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an invite-only single-photo web MVP that analyzes a COS photo, lets the user confirm natural-retouch and structural-repair regions, submits an edit plan to an image-model adapter, and provides version comparison, rollback, and download.

**Architecture:** Create a new `cos-ai-retouch-mvp/` application inside `F:\数据运营`; do not modify the unrelated existing projects in the workspace. The React/Vite frontend is a static site, while a FastAPI service on Render owns invite validation, task state, image-model calls, signed object-storage URLs, and metadata. The first implementation uses a deterministic mock image provider for local and browser tests; the external provider is connected only through the same adapter interface.

**Tech Stack:** React + TypeScript + Vite, Vitest + Testing Library, Python 3.11 + FastAPI + Pydantic Settings, SQLAlchemy 2 + Alembic, PostgreSQL in deployment, SQLite for local tests, boto3-compatible object storage, pytest + httpx, Playwright for one end-to-end smoke flow, GitHub Actions for the invite-only Pages build, and Render Web Service for the API.

---

## Scope and fixed decisions

- The product is the guided visual workflow, not a prompt editor.
- MVP access is invite-token based; no user accounts, payment, social feed, or public asset library.
- One original image per task; JPG and PNG only; upload limit is 20 MB.
- The two visible goals are `natural_retouch` and `structure_repair`.
- The UI exposes region selection, brush add/erase, three intensity levels, progress, comparison, rollback, and download.
- The internal edit plan keeps `preserve`, `regions`, `operations`, `integration`, and `validation` fields. The raw prompt/JSON is hidden from normal users.
- A task can produce at most two candidate versions and can automatically retry an external-provider failure at most twice.
- Original, mask, and result assets expire after 24 hours. Metadata remains only until the task expires.
- The first public test deployment may use GitHub Pages for the static frontend, but it must remain invite-only and non-commercial. A public commercial SaaS deployment uses Render Static Site or an equivalent static host instead.

## File map

Create the following new tree. There are no existing application files to modify.

```text
cos-ai-retouch-mvp/
├── README.md
├── .gitignore
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── app/App.tsx
│       ├── app/api.ts
│       ├── app/config.ts
│       ├── domain/task.ts
│       ├── components/InviteGate.tsx
│       ├── components/UploadPanel.tsx
│       ├── components/AnalysisPanel.tsx
│       ├── components/MaskCanvas.tsx
│       ├── components/ResultPanel.tsx
│       ├── components/TaskProgress.tsx
│       ├── styles.css
│       └── test/
│           ├── setup.ts
│           ├── api.test.ts
│           ├── App.test.tsx
│           └── MaskCanvas.test.tsx
├── backend/
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── db.py
│   │   ├── domain/models.py
│   │   ├── domain/state.py
│   │   ├── repositories/tasks.py
│   │   ├── services/task_service.py
│   │   ├── services/storage.py
│   │   ├── services/image_provider.py
│   │   ├── services/cleanup.py
│   │   └── api/routes_tasks.py
│   ├── alembic/versions/0001_initial.py
│   └── tests/
│       ├── conftest.py
│       ├── test_state.py
│       ├── test_tasks_api.py
│       ├── test_storage.py
│       ├── test_image_provider.py
│       └── test_cleanup.py
├── shared/
│   └── task-contract.md
├── infra/
│   └── render.yaml
└── frontend/e2e/
    └── invite-single-photo.spec.ts
```

The GitHub Pages workflow is created at the current repository root as `.github/workflows/cos-ai-retouch-pages.yml`, because GitHub only discovers workflows from the repository-root `.github/workflows/` directory. Its path filter must listen only to `cos-ai-retouch-mvp/**` so unrelated workspace changes do not trigger this deployment.

Each backend service has one responsibility: `storage.py` signs asset URLs, `image_provider.py` owns model-provider differences, `task_service.py` enforces the workflow, `repositories/tasks.py` persists state, and `routes_tasks.py` translates HTTP requests into service calls.

## Task 1: Bootstrap the isolated application tree

**Files:**

- Create: `cos-ai-retouch-mvp/README.md`
- Create: `cos-ai-retouch-mvp/.gitignore`
- Create: `cos-ai-retouch-mvp/frontend/package.json`
- Create: `cos-ai-retouch-mvp/frontend/tsconfig.json`
- Create: `cos-ai-retouch-mvp/frontend/vite.config.ts`
- Create: `cos-ai-retouch-mvp/backend/pyproject.toml`
- Create: `cos-ai-retouch-mvp/shared/task-contract.md`

- [ ] **Step 1: Write the repository contract and local commands**

  Put this exact command contract in `README.md`:

  ```text
  Frontend:
    cd frontend
    npm install
    npm run dev
    npm run test
    npm run build

  Backend:
    cd backend
    python -m venv .venv
    .venv\Scripts\python -m pip install -e .[test]
    .venv\Scripts\python -m pytest -q
    .venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
  ```

  Document that `IMAGE_PROVIDER_MODE=mock` is the safe default and that no image-model key belongs in frontend environment variables.

- [ ] **Step 2: Add the minimal frontend package manifest**

  `frontend/package.json` must define these scripts and dependencies:

  ```json
  {
    "private": true,
    "type": "module",
    "scripts": {
      "dev": "vite",
      "build": "tsc -b && vite build",
      "test": "vitest run",
      "test:watch": "vitest"
    },
    "dependencies": {
      "@vitejs/plugin-react": "latest",
      "react": "latest",
      "react-dom": "latest"
    },
    "devDependencies": {
      "@testing-library/jest-dom": "latest",
      "@testing-library/react": "latest",
      "@testing-library/user-event": "latest",
      "@playwright/test": "latest",
      "jsdom": "latest",
      "typescript": "latest",
      "vite": "latest",
      "vitest": "latest"
    }
  }
  ```

  Pin the resolved versions in `package-lock.json` by running `npm install`; do not commit a hand-written lockfile.

- [ ] **Step 3: Add the Python package manifest and test settings**

  `backend/pyproject.toml` must include FastAPI, Uvicorn, Pydantic Settings, SQLAlchemy, Alembic, boto3, Pillow, pytest, pytest-asyncio, and httpx. Configure pytest to discover `tests/` and run with `asyncio_mode = "auto"`.

- [ ] **Step 4: Verify the empty scaffold**

  Run `npm install` in `frontend` and `python -m pip install -e .[test]` in `backend`.

  Expected: both dependency installs exit with code 0; no file is created outside `cos-ai-retouch-mvp/`.

- [ ] **Step 5: Commit the bootstrap**

  ```bash
  git add cos-ai-retouch-mvp
  git commit -m "chore: bootstrap COS AI retouch MVP"
  ```

## Task 2: Define the shared task contract and backend domain state machine

**Files:**

- Create: `cos-ai-retouch-mvp/shared/task-contract.md`
- Create: `cos-ai-retouch-mvp/backend/app/domain/models.py`
- Create: `cos-ai-retouch-mvp/backend/app/domain/state.py`
- Create: `cos-ai-retouch-mvp/backend/tests/test_state.py`

- [ ] **Step 1: Write failing state-transition tests**

  Cover the valid path and invalid transitions:

  ```python
  def test_task_can_move_from_upload_to_analysis_to_confirmation_to_generation_to_success():
      task = TaskRecord.new()
      task.advance(TaskStatus.UPLOADING)
      task.advance(TaskStatus.ANALYZING)
      task.advance(TaskStatus.AWAITING_CONFIRMATION)
      task.advance(TaskStatus.GENERATING)
      task.advance(TaskStatus.VALIDATING)
      task.advance(TaskStatus.SUCCEEDED)
      assert task.status is TaskStatus.SUCCEEDED

  def test_task_cannot_generate_before_plan_confirmation():
      task = TaskRecord.new()
      task.advance(TaskStatus.UPLOADING)
      task.advance(TaskStatus.ANALYZING)
      with pytest.raises(InvalidTransition):
          task.advance(TaskStatus.GENERATING)
  ```

- [ ] **Step 2: Run the focused tests and verify failure**

  Run: `python -m pytest tests/test_state.py -q`

  Expected: FAIL because `TaskRecord`, `TaskStatus`, and `InvalidTransition` are not implemented.

- [ ] **Step 3: Implement the domain types**

  Define these exact enums and value objects in `models.py`:

  ```python
  class TaskStatus(str, Enum):
      CREATED = "created"
      UPLOADING = "uploading"
      ANALYZING = "analyzing"
      AWAITING_CONFIRMATION = "awaiting_confirmation"
      GENERATING = "generating"
      VALIDATING = "validating"
      SUCCEEDED = "succeeded"
      FAILED = "failed"
      EXPIRED = "expired"

  class Goal(str, Enum):
      NATURAL_RETOUCH = "natural_retouch"
      STRUCTURE_REPAIR = "structure_repair"
  ```

  Define `AnalysisCard`, `Region`, `Operation`, `EditPlan`, `VersionRecord`, and `TaskRecord` with Pydantic models. Coordinates are normalized floats from 0 to 1. `EditPlan.preserve` must default to face identity, composition, main pose, costume design, background structure, original light direction, perspective, depth of field, and noise consistency.

- [ ] **Step 4: Implement the transition table**

  `state.py` must expose `advance(current, next)` or a `TaskRecord.advance(next)` method. The only valid transitions are:

  ```text
  created -> uploading
  uploading -> analyzing | failed
  analyzing -> awaiting_confirmation | failed
  awaiting_confirmation -> generating | failed
  generating -> validating | failed
  validating -> succeeded | failed
  failed -> analyzing | generating | expired
  succeeded -> expired
  ```

  Raise `InvalidTransition` with both status values in the message.

- [ ] **Step 5: Run the focused tests and commit**

  Run: `python -m pytest tests/test_state.py -q`

  Expected: PASS.

  ```bash
  git add cos-ai-retouch-mvp/shared cos-ai-retouch-mvp/backend/app/domain cos-ai-retouch-mvp/backend/tests/test_state.py
  git commit -m "feat: define COS retouch task state"
  ```

## Task 3: Add database models, repository, configuration, and migrations

**Files:**

- Create: `cos-ai-retouch-mvp/backend/app/config.py`
- Create: `cos-ai-retouch-mvp/backend/app/db.py`
- Create: `cos-ai-retouch-mvp/backend/app/repositories/tasks.py`
- Create: `cos-ai-retouch-mvp/backend/alembic.ini`
- Create: `cos-ai-retouch-mvp/backend/alembic/versions/0001_initial.py`
- Modify: `cos-ai-retouch-mvp/backend/tests/conftest.py`
- Create: `cos-ai-retouch-mvp/backend/tests/test_repository.py`

- [ ] **Step 1: Define environment settings**

  `config.py` must expose `Settings` with these names and defaults:

  ```python
  class Settings(BaseSettings):
      database_url: str = "sqlite+aiosqlite:///./cos-retouch-test.db"
      allowed_origins: list[str] = ["http://localhost:5173"]
      invite_tokens: list[str] = []
      asset_ttl_hours: int = 24
      max_upload_bytes: int = 20 * 1024 * 1024
      image_provider_mode: Literal["mock", "external"] = "mock"
      image_provider_api_key: str | None = None
      image_provider_base_url: str | None = None
      image_provider_model: str = "cos-retouch-default"
  ```

  Add storage settings separately: endpoint, bucket, region, access key, secret key, and public URL must be read only from environment variables.

- [ ] **Step 2: Write repository tests before persistence code**

  Test creating a task, attaching an analysis, saving a plan, appending a version, and loading by id. Test that a task that does not exist returns `None` rather than raising a database exception.

- [ ] **Step 3: Implement SQLAlchemy models and repository methods**

  Create tables `tasks`, `assets`, `analysis_cards`, `edit_plans`, and `versions`. Store JSON fields using PostgreSQL JSONB and SQLite-compatible JSON. Repository methods must be:

  ```python
  create_task(task: TaskRecord) -> TaskRecord
  get_task(task_id: UUID) -> TaskRecord | None
  save_analysis(task_id: UUID, cards: list[AnalysisCard]) -> None
  save_plan(task_id: UUID, plan: EditPlan) -> None
  add_version(task_id: UUID, version: VersionRecord) -> None
  mark_expired_before(cutoff: datetime) -> int
  ```

- [ ] **Step 4: Add the initial Alembic migration**

  The migration must create the five tables, UUID task ids, status, timestamps, JSON payloads, and foreign keys from child records to `tasks`. Running `alembic upgrade head` twice must succeed without creating duplicate tables.

- [ ] **Step 5: Run repository tests and migration checks**

  Run: `python -m pytest tests/test_repository.py -q` after adding the repository test file, then run `alembic upgrade head` against a temporary SQLite database.

  Expected: PASS and one complete schema.

- [ ] **Step 6: Commit the persistence layer**

  ```bash
  git add cos-ai-retouch-mvp/backend/app/config.py cos-ai-retouch-mvp/backend/app/db.py cos-ai-retouch-mvp/backend/app/repositories cos-ai-retouch-mvp/backend/alembic.ini cos-ai-retouch-mvp/backend/alembic cos-ai-retouch-mvp/backend/tests
  git commit -m "feat: persist retouch tasks and versions"
  ```

## Task 4: Implement storage signing and image-provider adapters

**Files:**

- Create: `cos-ai-retouch-mvp/backend/app/services/storage.py`
- Create: `cos-ai-retouch-mvp/backend/app/services/image_provider.py`
- Create: `cos-ai-retouch-mvp/backend/tests/test_storage.py`
- Create: `cos-ai-retouch-mvp/backend/tests/test_image_provider.py`

- [ ] **Step 1: Define adapter protocols and tests**

  Storage must expose:

  ```python
  create_upload_url(task_id: UUID, filename: str, content_type: str) -> SignedAsset
  create_download_url(object_key: str) -> str
  delete_object(object_key: str) -> None
  ```

  The image provider must expose:

  ```python
  submit_analysis(source_url: str) -> ProviderJob
  submit_edit(source_url: str, plan: EditPlan) -> ProviderJob
  poll(job_id: str) -> ProviderResult
  ```

  Write tests that assert provider submission is idempotent for the same task operation and that no provider method receives an API key from a frontend request.

- [ ] **Step 2: Implement a fake storage adapter**

  Use an in-memory dictionary in tests. Signed URLs must contain an expiry timestamp and object key. The adapter must reject content types outside `image/jpeg` and `image/png` and reject files over `settings.max_upload_bytes` before signing.

- [ ] **Step 3: Implement the S3-compatible storage adapter**

  Use boto3 presigned URLs. Object keys must follow:

  ```text
  tasks/{task_id}/original/{safe_filename}
  tasks/{task_id}/mask/{mask_id}.json
  tasks/{task_id}/versions/{version_id}.png
  ```

  Strip path components from filenames and never interpolate an untrusted filename into a local path.

- [ ] **Step 4: Implement the deterministic mock provider**

  `MockImageModelProvider` must return analysis cards for a fixed fixture and must return a copied result asset with a provider metadata marker. It is explicitly a workflow/test provider; the UI must display “演示模型结果” when this mode is active.

- [ ] **Step 5: Implement the external provider boundary**

  `ExternalImageModelProvider` must use `image_provider_base_url`, `image_provider_api_key`, and `image_provider_model` from server settings. It must send the structured `EditPlan`, not raw user text, and normalize upstream responses into `ProviderJob` and `ProviderResult`. Non-2xx responses become typed `ProviderError` values without exposing response bodies or secrets to the client.

- [ ] **Step 6: Run adapter tests and commit**

  Run: `python -m pytest tests/test_storage.py tests/test_image_provider.py -q`

  Expected: PASS with mock adapters and HTTP calls mocked by `httpx.MockTransport`.

  ```bash
  git add cos-ai-retouch-mvp/backend/app/services cos-ai-retouch-mvp/backend/tests/test_storage.py cos-ai-retouch-mvp/backend/tests/test_image_provider.py
  git commit -m "feat: add storage and image provider adapters"
  ```

## Task 5: Build the task service and REST API

**Files:**

- Create: `cos-ai-retouch-mvp/backend/app/services/task_service.py`
- Create: `cos-ai-retouch-mvp/backend/app/api/routes_tasks.py`
- Create: `cos-ai-retouch-mvp/backend/app/main.py`
- Modify: `cos-ai-retouch-mvp/backend/tests/conftest.py`
- Create: `cos-ai-retouch-mvp/backend/tests/test_tasks_api.py`
- Modify: `cos-ai-retouch-mvp/shared/task-contract.md`

- [ ] **Step 1: Write API contract tests**

  Cover these endpoints:

  ```text
  GET  /healthz
  POST /api/v1/tasks
  POST /api/v1/tasks/{task_id}/analyze
  GET  /api/v1/tasks/{task_id}
  POST /api/v1/tasks/{task_id}/plan
  POST /api/v1/tasks/{task_id}/generate
  GET  /api/v1/tasks/{task_id}/download
  ```

  A task creation request is:

  ```json
  {
    "invite_token": "invite-demo",
    "filename": "cos-photo.jpg",
    "content_type": "image/jpeg",
    "byte_size": 1200000
  }
  ```

  Assert that a missing or invalid invite token returns 401, an invalid file returns 400, and a valid response contains `task_id`, `upload_url`, `expires_at`, and `status: "uploading"`.

- [ ] **Step 2: Run API tests and verify failure**

  Run: `python -m pytest tests/test_tasks_api.py -q`

  Expected: FAIL because the FastAPI routes and service are not implemented.

- [ ] **Step 3: Implement the task service**

  The service must enforce these server-side rules:

  ```text
  create -> upload URL -> analyze -> awaiting_confirmation
  awaiting_confirmation -> plan -> generate -> validating -> succeeded
  ```

  It must reject generation without a saved plan, reject plans with no enabled module, cap candidate versions at two, and keep the original asset untouched. The service owns idempotency keys for `analyze` and `generate`; repeating a request returns the existing job instead of creating a duplicate provider job.

- [ ] **Step 4: Implement routes and application wiring**

  `main.py` must configure CORS from `allowed_origins`, expose `/healthz`, create the database session, and inject the repository, storage adapter, and provider adapter. `routes_tasks.py` must return stable JSON errors in this shape:

  ```json
  {
    "error": {
      "code": "TASK_NOT_READY",
      "message": "请先确认修图区域和处理目标。"
    }
  }
  ```

  The API must never return `image_provider_api_key`, storage credentials, local file paths, or raw upstream error bodies.

- [ ] **Step 5: Run the API test suite and commit**

  Run: `python -m pytest tests/test_state.py tests/test_tasks_api.py -q`

  Expected: PASS.

  ```bash
  git add cos-ai-retouch-mvp/backend/app cos-ai-retouch-mvp/backend/tests cos-ai-retouch-mvp/shared/task-contract.md
  git commit -m "feat: expose retouch task workflow API"
  ```

## Task 6: Build the invite gate, upload flow, and analysis cards

**Files:**

- Create: `cos-ai-retouch-mvp/frontend/src/app/config.ts`
- Create: `cos-ai-retouch-mvp/frontend/src/app/api.ts`
- Create: `cos-ai-retouch-mvp/frontend/src/domain/task.ts`
- Create: `cos-ai-retouch-mvp/frontend/src/components/InviteGate.tsx`
- Create: `cos-ai-retouch-mvp/frontend/src/components/UploadPanel.tsx`
- Create: `cos-ai-retouch-mvp/frontend/src/components/AnalysisPanel.tsx`
- Create: `cos-ai-retouch-mvp/frontend/src/components/TaskProgress.tsx`
- Create: `cos-ai-retouch-mvp/frontend/src/app/App.tsx`
- Create: `cos-ai-retouch-mvp/frontend/src/main.tsx`
- Create: `cos-ai-retouch-mvp/frontend/src/styles.css`
- Create: `cos-ai-retouch-mvp/frontend/src/test/setup.ts`
- Create: `cos-ai-retouch-mvp/frontend/src/test/api.test.ts`
- Create: `cos-ai-retouch-mvp/frontend/src/test/App.test.tsx`

- [ ] **Step 1: Write frontend API and state tests**

  Mock `fetch` and verify that the client sends the invite token only in the request body/header to Render, never to an image-model endpoint. Verify that `createTask()` returns a typed task and that `getTask()` maps `failed` into a readable error state.

- [ ] **Step 2: Implement the typed API client**

  `api.ts` must provide these functions:

  ```ts
  createTask(input: CreateTaskInput, inviteToken: string): Promise<TaskView>
  startAnalysis(taskId: string): Promise<void>
  getTask(taskId: string): Promise<TaskView>
  savePlan(taskId: string, plan: EditPlan): Promise<void>
  startGeneration(taskId: string): Promise<void>
  getDownloadUrl(taskId: string): Promise<string>
  ```

  Use `VITE_API_BASE_URL` from `config.ts`. Keep the invite token in React state only; do not persist it to localStorage.

- [ ] **Step 3: Implement the invite gate and upload panel**

  The invite gate has one input and one button. The upload panel accepts only JPG/PNG, validates 20 MB before calling the API, shows the original preview, and uploads the file to the returned signed URL. After upload, call `startAnalysis()` and show a progress state.

- [ ] **Step 4: Implement analysis cards and goal selection**

  Render categories for face, hair, clothing, body/pose, background, and lighting. Each card has enable/disable, confidence, risk text, and region highlight. The goal selector offers natural retouch, structure repair, or both. Do not render raw prompt JSON in the normal screen.

- [ ] **Step 5: Run frontend tests and commit**

  Run: `npm run test`

  Expected: PASS.

  ```bash
  git add cos-ai-retouch-mvp/frontend/src
  git commit -m "feat: add invite upload and analysis workflow"
  ```

## Task 7: Implement region confirmation and mask editing

**Files:**

- Create: `cos-ai-retouch-mvp/frontend/src/components/MaskCanvas.tsx`
- Create: `cos-ai-retouch-mvp/frontend/src/test/MaskCanvas.test.tsx`
- Modify: `cos-ai-retouch-mvp/frontend/src/components/AnalysisPanel.tsx`
- Modify: `cos-ai-retouch-mvp/frontend/src/app/App.tsx`
- Modify: `cos-ai-retouch-mvp/shared/task-contract.md`

- [ ] **Step 1: Write mask geometry tests**

  Verify pointer coordinates are normalized against the displayed image size, undo removes only the last stroke, erase mode marks strokes as erased, and an empty mask cannot be submitted for structure repair.

- [ ] **Step 2: Implement the canvas contract**

  Store strokes in this exact shape:

  ```ts
  type MaskStroke = {
    mode: "add" | "erase";
    width: number;
    points: Array<{ x: number; y: number }>;
  };
  ```

  `MaskCanvas` receives the original image URL, AI regions, strokes, and `onChange`. It draws the image, translucent AI regions, and user strokes on separate canvas layers. It must preserve normalized geometry when the browser resizes.

- [ ] **Step 3: Add region confirmation and intensity controls**

  Provide “自然 / 标准 / 明显” controls mapped to 25, 55, and 80. The UI must display the protected items as an always-visible checklist: face identity, costume design, main pose, composition, background structure, light direction, perspective, and noise.

- [ ] **Step 4: Build the structured edit plan**

  Convert selected cards and strokes into `EditPlan` with enabled operations, region ids, intensity, preserve list, integration rules, and validation checks. User-entered free text is optional and must be limited to 500 characters; it is a supplement to the structured plan, not the sole instruction.

- [ ] **Step 5: Run mask and app tests, then commit**

  Run: `npm run test`

  Expected: PASS, including the empty-mask validation.

  ```bash
  git add cos-ai-retouch-mvp/frontend/src/components cos-ai-retouch-mvp/frontend/src/app cos-ai-retouch-mvp/frontend/src/test/MaskCanvas.test.tsx cos-ai-retouch-mvp/shared/task-contract.md
  git commit -m "feat: add controllable COS edit regions"
  ```

## Task 8: Add generation, validation display, comparison, rollback, and download

**Files:**

- Create: `cos-ai-retouch-mvp/frontend/src/components/ResultPanel.tsx`
- Modify: `cos-ai-retouch-mvp/frontend/src/components/TaskProgress.tsx`
- Modify: `cos-ai-retouch-mvp/frontend/src/app/App.tsx`
- Create: `cos-ai-retouch-mvp/backend/app/services/cleanup.py`
- Create: `cos-ai-retouch-mvp/backend/tests/test_cleanup.py`
- Modify: `cos-ai-retouch-mvp/backend/app/services/task_service.py`
- Modify: `cos-ai-retouch-mvp/backend/app/api/routes_tasks.py`

- [ ] **Step 1: Write backend generation and cleanup tests**

  Test that generation returns at most two versions, that provider failures produce a typed retryable error, and that `cleanup_expired_assets()` deletes original/mask/result objects for tasks older than 24 hours while retaining no download URL.

- [ ] **Step 2: Implement provider polling and validation records**

  After `generate`, store a provider job id and move the task to `generating`. On status polling, map provider completion to `validating`, run the validation adapter, save `VersionRecord`, and return `succeeded` with checks:

  ```json
  {
    "face_identity": "pass",
    "pose_and_composition": "pass",
    "hands_and_costume": "review",
    "background_geometry": "pass",
    "lighting_and_noise": "review"
  }
  ```

  The first validator is deterministic metadata validation for the mock provider; the interface must leave room for a vision-based validator later.

- [ ] **Step 3: Implement the result panel**

  Show two candidate versions at most, a draggable before/after comparison, a zoom control, validation labels, “保留此版本”, “重新生成”, and “恢复原图”. The original image must always remain the left side of the comparison and must never be replaced by a generated asset.

- [ ] **Step 4: Add download and expiry behavior**

  Download requests return a short-lived signed URL only for successful, unexpired tasks. Expired tasks show a clear message and require a new upload. Run cleanup on task creation and provide a protected `POST /api/v1/maintenance/cleanup` endpoint for a scheduled Render call.

- [ ] **Step 5: Run tests and commit**

  Run: `python -m pytest -q` and `npm run test`.

  Expected: PASS.

  ```bash
  git add cos-ai-retouch-mvp/backend/app cos-ai-retouch-mvp/backend/tests cos-ai-retouch-mvp/frontend/src
  git commit -m "feat: add result review and asset expiry"
  ```

## Task 9: Add end-to-end smoke coverage and UX error states

**Files:**

- Create: `cos-ai-retouch-mvp/frontend/e2e/invite-single-photo.spec.ts`
- Modify: `cos-ai-retouch-mvp/frontend/src/app/App.tsx`
- Modify: `cos-ai-retouch-mvp/frontend/src/components/TaskProgress.tsx`
- Modify: `cos-ai-retouch-mvp/backend/app/api/routes_tasks.py`
- Modify: `cos-ai-retouch-mvp/README.md`

- [ ] **Step 1: Write the Playwright smoke flow**

  The test must use the mock provider and cover:

  ```text
  open app -> enter invite -> select a fixture JPG -> see analysis cards
  -> select natural retouch and structure repair -> draw one mask stroke
  -> submit plan -> see result -> compare -> request download URL
  ```

- [ ] **Step 2: Add explicit user-facing failure states**

  Map these codes to Chinese messages and a recovery action: `INVALID_INVITE`, `UNSUPPORTED_IMAGE`, `UPLOAD_FAILED`, `ANALYSIS_FAILED`, `TASK_NOT_READY`, `PROVIDER_TIMEOUT`, `PROVIDER_QUOTA`, `VALIDATION_REVIEW`, and `TASK_EXPIRED`. Never show a Python traceback, provider response body, or storage URL without expiry.

- [ ] **Step 3: Run all local verification**

  Run:

  ```bash
  cd backend
  python -m pytest -q
  cd ..\frontend
  npm run test
  npm run build
  cd ..
  cd frontend
  npx playwright test e2e/invite-single-photo.spec.ts
  ```

  Expected: backend tests pass, frontend tests pass, frontend build succeeds, and the mock-provider browser flow completes.

- [ ] **Step 4: Commit the integrated local MVP**

  ```bash
  git add cos-ai-retouch-mvp
  git commit -m "test: verify invite-only COS retouch workflow"
  ```

## Task 10: Configure GitHub Pages and Render deployment

**Files:**

- Create: `.github/workflows/cos-ai-retouch-pages.yml`
- Create: `cos-ai-retouch-mvp/infra/render.yaml`
- Modify: `cos-ai-retouch-mvp/frontend/vite.config.ts`
- Modify: `cos-ai-retouch-mvp/README.md`

- [ ] **Step 1: Configure the static build**

  `vite.config.ts` must use the repository-name base path when `GITHUB_ACTIONS=true`, otherwise `/` for local development. The Pages workflow must run `npm ci`, `npm run build`, upload `frontend/dist`, and deploy it with the official Pages actions. It must pass `VITE_API_BASE_URL` as a GitHub Actions variable, never a secret.

- [ ] **Step 2: Configure the Render API service**

  `infra/render.yaml` must define one web service with:

  ```yaml
  type: web
  runtime: python
  rootDir: cos-ai-retouch-mvp/backend
  buildCommand: pip install -e .
  startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT
  healthCheckPath: /healthz
  ```

  Declare `DATABASE_URL`, `ALLOWED_ORIGINS`, `INVITE_TOKENS`, storage credentials, `IMAGE_PROVIDER_MODE`, `IMAGE_PROVIDER_BASE_URL`, `IMAGE_PROVIDER_MODEL`, and `IMAGE_PROVIDER_API_KEY` as environment variables. Secret values must be entered in Render, not committed.

- [ ] **Step 3: Add deployment smoke checks**

  After deployment, set `RENDER_API_URL` to the actual Render service URL and verify:

  ```text
  Invoke-WebRequest "$env:RENDER_API_URL/healthz" -> StatusCode 200
  Pages frontend loads over HTTPS
  OPTIONS task request returns the expected CORS origin
  invalid invite returns 401
  mock analysis can create a task without exposing secrets
  ```

  Do not store uploaded images on Render's local filesystem. Do not treat a free Render service's cold start or ephemeral storage as production durability.

- [ ] **Step 4: Document the small-scale deployment boundary**

  README must state that GitHub Pages is only for the invite-only validation phase, Render free services may sleep, and object storage is required for original/result assets. Add the migration step to Render Static Site before commercial public launch.

- [ ] **Step 5: Run final verification and commit**

  Run `git diff --check`, `npm run build`, `python -m pytest -q`, and the deployed `/healthz` request.

  Expected: no whitespace errors, all local tests pass, the build artifact exists, and the live health check returns 200.

  ```bash
  git add cos-ai-retouch-mvp/.github cos-ai-retouch-mvp/infra cos-ai-retouch-mvp/frontend/vite.config.ts cos-ai-retouch-mvp/README.md
  git commit -m "chore: configure Pages and Render MVP deployment"
  ```

## Task 11: Final product QA and handoff

**Files:**

- Modify: `cos-ai-retouch-mvp/README.md`
- Create: `cos-ai-retouch-mvp/docs/qa-checklist.md`

- [ ] **Step 1: Create the 20-image QA checklist**

  Include half-body, full-body, wig, armor/complex costume, indoor, outdoor, and night-scene cases. For each image record whether face identity, pose/composition, hands/costume, background geometry, and lighting/noise passed or require review.

- [ ] **Step 2: Run the product acceptance flow**

  A tester without prompt-writing experience must complete one natural-retouch + one structure-repair task in ten minutes or less, using only cards, region controls, intensity, and the review screen. Confirm that the original is recoverable after every failure and that a generated result is never presented without its validation status.

- [ ] **Step 3: Record known limitations**

  Document that mock-provider output is for workflow verification, not image-quality evaluation; external-provider quality depends on the selected model; pose repair remains local/region-bounded; and PSD export, batch processing, accounts, billing, and local GPU inference are outside this MVP.

- [ ] **Step 4: Run the final command set**

  ```bash
  git diff --check
  cd cos-ai-retouch-mvp/backend
  python -m pytest -q
  cd ..\frontend
  npm run test
  npm run build
  cd ..
  git status --short
  ```

  Expected: all tests/builds pass; `git status` contains only intentionally generated lockfiles or documented local configuration files.

- [ ] **Step 5: Commit the QA handoff**

  ```bash
  git add cos-ai-retouch-mvp/docs cos-ai-retouch-mvp/README.md
  git commit -m "docs: add COS retouch MVP QA handoff"
  ```

## Spec coverage review

| Design requirement | Plan coverage |
|---|---|
| Invite-only, no registration, single image | Tasks 1, 5, 6, 9, 10 |
| Natural retouch | Tasks 2, 5, 6, 7, 8 |
| Structural repair | Tasks 2, 5, 6, 7, 8 |
| AI analysis cards | Tasks 4, 5, 6 |
| Region/mask confirmation | Task 7 |
| Preserve face, pose, costume, composition, light, perspective, noise | Tasks 2, 7, 8 |
| Two candidates and two automatic retries | Tasks 4, 5, 8 |
| Before/after, rollback, download | Task 8 |
| Validation and human review flags | Task 8 |
| 24-hour asset expiry | Task 8 |
| Render API and external object storage | Tasks 3, 4, 10 |
| GitHub Pages invite-only frontend validation | Task 10 |
| Tests and 20-image QA | Tasks 9 and 11 |

Self-review result: no unresolved placeholders, no task depends on an undefined function or status name, and all requirements from the approved design have a corresponding implementation or QA task.
