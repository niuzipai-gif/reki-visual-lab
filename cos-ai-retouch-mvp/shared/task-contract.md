# COS AI Retouch MVP Task Contract

## Product and goals

The MVP is an invite-only, single-photo COS retouch workflow. A user uploads one
JPG or PNG, reviews AI analysis cards, confirms bounded regions and goals, then
receives one or two generated candidates. The original is immutable and remains
recoverable. The supported goals are:

- `natural_retouch`: bounded face, skin, hair, clothing-detail, body-detail, or
  light cleanup that keeps the person and scene recognizable.
- `structure_repair`: bounded repair of hands, feet, pose connections, clothing
  joins, props, or other local geometry; it never authorizes full-image redraw.

## Statuses and transitions

The task status is one of these exact strings:

| Status | Meaning |
| --- | --- |
| `created` | Task record exists; no upload has started. |
| `uploading` | The API has issued an upload URL and awaits the original asset. |
| `analyzing` | The provider is producing structured analysis cards. |
| `awaiting_confirmation` | Analysis is ready; the user must confirm goals, regions, and intensity. |
| `generating` | A confirmed edit plan is being sent to the provider. |
| `validating` | A candidate is being checked for identity, geometry, clothing, background, light, and noise. |
| `succeeded` | At least one candidate passed generation and is available for review/download. |
| `failed` | A retryable or terminal error was recorded; recovery may re-enter analysis or generation. |
| `expired` | Original, mask, and result assets are no longer available. |

Allowed transitions are:

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

## JSON shapes

All timestamps are ISO-8601 UTC strings. `UUID` means a UUID string. These are
wire shapes; provider prompts and credentials are never part of the public task.

### Asset URL

An asset URL is short-lived and returned only by the API:

```pseudo-json
{
  "kind": "original",
  "url": "https://storage.example.test/signed/object?signature=...",
  "expires_at": "2026-08-30T12:30:00Z"
}
```

`kind` is `original`, `mask`, or `version`. Storage object keys may be retained
internally, but a client receives a signed URL with an expiry.

### Region

`x`, `y`, `width`, and `height` are normalized floats in the inclusive range
`0.0..1.0`, relative to the original image's width and height:

```pseudo-json
{
  "id": "face-1",
  "label": "face",
  "x": 0.25,
  "y": 0.20,
  "width": 0.30,
  "height": 0.40,
  "source": "analysis",
  "mask_asset_url": null
}
```

The browser converts display pixels to this form before sending them. It must
not send screen pixels or re-scale coordinates after a responsive resize.
When present, `mask_asset_url` is an Asset URL whose `kind` is `mask`.

### Analysis card

```pseudo-json
{
  "id": "card-face-1",
  "category": "face",
  "title": "Face detail",
  "summary": "Minor skin detail near the cheek.",
  "confidence": 0.92,
  "risk": "Keep face identity unchanged.",
  "enabled": false,
  "regions": [/* Region */]
}
```

Cards are suggestions. They are not automatically enabled, and low-confidence
regions require explicit user confirmation.

### Operation and edit plan

```pseudo-json
{
  "goals": ["natural_retouch", "structure_repair"],
  "preserve": [
    "face identity",
    "composition",
    "main pose",
    "costume design",
    "background structure",
    "original light direction",
    "perspective",
    "depth of field",
    "noise consistency"
  ],
  "regions": [/* Region */],
  "operations": [
    {
      "id": "UUID",
      "kind": "skin_retouch",
      "goal": "natural_retouch",
      "region_ids": ["face-1"],
      "intensity": 55,
      "enabled": true,
      "instructions": null
    }
  ],
  "intensity": 55,
  "integration": [
    "original light direction",
    "perspective",
    "depth of field",
    "noise consistency"
  ],
  "validation": [
    "face identity",
    "pose and composition",
    "hands and costume",
    "background geometry",
    "lighting and noise"
  ],
  "notes": null
}
```

`intensity` and operation intensity are integers from `0..100`; the UI maps
自然 / 标准 / 明显 to `25 / 55 / 80`. `notes` is optional and capped at 500
characters. A structure-repair operation must reference a confirmed local
region; the domain rejects enabled operations with empty or dangling region
references. The default `preserve` list above is mandatory unless a future
contract explicitly adds a stronger protection rule.

### Version

```pseudo-json
{
  "id": "UUID",
  "asset_url": {/* Asset URL with kind=version */},
  "created_at": "2026-08-30T12:20:00Z",
  "validation": {
    "face_identity": "pass",
    "pose_and_composition": "pass",
    "hands_and_costume": "review",
    "background_geometry": "pass",
    "lighting_and_noise": "review"
  },
  "selected": false
}
```

Validation keys are extensible, but every value is exactly `pass` or `review`.

### Task and error

```pseudo-json
{
  "task_id": "UUID",
  "status": "awaiting_confirmation",
  "created_at": "2026-08-30T12:00:00Z",
  "updated_at": "2026-08-30T12:10:00Z",
  "original_asset_url": {/* Asset URL with kind=original */},
  "mask_asset_url": {/* Asset URL with kind=mask, or null */},
  "analysis": [/* Analysis card */],
  "plan": {/* Edit plan, or null */},
  "versions": [/* Version */],
  "error": null
}
```

Errors are stable, user-safe objects and never contain stack traces, provider
response bodies, credentials, or unsigned storage URLs:

