# Shared Task Contract

## Product

An invite-only, single-photo COS retouch workflow. A user uploads one JPG or PNG, reviews structured analysis, confirms bounded regions and goals, then receives a generated version while the original remains recoverable.

## Goals

The initial goal enum is:

- `natural_retouch`
- `structure_repair`

## Task statuses

The task status enum is:

`created` → `uploading` → `analyzing` → `awaiting_confirmation` → `generating` → `validating` → `succeeded`

Failure and retention states are `failed` and `expired`.

## Boundaries

- **Frontend:** React/Vite presents the invite gate, upload flow, analysis cards, region confirmation, progress, comparison, rollback, and download. It sends structured user choices to the API and never receives or stores image-model credentials.
- **API:** FastAPI authenticates invite tokens, owns task state and idempotency, validates inputs, persists metadata, calls the provider adapter, and returns short-lived asset URLs and user-safe errors.
- **Storage:** An S3-compatible object-storage adapter owns original, mask, and version objects plus signed upload/download URLs. The backend's local filesystem is not an asset store.
- **Provider:** A server-side adapter accepts structured analysis/edit requests. `mock` is the deterministic local default; an external image provider is isolated behind the same interface and its key stays server-side.
