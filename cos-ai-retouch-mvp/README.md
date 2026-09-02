# COS AI Retouch MVP

This repository contains an open-by-default, single-photo COS retouch MVP. The guided workflow analyzes one JPG or PNG, lets the user confirm natural-retouch and structure-repair regions, and sends a structured edit plan to a server-side image-provider adapter. The original image remains untouched so results can be compared and rolled back. To restore strict invite validation, set `REQUIRE_INVITE_TOKENS=true` and configure `INVITE_TOKENS`.

The application is intentionally split into a React/Vite frontend, a FastAPI backend, S3-compatible object storage, and an image-provider boundary. The frontend must never call an image model directly.

## Full-MVP local commands

Node.js 20+ and Python 3.11+ are required.

The commands below are the full-MVP development, test, and build commands.

Frontend:

```text
cd frontend
npm install
npm run dev
npm run test -- --run
npm run build
```

Backend:

```text
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -e .[test]
.venv\Scripts\python -m pytest -q
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

## Browser smoke verification

The browser smoke uses the deterministic mock-provider contract through
Playwright route interception. It uploads only the checked-in 160×120 solid
color fixture at `frontend/e2e/fixtures/cos-smoke.jpg`; it never calls MinMax or
requires an image-provider key.

```text
cd frontend
npm install
npx playwright install chromium
npx playwright test e2e/invite-single-photo.spec.ts
```

The flow covers fixture selection, analysis cards, both bounded retouch goals,
one normalized mask stroke, plan submission, result comparison, and requesting
an expiring download URL. When strict invite validation is enabled, it can also
cover invite entry. For a visible CLI-first run, add
`--headed`; the local Vite server is started automatically by
`playwright.config.ts`.

Backend checks remain independent of browser provider credentials:

```text
cd backend
python -m pytest -q
python -m ruff check app tests
python -m compileall -q app tests
```

## Provider and secret boundary

`IMAGE_PROVIDER_MODE=mock` is the safe default for local development and browser tests. It provides deterministic workflow behavior without requiring an external image service. External-provider credentials belong only in backend/server environment variables. No image-model API key belongs in frontend environment variables, source code, or browser requests.

Uploaded originals, masks, and generated versions are intended for S3-compatible object storage rather than the backend's local filesystem. The initial asset-retention target is 24 hours.

## Small-scale deployment

GitHub Pages is reserved for internal validation of this MVP. It
is not a commercial public deployment. The Pages workflow builds from
`cos-ai-retouch-mvp/frontend` and reads the repository Actions variable
`VITE_API_BASE_URL` from `${{ vars.VITE_API_BASE_URL }}`; add that value under
GitHub repository **Settings → Secrets and variables → Actions → Variables**,
not under Secrets. The Vite configuration uses the final segment of the
Actions-provided `GITHUB_REPOSITORY` as the Pages base path (for example,
`/<repository>/`), and uses `/` during local development. This avoids
hard-coding a repository name into the frontend.

The Render Blueprint is at [`infra/render.yaml`](infra/render.yaml) and
defines one small `free` Python web service. When creating the Blueprint in
Render, set the custom **Blueprint Path** to
`cos-ai-retouch-mvp/infra/render.yaml`. Render free services can sleep
and have cold starts, so they are suitable for low-volume validation only.
The Blueprint sets `RUNTIME_ENVIRONMENT=production`; the API refuses to start
without `STORAGE_BUCKET` in that environment instead of silently using its
in-memory test adapter. Render's local filesystem is ephemeral: originals, masks, and generated
results must be stored in S3-compatible object storage, and no Render disk is
configured for image persistence.

The Blueprint intentionally leaves runtime configuration for the Render
Dashboard. In the service's **Environment** settings, add
`IMAGE_PROVIDER_API_KEY` with the exact key supplied by the provider, then
save and redeploy the service. Keep this value in Render's secret environment
settings only; never put it in this README, the repository, Pages variables,
or browser code. Fill `DATABASE_URL`, `ALLOWED_ORIGINS`, and the storage
credentials there as well. Invite validation is open by default; set
`REQUIRE_INVITE_TOKENS=true` and configure `INVITE_TOKENS` to restore strict
validation. For the mock provider smoke flow,
keep `IMAGE_PROVIDER_MODE=mock`; switch to `external` only after the provider
endpoint, model, and API key have been configured server-side.

Before a commercial public launch, move the frontend to a Render Static Site
(or equivalent production static host) and migrate to persistent production
infrastructure for database, object storage, and any required background
processing. Do not treat a free Render instance or its filesystem as durable
production infrastructure.

### Deployment smoke checklist

Run these checks only after an authorized deployment and set
`RENDER_API_URL` to the actual Render service URL:

- [ ] `GET $RENDER_API_URL/healthz` returns HTTP 200.
- [ ] The Pages URL loads over HTTPS and serves the built frontend under its
      repository base path.
- [ ] An `OPTIONS` task request returns the expected configured CORS origin.
- [ ] With `REQUIRE_INVITE_TOKENS=true` and `INVITE_TOKENS` configured, an invalid invite token returns HTTP 401.
- [ ] Mock analysis can create and advance a task without exposing provider or
      storage secrets to the browser.

This Task 10 configuration has not executed a real GitHub Pages or Render
deployment; the checklist above remains pending live-environment verification.

## Final known limitations and acceptance boundary

This section defines the final MVP handoff boundary. It records what can be
accepted from the current workflow and what still requires an authorized,
real-environment or model-backed check; it does not claim that those checks
have already been run.

- `IMAGE_PROVIDER_MODE=mock` verifies the workflow, API state transitions,
  masking, and result-handling path only. A mock result is not evidence of
  image quality and must not be used to pass the 20-image visual QA checklist.
- External-provider image quality depends on the selected model, endpoint,
  parameters, provider availability, and the input image. This MVP owns the
  server-side provider boundary and validation status; it does not guarantee a
  particular visual result across models.
- Pose repair is local and region-bounded. It requires a confirmed region and
  mask, and does not authorize full-body redraw, unrestricted pose generation,
  camera changes, or silent expansion into unrelated image areas.
- PSD export, batch processing, user accounts, billing, and local GPU
  inference are outside this MVP and are not acceptance requirements for this
  release.
- Real GitHub Pages and Render smoke verification is still pending authorized
  deployment. Local tests, configuration, or a successful build must not be
  reported as proof that the live Pages/Render path has been deployed or
  verified.

### Acceptance boundary

- **Workflow acceptance:** the open-by-default, single-photo flow can be checked
  locally with the deterministic mock provider, including bounded plan
  submission, result comparison, original-image recovery, and visible
  validation status.
- **Visual acceptance:** use an external provider/model and complete every row
  in [`docs/qa-checklist.md`](docs/qa-checklist.md). A photo passes only when
  face identity, pose/composition, hands/costume, background geometry, and
  lighting/noise are all recorded as `pass`; any unresolved `review` blocks
  handoff.
- **Deployment acceptance:** only an authorized live run of the Pages URL,
  Render health/CORS/auth checks, and a mock task smoke can establish the
  deployment boundary. Until then, the live-environment result remains
  pending.

## Scope

This MVP does not include accounts, payments, public sharing, batch processing, PSD export, or a prompt editor. The shared workflow contract is documented in [`shared/task-contract.md`](shared/task-contract.md).
