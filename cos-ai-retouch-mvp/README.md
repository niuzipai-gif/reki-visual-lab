# COS AI Retouch MVP

This repository contains an open-by-default, single-photo COS retouch MVP. The guided workflow analyzes one JPG or PNG, while the browser workstation provides non-destructive layers, masks, local adjustments, editable presets, JPG export, layered PSD export, and an AURA project JSON sidecar. The original image remains untouched so results can be compared and rolled back. To restore strict invite validation for the guided cloud workflow, set `REQUIRE_INVITE_TOKENS=true` and configure `INVITE_TOKENS`.

The application is intentionally split into a React/Vite frontend, a FastAPI backend, an S3-compatible storage boundary, a quota-safe workflow planner, and a server-only image-provider boundary. The frontend never calls an image model directly. MiniMax text planning is enabled on the small Render deployment, while image generation is spent only after the user confirms an AI layer and clicks the cloud execution button.

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

## Browser editor and open-source boundaries

The editor runs entirely in the browser. It stores normalized mask strokes and
adjustment values as serializable state, renders a live Canvas 2D preview, and
uses the MIT-licensed [`ag-psd`](https://github.com/Agamnentzar/ag-psd) library
for layered PSD writing. The planner endpoint is `POST /api/v1/workflows/plan`;
it returns bounded operations and explicitly reports zero image-generation
calls. Local filters cover exposure, contrast, saturation, temperature,
sharpness, grain, vignette, blend modes, and rasterized brush masks. AI-only
modules are represented as visible, editable task layers. The editor can
submit selected AI layers through the task workflow, show returned versions
under the canvas, import an AURA project JSON sidecar, and export the current
layered document as PSD. Local adjustments and masks remain usable without
spending an image-generation call.

## Provider and secret boundary

`IMAGE_PROVIDER_MODE=mock` is the safe default for local development and
browser tests. Render uses `IMAGE_PROVIDER_MODE=minimax` with the `image-01`
reference-image generation endpoint. The editor submits one server-generated,
bounded prompt with one `subject_reference` image; Render downloads the
returned image URL and stores it behind the task's signed asset bridge. The
provider path is whole-image reference generation, not pixel-perfect masked
inpainting, so the browser mask is a localized editing instruction and preview
boundary rather than a guarantee that the upstream model will edit only those
pixels. The text planner uses MiniMax's OpenAI-compatible chat endpoint with
`MiniMax-M2.7`; it never invokes image generation and falls back to
deterministic rules if unavailable.

External-provider credentials belong only in backend/server environment
variables. No image-model API key belongs in frontend environment variables,
source code, repository history, Pages variables, or browser requests.

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
Dashboard. For a small no-S3 validation deployment, set
`RUNTIME_ENVIRONMENT=development`, `STORAGE_PUBLIC_URL` to the Render service
URL, and a private `STORAGE_SIGNING_SECRET`; the backend then exposes a
short-lived signed bridge for the original image. This is ephemeral and not
appropriate for durable storage. To enable MiniMax, set
`IMAGE_PROVIDER_MODE=minimax`, `IMAGE_PROVIDER_BASE_URL=https://api.minimaxi.com/v1`,
`IMAGE_PROVIDER_MODEL=image-01`, and `IMAGE_PROVIDER_API_KEY`. Keep the API key
in Render's secret environment settings only; never put it in this README, the
repository, Pages variables, or browser code. Invite validation is open by
default; set `REQUIRE_INVITE_TOKENS=true` and configure `INVITE_TOKENS` to restore
strict validation.

Before a commercial public launch, move the frontend to a Render Static Site
(or equivalent production static host) and migrate to persistent production
infrastructure for database, object storage, and any required background
processing. Do not treat a free Render instance or its filesystem as durable
production infrastructure.

### Deployment smoke checklist

Run these checks only after an authorized deployment and set
`RENDER_API_URL` to the actual Render service URL:

- [x] `GET $RENDER_API_URL/healthz` returns HTTP 200.
- [x] The Pages URL loads over HTTPS and serves the built frontend under its
      repository base path.
- [x] An `OPTIONS` task request returns the expected configured CORS origin.
- [ ] With `REQUIRE_INVITE_TOKENS=true` and `INVITE_TOKENS` configured, an invalid invite token returns HTTP 401. This is an opt-in hardening check; the current small deployment is open by design.
- [x] The live planner returns a bounded plan with `image_generation_calls=0`.
- [x] A live MiniMax image task completes through upload, reference-image
      generation, server-side result transfer, and version storage.

## Final known limitations and acceptance boundary

This section defines the current MVP handoff boundary. The automated and live
checks above establish that the workflow is deployed and usable; they do not
turn a small Render service into production-grade media infrastructure or
guarantee identical visual quality for every cosplay photograph.

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
- Batch processing, user accounts, billing, and local GPU inference are outside
  this MVP and are not acceptance requirements for this release. Layered PSD
  export is included in the browser editor and should be verified by opening a
  generated file in a PSD-capable editor.
- The live deployment uses an in-memory asset bridge for this small validation
  environment. It is suitable for low-volume testing only; persistent S3
  storage, managed database sizing, background workers, accounts, billing,
  batch processing, and local GPU inference remain outside this MVP.

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
- **Deployment acceptance:** the current boundary is established by the live
  Pages load, Render health/CORS checks, MiniMax planner smoke, and one real
  end-to-end MiniMax image task. Repeat visual QA with representative cosplay
  images before treating the output as production quality.

## Scope

This MVP still does not include accounts, payments, public sharing, batch
processing, persistent production storage, pixel-perfect provider-side masked
inpainting, or local GPU inference. PSD export, browser masks, local adjustment
filters, editable presets, MiniMax text planning, and the explicit cloud image
execution path are included.
The shared workflow contract is documented in [`shared/task-contract.md`](shared/task-contract.md).