```json
{
  "error": {
    "code": "TASK_NOT_READY",
    "message": "请先确认修图区域和处理目标。",
    "retryable": false
  }
}
```

### Idempotency

Clients send an opaque `Idempotency-Key` header for retryable `analyze` and
`generate` requests. The key is scoped to `(task_id, operation)`, is 1–128
characters, and must be persisted with the resulting job. Repeating the same
key and equivalent request returns the existing result without creating a
duplicate provider job. Reusing a key with a different request is a conflict.

The persisted idempotency record has this shape:

```pseudo-json
{
  "task_id": "UUID",
  "operation": "generate",
  "key": "client-generated-opaque-key",
  "request_hash": "sha256:...",
  "result_status": "generating",
  "provider_job_id": "provider-job-id-or-null",
  "provider_status": "queued|running|succeeded|failed",
  "created_at": "2026-08-30T12:10:00Z"
}
```

The record is persisted as part of the task aggregate (the current SQLAlchemy
implementation stores the records in `tasks.idempotency_records`). Its durable
identity is `(task_id, operation, key)` and the required retry fields are
`request_hash`, `result_status`, and `created_at`; `updated_at` tracks provider
progress. A matching hash reuses the stored provider job, including after a
service restart. A different hash returns `IDEMPOTENCY_CONFLICT`. Provider
jobs in `queued` or `running` are polled for a bounded number of attempts per
request; a still-pending record remains retryable and the next request resumes
polling the same `provider_job_id`.

Generation reserves candidate positions transactionally in the database. A
task can have positions `0` and `1` only, so concurrent requests cannot create
more than two candidates. The original asset is never replaced by a generated
version.

## API paths

Later tasks implement these paths. Authentication is invite-token based and the
invite token is sent to the API, never to an image provider:

```text
GET  /healthz
POST /api/v1/tasks
POST /api/v1/tasks/{task_id}/analyze
GET  /api/v1/tasks/{task_id}
POST /api/v1/tasks/{task_id}/plan
POST /api/v1/tasks/{task_id}/generate
GET  /api/v1/tasks/{task_id}/download
POST /api/v1/maintenance/cleanup
```

`POST /api/v1/tasks` validates the invite and file metadata, creates a
`created` task, and returns an upload URL with status `uploading` after the
upload reservation transition. Analyze, plan, and generate endpoints return
the task shape or a stable error shape.

### Implemented API contract

The task creation request is:

```json
{
  "invite_token": "invite-demo",
  "filename": "cos-photo.jpg",
  "content_type": "image/jpeg",
  "byte_size": 1200000
}
```

On success, `POST /api/v1/tasks` returns only the upload reservation fields:

```json
{
  "task_id": "UUID",
  "upload_url": "https://storage.example.test/signed-upload",
  "expires_at": "2026-08-30T12:30:00Z",
  "status": "uploading"
}
```

`POST /api/v1/tasks/{task_id}/analyze` and
`POST /api/v1/tasks/{task_id}/generate` require an
`Idempotency-Key` header containing 1–128 opaque characters. The key is scoped
to the task and operation. Repeating an equivalent request returns the current
task without submitting another provider job; reusing a key for a different
request returns `IDEMPOTENCY_CONFLICT`.

`POST /api/v1/tasks/{task_id}/plan` accepts the structured `EditPlan` object
above and returns the task with the saved plan. At least one operation must be
enabled before generation. Generation returns the task after validation; it
can never create more than two candidate versions and never replaces the
original asset.

`GET /api/v1/tasks/{task_id}/download` returns a short-lived result URL only
when the task is `succeeded` and the latest version has not expired:

```json
{
  "url": "https://storage.example.test/signed-download",
  "expires_at": "2026-08-30T12:30:00Z"
}
```

All API failures use `{ "error": { "code": "...", "message": "..." } }`.
The API uses `401` for `UNAUTHORIZED`, `400` for `INVALID_FILE` and malformed
plans, `404` for `NOT_FOUND`, `409` for `TASK_NOT_READY` and workflow guards,
`410` for `TASK_EXPIRED`, and `502` for `PROVIDER_ERROR`. Invite tokens,
provider job ids, provider response bodies, provider API keys, storage
credentials, unsigned storage keys, and local filesystem paths are never
returned to clients.

## Boundaries and ownership

- **Frontend:** React/Vite owns invite input, file selection, previews, cards,
  normalized mask editing, confirmation controls, progress, comparison,
  rollback, and download. It keeps the invite token in runtime state only and
  never receives model credentials or raw provider prompts.
- **API/domain:** FastAPI owns authentication, input validation, the transition
  table, idempotency, task metadata, retry rules, and user-safe errors. It calls
  the provider only with a confirmed structured `EditPlan`.
- **Storage:** An S3-compatible adapter owns original, mask, and version
  objects plus signed upload/download URLs. The backend local filesystem is not
  an asset store. Assets target 24-hour retention.
- **Provider:** A server-side adapter owns analysis, generation, and provider
  differences. `mock` is the deterministic local default; external API keys
  remain server-side. The provider cannot change task status directly.

## Preservation rules

Every plan must preserve face identity, composition, main pose, costume design,
background structure, original light direction, perspective, depth of field, and
noise consistency. Operations are local and region-bounded. Generation must not
overwrite the original, distort unrelated background geometry, change the
camera/viewpoint, or silently expand a confirmed region. Validation may mark a
candidate `review` without hiding it; the user decides whether to retain or
regenerate it.
