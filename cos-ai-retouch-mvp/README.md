# COS AI Retouch MVP

This repository contains an invite-only, single-photo COS retouch MVP. The guided workflow analyzes one JPG or PNG, lets the user confirm natural-retouch and structure-repair regions, and sends a structured edit plan to a server-side image-provider adapter. The original image remains untouched so results can be compared and rolled back.

The application is intentionally split into a React/Vite frontend, a FastAPI backend, S3-compatible object storage, and an image-provider boundary. The frontend must never call an image model directly.

## Full-MVP local commands

Node.js 20+ and Python 3.11+ are required.

The commands below are the full-MVP development, test, and build commands. They become runnable after later tasks add the frontend `src/`, backend `app/`, and test files. This bootstrap task intentionally does not add application UI or business logic.

Frontend:

```text
cd frontend
npm install
npm run dev
npm run test
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

## Current bootstrap verification

At this bootstrap stage, only the project manifests and shared contract exist. Run these checks from the corresponding directories to verify the dependency metadata and lockfile without expecting the full application commands above to run yet:

Frontend:

```text
cd frontend
npm ci --dry-run
```

Backend:

```text
cd backend
python -m pip install -e .[test]
```

## Provider and secret boundary

`IMAGE_PROVIDER_MODE=mock` is the safe default for local development and browser tests. It provides deterministic workflow behavior without requiring an external image service. External-provider credentials belong only in backend/server environment variables. No image-model API key belongs in frontend environment variables, source code, or browser requests.

Uploaded originals, masks, and generated versions are intended for S3-compatible object storage rather than the backend's local filesystem. The initial asset-retention target is 24 hours.

## Scope

This MVP does not include accounts, payments, public sharing, batch processing, PSD export, or a prompt editor. The shared workflow contract is documented in [`shared/task-contract.md`](shared/task-contract.md).
