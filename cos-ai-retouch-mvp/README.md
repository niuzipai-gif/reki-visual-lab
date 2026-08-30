# COS AI Retouch MVP

This repository contains an invite-only, single-photo COS retouch MVP. The guided workflow analyzes one JPG or PNG, lets the user confirm natural-retouch and structure-repair regions, and sends a structured edit plan to a server-side image-provider adapter. The original image remains untouched so results can be compared and rolled back.

The application is intentionally split into a React/Vite frontend, a FastAPI backend, S3-compatible object storage, and an image-provider boundary. The frontend must never call an image model directly.

## Local development

Node.js 20+ and Python 3.11+ are required.

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

## Provider and secret boundary

`IMAGE_PROVIDER_MODE=mock` is the safe default for local development and browser tests. It provides deterministic workflow behavior without requiring an external image service. External-provider credentials belong only in backend/server environment variables. No image-model API key belongs in frontend environment variables, source code, or browser requests.

Uploaded originals, masks, and generated versions are intended for S3-compatible object storage rather than the backend's local filesystem. The initial asset-retention target is 24 hours.

## Scope

This MVP does not include accounts, payments, public sharing, batch processing, PSD export, or a prompt editor. The shared workflow contract is documented in [`shared/task-contract.md`](shared/task-contract.md).
