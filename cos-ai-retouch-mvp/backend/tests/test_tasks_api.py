from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.api.routes_tasks import _task_view
from app.db import IdempotencyRow, TaskRow, VersionRow
from app.domain.models import (
    AssetURL,
    EditPlan,
    Goal,
    MaskStroke,
    Operation,
    Region,
    TaskStatus,
    VersionRecord,
)
from app.repositories.tasks import TaskRepository
from app.services.image_provider import (
    MockImageModelProvider,
    ProviderError,
    ProviderJob,
    ProviderResult,
)
from app.services.storage import InMemoryStorageAdapter
from app.services.task_service import TaskService, TaskServiceError
from app.services.task_service import _request_hash


class CountingProvider:
    """A test double that preserves the real mock provider behavior."""

    def __init__(self, settings: Settings):
        self.delegate = MockImageModelProvider(settings)
        self.analysis_submissions = 0
        self.edit_submissions = 0

    def submit_analysis(self, source_url: str):
        self.analysis_submissions += 1
        return self.delegate.submit_analysis(source_url)

    def submit_edit(self, source_url: str, plan: EditPlan):
        self.edit_submissions += 1
        return self.delegate.submit_edit(source_url, plan)

    def poll(self, job_id: str):
        return self.delegate.poll(job_id)

    def download_result(self, asset_url: AssetURL):
        return self.delegate.download_result(asset_url)


class FailingProvider(CountingProvider):
    def submit_edit(self, source_url: str, plan: EditPlan):
        self.edit_submissions += 1
        raise ProviderError(
            "provider failed with server-only-secret and upstream body",
            code="UPSTREAM_ERROR",
        )


class ScriptedProvider:
    """Provider double that makes polling behavior observable and deterministic."""

    def __init__(
        self,
        *,
        analysis_statuses: tuple[str, ...] = ("succeeded",),
        edit_statuses: tuple[str, ...] = ("succeeded",),
    ):
        self.analysis_statuses = analysis_statuses
        self.edit_statuses = edit_statuses
        self.analysis_submissions = 0
        self.edit_submissions = 0
        self.poll_counts: dict[str, int] = {}

    def submit_analysis(self, source_url: str):
        self.analysis_submissions += 1
        job_id = f"analysis-job-{self.analysis_submissions}"
        return ProviderJob(job_id=job_id, operation="analysis", status="queued")

    def submit_edit(self, source_url: str, plan: EditPlan):
        self.edit_submissions += 1
        job_id = f"edit-job-{self.edit_submissions}"
        return ProviderJob(job_id=job_id, operation="edit", status="queued")

    def poll(self, job_id: str):
        count = self.poll_counts.get(job_id, 0) + 1
        self.poll_counts[job_id] = count
        statuses = (
            self.analysis_statuses
            if job_id.startswith("analysis-")
            else self.edit_statuses
        )
        status = statuses[min(count - 1, len(statuses) - 1)]
        if status == "succeeded":
            if job_id.startswith("analysis-"):
                return ProviderResult(
                    job_id=job_id,
                    status="succeeded",
                    analysis=MockImageModelProvider.analysis_fixture,
                )
            return ProviderResult(
                job_id=job_id,
                status="succeeded",
                asset_url=AssetURL(
                    kind="version",
                    url=f"https://storage.example.test/{job_id}.png",
                    expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
                ),
            )
        return ProviderResult(job_id=job_id, status=status)

    def download_result(self, asset_url: AssetURL):
        assert asset_url.kind == "version"
        return b"scripted-generated-png", "image/png"


class SimulatedProcessCrash(BaseException):
    """Crash injected after provider acceptance and before local persistence."""


class StableProvider:
    """Provider double whose idempotency is owned by the provider boundary."""

    def __init__(self):
        self.submissions = 0
        self.jobs: dict[tuple[str, str], str] = {}

    def submit_analysis(self, source_url: str):
        return self._submit("analysis", source_url)

    def submit_edit(self, source_url: str, plan: EditPlan):
        return self._submit("edit", source_url)

    def _submit(self, operation: str, source_url: str):
        key = (operation, source_url)
        existing = self.jobs.get(key)
        if existing is None:
            self.submissions += 1
            existing = f"stable-{operation}-job-1"
            self.jobs[key] = existing
        return ProviderJob(job_id=existing, operation=operation, status="queued")

    def poll(self, job_id: str):
        if job_id.startswith("stable-analysis"):
            return ProviderResult(
                job_id=job_id,
                status="succeeded",
                analysis=MockImageModelProvider.analysis_fixture,
            )
        return ProviderResult(
            job_id=job_id,
            status="succeeded",
            asset_url=AssetURL(
                kind="version",
                url=f"https://storage.example.test/{job_id}.png",
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            ),
        )

    def download_result(self, asset_url: AssetURL):
        assert asset_url.kind == "version"
        return b"stable-generated-png", "image/png"


class LateFailureProvider:
    """Return a stale failure for the first edit job and success for the next."""

    def __init__(self):
        self.edit_submissions = 0

    def submit_analysis(self, source_url: str):
        return ProviderJob(
            job_id="analysis-job-1", operation="analysis", status="queued"
        )

    def submit_edit(self, source_url: str, plan: EditPlan):
        self.edit_submissions += 1
        job_id = "old-edit-job" if self.edit_submissions == 1 else "new-edit-job"
        return ProviderJob(job_id=job_id, operation="edit", status="queued")

    def poll(self, job_id: str):
        if job_id == "analysis-job-1":
            return ProviderResult(
                job_id=job_id,
                status="succeeded",
                analysis=MockImageModelProvider.analysis_fixture,
            )
        if job_id == "old-edit-job":
            return ProviderResult(job_id=job_id, status="failed")
        return ProviderResult(
            job_id=job_id,
            status="succeeded",
            asset_url=AssetURL(
                kind="version",
                url=f"https://storage.example.test/{job_id}.png",
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            ),
        )

    def download_result(self, asset_url: AssetURL):
        assert asset_url.kind == "version"
        return b"late-generated-png", "image/png"


class FixedValidationAdapter:
    def validate(self, *, result: ProviderResult, plan: EditPlan):
        assert result.metadata["provider"] == "mock"
        assert plan.operations
        return {
            "face_identity": "review",
            "pose_and_composition": "review",
            "hands_and_costume": "pass",
            "background_geometry": "review",
            "lighting_and_noise": "pass",
        }


INVITE_HEADERS = {"X-Invite-Token": "invite-demo"}


def _authenticated_headers(**extra: str) -> dict[str, str]:
    headers = dict(INVITE_HEADERS)
    headers.update(extra)
    return headers


@pytest.fixture
def api_context(repository):
    from app.main import create_app

    settings = Settings(
        invite_tokens=["invite-demo"],
        require_invite_tokens=True,
        max_upload_bytes=1024 * 1024,
        asset_ttl_hours=1,
    )
    storage = InMemoryStorageAdapter(settings)
    provider = CountingProvider(settings)
    app = create_app(
        settings=settings,
        repository=repository,
        storage=storage,
        provider=provider,
    )
    with TestClient(app) as client:
        yield client, repository, storage, provider


@pytest.fixture
def scripted_context(repository):
    from app.main import create_app

    settings = Settings(
        invite_tokens=["invite-demo"],
        require_invite_tokens=True,
        max_upload_bytes=1024 * 1024,
        asset_ttl_hours=1,
    )
    storage = InMemoryStorageAdapter(settings)
    provider = ScriptedProvider()
    app = create_app(
        settings=settings,
        repository=repository,
        storage=storage,
        provider=provider,
    )
    with TestClient(app) as client:
        yield client, repository, storage, provider, settings


def _create(client: TestClient, **overrides: Any):
    payload = {
        "invite_token": "invite-demo",
        "filename": "cos-photo.jpg",
        "content_type": "image/jpeg",
        "byte_size": 1200,
    }
    payload.update(overrides)
    return client.post("/api/v1/tasks", json=payload)


def _plan_payload() -> dict[str, Any]:
    return {
        "goals": ["natural_retouch"],
        "regions": [
            {
                "id": "face-1",
                "label": "face",
                "x": 0.25,
                "y": 0.2,
                "width": 0.3,
                "height": 0.4,
            }
        ],
        "operations": [
            {
                "kind": "skin_retouch",
                "goal": "natural_retouch",
                "region_ids": ["face-1"],
                "intensity": 55,
                "enabled": True,
            }
        ],
    }


def _prepare_confirmation(client: TestClient, task_id: str | None = None):
    task_id = task_id or _create(client).json()["task_id"]
    analyzed = client.post(
        f"/api/v1/tasks/{task_id}/analyze",
        headers=_authenticated_headers(**{"Idempotency-Key": "analysis-once"}),
    )
    assert analyzed.status_code == 200
    assert analyzed.json()["status"] == "awaiting_confirmation"
    return task_id


def test_healthz_and_task_creation_require_invite_and_return_upload_reservation(
    api_context,
):
    client, _repository, _storage, _provider = api_context

    health = client.get("/healthz")
    assert health.status_code == 200
    assert health.json() == {"status": "ok"}

    missing = client.post(
        "/api/v1/tasks",
        json={
            "filename": "cos-photo.jpg",
            "content_type": "image/jpeg",
            "byte_size": 1200,
        },
    )
    invalid = _create(client, invite_token="not-valid")
    empty = client.post("/api/v1/tasks")
    assert missing.status_code == invalid.status_code == empty.status_code == 401
    assert missing.json()["error"]["code"] == "UNAUTHORIZED"
    assert invalid.json()["error"]["code"] == "UNAUTHORIZED"
    assert empty.json()["error"]["code"] == "UNAUTHORIZED"

    created = _create(client)
    assert created.status_code == 200
    body = created.json()
    assert body["task_id"]
    assert body["upload_url"].startswith("https://")
    assert body["expires_at"]
    assert body["status"] == "uploading"
    assert "invite-demo" not in created.text


def test_small_deployment_can_upload_original_through_the_signed_backend_bridge(
    repository,
):
    from app.main import create_app

    settings = Settings(
        storage_public_url="http://testserver",
        invite_tokens=["invite-demo"],
        require_invite_tokens=True,
        max_upload_bytes=1024 * 1024,
        asset_ttl_hours=1,
    )
    storage = InMemoryStorageAdapter(settings)
    app = create_app(
        settings=settings,
        repository=repository,
        storage=storage,
        provider=CountingProvider(settings),
    )

    with TestClient(app) as client:
        created = client.post(
            "/api/v1/tasks",
            json={
                "invite_token": "invite-demo",
                "filename": "cos-photo.jpg",
                "content_type": "image/jpeg",
                "byte_size": 10,
            },
        )
        upload_url = created.json()["upload_url"]
        uploaded = client.put(
            upload_url,
            content=b"jpeg-bytes",
            headers={"Content-Type": "image/jpeg"},
        )
        downloaded = client.get(upload_url)

    assert created.status_code == 200
    assert upload_url.startswith("http://testserver/api/v1/storage/")
    assert uploaded.status_code == 200
    assert downloaded.status_code == 200
    assert downloaded.content == b"jpeg-bytes"
    assert downloaded.headers["content-type"].startswith("image/jpeg")


@pytest.mark.parametrize(
    "overrides",
    [
        {"content_type": "image/gif"},
        {"content_type": "application/octet-stream"},
        {"byte_size": 1024 * 1024 + 1},
        {"filename": None},
        {"filename": ""},
    ],
)
def test_task_creation_rejects_invalid_files_as_stable_400(overrides, api_context):
    client, _repository, _storage, _provider = api_context

    response = _create(client, **overrides)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_FILE"


def test_analysis_transitions_to_confirmation_and_is_idempotent(api_context):
    client, repository, _storage, provider = api_context
    task_id = _create(client).json()["task_id"]

    first = client.post(
        f"/api/v1/tasks/{task_id}/analyze",
        headers=_authenticated_headers(**{"Idempotency-Key": "analysis-once"}),
    )
    retry = client.post(
        f"/api/v1/tasks/{task_id}/analyze",
        headers=_authenticated_headers(**{"Idempotency-Key": "analysis-once"}),
    )
    fetched = client.get(f"/api/v1/tasks/{task_id}", headers=INVITE_HEADERS)

    assert first.status_code == retry.status_code == fetched.status_code == 200
    assert first.json()["status"] == retry.json()["status"] == "awaiting_confirmation"
    assert first.json()["analysis"]
    assert fetched.json()["analysis"] == first.json()["analysis"]
    assert provider.analysis_submissions == 1
    assert repository.get_task(UUID(task_id)).status.value == ("awaiting_confirmation")


def test_plan_and_generate_enforce_confirmation_and_enabled_operation(api_context):
    client, _repository, _storage, provider = api_context
    task_id = _prepare_confirmation(client)

    before_plan = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-before-plan"}),
    )
    assert before_plan.status_code == 409
    assert before_plan.json()["error"]["code"] == "TASK_NOT_READY"

    empty_plan = client.post(
        f"/api/v1/tasks/{task_id}/plan", json={}, headers=INVITE_HEADERS
    )
    assert empty_plan.status_code == 400
    assert empty_plan.json()["error"]["code"] == "INVALID_PLAN"

    saved = client.post(
        f"/api/v1/tasks/{task_id}/plan",
        json=_plan_payload(),
        headers=INVITE_HEADERS,
    )
    assert saved.status_code == 200
    assert saved.json()["plan"]["operations"][0]["enabled"] is True
    assert saved.json()["status"] == "awaiting_confirmation"

    generated = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-once"}),
    )
    assert generated.status_code == 200
    assert generated.json()["status"] == "succeeded"
    assert len(generated.json()["versions"]) == 1
    assert provider.edit_submissions == 1


def test_generation_stores_provider_external_result_and_downloads_only_signed_storage_url(
    scripted_context,
):
    client, _repository, storage, _provider, _settings = scripted_context
    task_id = _prepare_confirmation(client)
    saved = client.post(
        f"/api/v1/tasks/{task_id}/plan",
        json=_plan_payload(),
        headers=INVITE_HEADERS,
    )
    assert saved.status_code == 200

    signer_calls: list[str] = []
    original_signer = storage.create_download_url

    def recording_signer(object_key: str) -> str:
        signer_calls.append(object_key)
        return original_signer(object_key)

    storage.create_download_url = recording_signer
    generated = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-storage"}),
    )

    assert generated.status_code == 200
    version_url = generated.json()["versions"][0]["asset_url"]["url"]
    result_key = f"tasks/{task_id}/versions/0.png"
    assert result_key in storage.objects
    assert result_key in version_url
    assert "storage.example.test" not in version_url

    downloaded = client.get(
        f"/api/v1/tasks/{task_id}/download",
        headers=INVITE_HEADERS,
    )

    assert downloaded.status_code == 200
    assert downloaded.json()["url"] != "https://storage.example.test/edit-job-1.png"
    assert result_key in downloaded.json()["url"]
    assert signer_calls[-1] == result_key


def test_mock_generation_returns_deterministic_validation_checks(api_context):
    client, repository, _storage, _provider = api_context
    task_id = _prepare_confirmation(client)
    saved = client.post(
        f"/api/v1/tasks/{task_id}/plan",
        json=_plan_payload(),
        headers=INVITE_HEADERS,
    )
    assert saved.status_code == 200

    generated = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-validation"}),
    )

    assert generated.status_code == 200
    assert generated.json()["status"] == "succeeded"
    assert generated.json()["versions"][0]["validation"] == {
        "face_identity": "pass",
        "pose_and_composition": "pass",
        "hands_and_costume": "review",
        "background_geometry": "pass",
        "lighting_and_noise": "review",
    }
    stored = repository.get_task(UUID(task_id))
    assert stored is not None
    assert (
        stored.versions[0].validation == generated.json()["versions"][0]["validation"]
    )


def test_generation_accepts_a_replacement_validation_adapter(repository):
    from app.main import create_app

    settings = Settings(
        invite_tokens=["invite-demo"],
        max_upload_bytes=1024 * 1024,
        asset_ttl_hours=1,
    )
    storage = InMemoryStorageAdapter(settings)
    provider = CountingProvider(settings)
    app = create_app(
        settings=settings,
        repository=repository,
        storage=storage,
        provider=provider,
        validation_adapter=FixedValidationAdapter(),
    )
    with TestClient(app) as client:
        task_id = _prepare_confirmation(client)
        saved = client.post(
            f"/api/v1/tasks/{task_id}/plan",
            json=_plan_payload(),
            headers=INVITE_HEADERS,
        )
        assert saved.status_code == 200
        generated = client.post(
            f"/api/v1/tasks/{task_id}/generate",
            headers=_authenticated_headers(**{"Idempotency-Key": "generate-adapter"}),
        )

    assert generated.status_code == 200
    assert generated.json()["versions"][0]["validation"] == {
        "face_identity": "review",
        "pose_and_composition": "review",
        "hands_and_costume": "pass",
        "background_geometry": "review",
        "lighting_and_noise": "pass",
    }


def test_save_plan_persists_and_returns_mask_strokes(api_context):
    client, repository, _storage, _provider = api_context
    task_id = _prepare_confirmation(client)
    payload = {
        **_plan_payload(),
        "mask_strokes": [
            {
                "mode": "add",
                "width": 16,
                "points": [{"x": 0.1, "y": 0.2}, {"x": 0.3, "y": 0.4}],
            },
            {"mode": "erase", "width": 8, "points": [{"x": 0.5, "y": 0.6}]},
        ],
    }

    saved = client.post(
        f"/api/v1/tasks/{task_id}/plan", json=payload, headers=INVITE_HEADERS
    )
    fetched = client.get(f"/api/v1/tasks/{task_id}", headers=INVITE_HEADERS)

    assert saved.status_code == fetched.status_code == 200
    expected = payload["mask_strokes"]
    assert saved.json()["plan"]["mask_strokes"] == expected
    assert fetched.json()["plan"]["mask_strokes"] == expected
    loaded = repository.get_task(UUID(task_id))
    assert loaded is not None and loaded.plan is not None
    assert loaded.plan.model_dump(mode="json")["mask_strokes"] == expected


@pytest.mark.parametrize(
    "mask_strokes",
    [
        [],
        [{"mode": "add", "width": 10, "points": []}],
        [{"mode": "paint", "width": 10, "points": [{"x": 0.2, "y": 0.2}]}],
    ],
)
def test_save_plan_rejects_empty_or_invalid_structure_mask_with_safe_error(
    mask_strokes, api_context
):
    client, repository, _storage, _provider = api_context
    task_id = _prepare_confirmation(client)
    payload = {
        **_plan_payload(),
        "goals": ["structure_repair"],
        "operations": [
            {
                **_plan_payload()["operations"][0],
                "goal": "structure_repair",
            }
        ],
        "mask_strokes": mask_strokes,
    }

    response = client.post(
        f"/api/v1/tasks/{task_id}/plan", json=payload, headers=INVITE_HEADERS
    )

    assert response.status_code == 400
    assert response.json() == {
        "error": {
            "code": "INVALID_PLAN",
            "message": "结构修复需要至少一笔有效的局部蒙版。",
        }
    }
    assert repository.get_task(UUID(task_id)).plan is None


def test_service_save_plan_rejects_structure_repair_without_mask(repository):
    settings = Settings(invite_tokens=["invite-demo"], asset_ttl_hours=1)
    service = TaskService(
        repository,
        InMemoryStorageAdapter(settings),
        CountingProvider(settings),
        settings=settings,
    )
    task, _signed = service.create_task(
        "invite-demo", "cos-photo.jpg", "image/jpeg", 1200
    )
    service.analyze(task.id, "analysis-before-empty-mask")
    region = Region(id="body-1", label="body", x=0.1, y=0.1, width=0.3, height=0.3)
    plan = EditPlan(
        goals=(Goal.STRUCTURE_REPAIR,),
        regions=(region,),
        operations=(
            Operation(
                kind="body_pose_repair",
                goal=Goal.STRUCTURE_REPAIR,
                region_ids=(region.id,),
            ),
        ),
        mask_strokes=(),
    )

    with pytest.raises(TaskServiceError) as exc_info:
        service.save_plan(task.id, plan)

    assert exc_info.value.code == "INVALID_PLAN"
    assert str(exc_info.value) == "结构修复需要至少一笔有效的局部蒙版。"
    assert repository.get_task(task.id).plan is None


def test_plan_hash_changes_when_only_mask_strokes_change(repository):
    settings = Settings(invite_tokens=["invite-demo"], asset_ttl_hours=1)
    service = TaskService(
        repository,
        InMemoryStorageAdapter(settings),
        CountingProvider(settings),
        settings=settings,
    )
    first = EditPlan(mask_strokes=())
    second = EditPlan(
        mask_strokes=(MaskStroke(mode="add", width=10, points=({"x": 0.5, "y": 0.5},)),)
    )

    assert service._plan_hash_payload(first)["mask_strokes"] == []
    assert service._plan_hash_payload(second)["mask_strokes"]
    assert _request_hash(service._plan_hash_payload(first)) != _request_hash(
        service._plan_hash_payload(second)
    )


def test_generate_is_idempotent_original_is_untouched_and_candidates_are_bounded(
    api_context,
):
    client, repository, _storage, provider = api_context
    task_id = _prepare_confirmation(client)
    original = client.get(f"/api/v1/tasks/{task_id}", headers=INVITE_HEADERS).json()[
        "original_asset_url"
    ]
    client.post(
        f"/api/v1/tasks/{task_id}/plan",
        json=_plan_payload(),
        headers=INVITE_HEADERS,
    )

    first = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-once"}),
    )
    retry = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-once"}),
    )
    assert first.status_code == retry.status_code == 200
    assert first.json()["versions"] == retry.json()["versions"]
    assert retry.json()["original_asset_url"] == original
    assert provider.edit_submissions == 1

    loaded = repository.get_task(UUID(task_id))
    assert loaded is not None
    assert len(loaded.versions) <= 2
    assert loaded.original_asset_url.url == original["url"]


def test_rebuilt_task_service_uses_persisted_idempotency_without_resubmitting(
    api_context,
):
    client, repository, storage, provider = api_context
    task_id = _prepare_confirmation(client)
    client.post(
        f"/api/v1/tasks/{task_id}/plan",
        json=_plan_payload(),
        headers=INVITE_HEADERS,
    )

    first = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-rebuild"}),
    )
    assert first.status_code == 200
    assert provider.edit_submissions == 1

    rebuilt = TaskService(
        TaskRepository(repository.session),
        storage,
        provider,
        settings=Settings(invite_tokens=["invite-demo"], asset_ttl_hours=1),
    )
    retried = rebuilt.generate(UUID(task_id), "generate-rebuild")
    record = repository.get_idempotency(UUID(task_id), "generate", "generate-rebuild")

    assert retried.status is TaskStatus.SUCCEEDED
    assert len(retried.versions) == 1
    assert provider.edit_submissions == 1
    assert record is not None
    assert record.provider_job_id
    assert record.result_status is TaskStatus.SUCCEEDED
    assert record.provider_status == "succeeded"


def test_provider_idempotency_recovers_after_crash_before_job_id_write(
    repository, monkeypatch
):
    settings = Settings(invite_tokens=["invite-demo"], asset_ttl_hours=1)
    storage = InMemoryStorageAdapter(settings)
    provider = StableProvider()
    service = TaskService(
        repository,
        storage,
        provider,
        settings=settings,
    )
    task, _signed = service.create_task(
        "invite-demo", "cos-photo.jpg", "image/jpeg", 1200
    )
    real_update = repository.update_idempotency
    crashed = False

    def crash_before_write(*args, **kwargs):
        nonlocal crashed
        if kwargs.get("provider_job_id") and not crashed:
            crashed = True
            raise SimulatedProcessCrash()
        return real_update(*args, **kwargs)

    monkeypatch.setattr(repository, "update_idempotency", crash_before_write)
    with pytest.raises(SimulatedProcessCrash):
        service.analyze(task.id, "analysis-crash-window")

    rebuilt = TaskService(
        TaskRepository(repository.session),
        storage,
        provider,
        settings=settings,
    )
    recovered = rebuilt.analyze(task.id, "analysis-crash-window")

    assert recovered.status is TaskStatus.AWAITING_CONFIRMATION
    assert provider.submissions == 1
    record = repository.get_idempotency(task.id, "analyze", "analysis-crash-window")
    assert record is not None
    assert record.provider_job_id == "stable-analysis-job-1"


def test_generate_rebuild_recovers_after_crash_before_atomic_finalize(
    repository, monkeypatch
):
    settings = Settings(invite_tokens=["invite-demo"], asset_ttl_hours=1)
    storage = InMemoryStorageAdapter(settings)
    provider = StableProvider()
    service = TaskService(repository, storage, provider, settings=settings)
    task, _signed = service.create_task(
        "invite-demo", "cos-photo.jpg", "image/jpeg", 1200
    )
    service.analyze(task.id, "analysis-for-generate-recovery")
    service.save_plan(task.id, EditPlan.model_validate(_plan_payload()))

    real_finalize = getattr(repository, "finalize_generation", None)
    crashed = False

    def crash_before_finalize(*args, **kwargs):
        nonlocal crashed
        if not crashed:
            crashed = True
            raise SimulatedProcessCrash()
        assert real_finalize is not None
        return real_finalize(*args, **kwargs)

    monkeypatch.setattr(
        repository, "finalize_generation", crash_before_finalize, raising=False
    )
    with pytest.raises(SimulatedProcessCrash):
        service.generate(task.id, "generate-recovery")

    prepared = repository.get_idempotency(task.id, "generate", "generate-recovery")
    assert prepared is not None
    assert prepared.version_id is not None
    assert prepared.result_asset_url is not None

    rebuilt = TaskService(
        TaskRepository(repository.session),
        storage,
        provider,
        settings=settings,
    )
    recovered = rebuilt.generate(task.id, "generate-recovery")

    assert recovered.status is TaskStatus.SUCCEEDED
    assert len(recovered.versions) == 1
    assert recovered.versions[0].id == prepared.version_id
    assert provider.submissions == 2  # one analysis job and one edit job
    assert (
        repository.get_idempotency(
            task.id, "generate", "generate-recovery"
        ).result_status
        is TaskStatus.SUCCEEDED
    )


def test_generate_rebuild_reconciles_a_version_written_before_final_state(
    repository,
):
    settings = Settings(invite_tokens=["invite-demo"], asset_ttl_hours=1)
    storage = InMemoryStorageAdapter(settings)
    provider = StableProvider()
    service = TaskService(repository, storage, provider, settings=settings)
    task, _signed = service.create_task(
        "invite-demo", "cos-photo.jpg", "image/jpeg", 1200
    )
    service.analyze(task.id, "analysis-before-legacy-window")
    plan = EditPlan.model_validate(_plan_payload())
    service.save_plan(task.id, plan)

    request_hash = _request_hash(service._plan_hash_payload(plan))
    provider_key = service._provider_idempotency_key(
        "edit", task.original_asset_url.url, plan
    )
    entry = repository.reserve_generation(
        task.id,
        "generate-legacy-window",
        request_hash,
        provider_key,
    )
    job = provider.submit_edit(task.original_asset_url.url, plan)
    repository.update_idempotency(
        task.id,
        "generate",
        "generate-legacy-window",
        provider_job_id=job.job_id,
        provider_idempotency_key=provider_key,
        provider_status="succeeded",
        result_status=TaskStatus.GENERATING,
    )
    result = provider.poll(job.job_id)
    version = VersionRecord(
        id=UUID("00000000-0000-0000-0000-000000000991"),
        asset_url=result.asset_url,
        validation={"face_identity": "pass"},
    )
    repository.add_version(task.id, version, position=entry.candidate_position)
    task_row = repository.session.get(TaskRow, task.id)
    task_row.status = TaskStatus.VALIDATING.value
    repository.session.commit()

    rebuilt = TaskService(
        TaskRepository(repository.session),
        storage,
        provider,
        settings=settings,
    )
    recovered = rebuilt.generate(task.id, "generate-legacy-window")

    assert recovered.status is TaskStatus.SUCCEEDED
    assert [item.id for item in recovered.versions] == [version.id]
    assert provider.submissions == 2


def test_same_key_recovers_after_stale_reservation_reclaim(repository, monkeypatch):
    settings = Settings(invite_tokens=["invite-demo"], asset_ttl_hours=1)
    storage = InMemoryStorageAdapter(settings)
    provider = StableProvider()
    service = TaskService(repository, storage, provider, settings=settings)
    task, _signed = service.create_task(
        "invite-demo", "cos-photo.jpg", "image/jpeg", 1200
    )
    service.analyze(task.id, "analysis-before-stale-retry")
    plan = EditPlan.model_validate(_plan_payload())
    service.save_plan(task.id, plan)
    request_hash = _request_hash(service._plan_hash_payload(plan))
    provider_key = service._provider_idempotency_key(
        "edit", task.original_asset_url.url, plan
    )
    repository.reserve_generation_and_mark_task_generating(
        task.id, "generate-stale-retry", request_hash, provider_key
    )
    row = repository.session.scalar(
        select(IdempotencyRow).where(
            IdempotencyRow.task_id == task.id,
            IdempotencyRow.operation == "generate",
            IdempotencyRow.key == "generate-stale-retry",
        )
    )
    row.updated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    repository.session.commit()
    repository.reclaim_stale_generation_reservations(
        task.id, datetime.now(timezone.utc) - timedelta(minutes=5)
    )

    real_submit = provider.submit_edit

    def assert_slot_before_submit(source_url, submitted_plan):
        recovered_entry = repository.get_idempotency(
            task.id, "generate", "generate-stale-retry"
        )
        assert recovered_entry is not None
        assert recovered_entry.provider_status != "stale_reservation"
        assert recovered_entry.candidate_position is not None
        return real_submit(source_url, submitted_plan)

    monkeypatch.setattr(provider, "submit_edit", assert_slot_before_submit)
    recovered = service.generate(task.id, "generate-stale-retry")

    assert recovered.status is TaskStatus.SUCCEEDED
    assert len(recovered.versions) == 1
    assert recovered.versions[0].asset_url.kind == "version"
    assert provider.submissions == 2


def test_reclaim_reopens_task_for_new_key_and_old_key_recovery(repository):
    settings = Settings(invite_tokens=["invite-demo"], asset_ttl_hours=1)
    storage = InMemoryStorageAdapter(settings)
    provider = StableProvider()
    service = TaskService(repository, storage, provider, settings=settings)
    task, _signed = service.create_task(
        "invite-demo", "cos-photo.jpg", "image/jpeg", 1200
    )
    service.analyze(task.id, "analysis-before-reopen")
    plan = EditPlan.model_validate(_plan_payload())
    service.save_plan(task.id, plan)
    request_hash = _request_hash(service._plan_hash_payload(plan))
    provider_key = service._provider_idempotency_key(
        "edit", task.original_asset_url.url, plan
    )
    old_key = "generate-reclaimed-old"
    repository.reserve_generation_and_mark_task_generating(
        task.id, old_key, request_hash, provider_key
    )
    accepted_job = provider.submit_edit(task.original_asset_url.url, plan)
    assert accepted_job.job_id
    old_row = repository.session.scalar(
        select(IdempotencyRow).where(
            IdempotencyRow.task_id == task.id,
            IdempotencyRow.key == old_key,
        )
    )
    old_row.updated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    repository.session.commit()
    repository.reclaim_stale_generation_reservations(
        task.id, datetime.now(timezone.utc) - timedelta(minutes=5)
    )
    assert repository.get_task(task.id).status is TaskStatus.FAILED

    new_result = service.generate(task.id, "generate-reclaimed-new")
    old_result = service.generate(task.id, old_key)

    assert new_result.status is TaskStatus.SUCCEEDED
    assert old_result.status is TaskStatus.SUCCEEDED
    assert len(old_result.versions) == 2
    assert {
        item.position
        for item in (
            repository.session.scalars(
                select(VersionRow).where(VersionRow.task_id == task.id)
            ).all()
        )
    } == {0, 1}
    assert provider.submissions == 2
    assert (
        repository.get_idempotency(
            task.id, "generate", old_key
        ).provider_idempotency_key
        == provider_key
    )


def test_old_generation_failure_cannot_overwrite_new_success(repository):
    settings = Settings(invite_tokens=["invite-demo"], asset_ttl_hours=1)
    storage = InMemoryStorageAdapter(settings)
    provider = StableProvider()
    service = TaskService(repository, storage, provider, settings=settings)
    task, _signed = service.create_task(
        "invite-demo", "cos-photo.jpg", "image/jpeg", 1200
    )
    service.analyze(task.id, "analysis-before-stale-failure")
    plan = EditPlan.model_validate(_plan_payload())
    service.save_plan(task.id, plan)
    request_hash = _request_hash(service._plan_hash_payload(plan))
    provider_key = service._provider_idempotency_key(
        "edit", task.original_asset_url.url, plan
    )
    old_key = "generate-old-failure"
    old_entry = repository.reserve_generation_and_mark_task_generating(
        task.id, old_key, request_hash, provider_key
    )
    old_entry = repository.begin_provider_submission(
        task.id, old_key, request_hash, old_entry.reservation_generation
    )
    old_task = service.get_task(task.id)
    row = repository.session.scalar(
        select(IdempotencyRow).where(
            IdempotencyRow.task_id == task.id,
            IdempotencyRow.key == old_key,
        )
    )
    row.updated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    repository.session.commit()
    repository.reclaim_stale_generation_reservations(
        task.id, datetime.now(timezone.utc) - timedelta(minutes=5)
    )

    rebuilt = TaskService(
        TaskRepository(repository.session), storage, provider, settings=settings
    )
    succeeded = rebuilt.generate(task.id, "generate-new-worker")

    assert succeeded.status is TaskStatus.SUCCEEDED
    assert (
        service._fail_task(
            old_task,
            reservation_generation=old_entry.reservation_generation,
            key=old_key,
            request_hash=request_hash,
        )
        is False
    )
    current = repository.get_task(task.id)
    assert current.status is TaskStatus.SUCCEEDED
    assert current.error is None


def test_late_generation_poll_failure_cannot_overwrite_new_generation(
    repository,
):
    settings = Settings(invite_tokens=["invite-demo"], asset_ttl_hours=1)
    storage = InMemoryStorageAdapter(settings)
    provider = LateFailureProvider()
    service = TaskService(repository, storage, provider, settings=settings)
    task, _signed = service.create_task(
        "invite-demo", "cos-photo.jpg", "image/jpeg", 1200
    )
    service.analyze(task.id, "analysis-for-late-failure")
    plan = EditPlan.model_validate(_plan_payload())
    service.save_plan(task.id, plan)

    request_hash = _request_hash(service._plan_hash_payload(plan))
    provider_key = service._provider_idempotency_key(
        "edit", task.original_asset_url.url, plan
    )
    old_key = "generate-late-failure"
    old_entry = repository.reserve_generation_and_mark_task_generating(
        task.id, old_key, request_hash, provider_key
    )
    old_entry = repository.begin_provider_submission(
        task.id, old_key, request_hash, old_entry.reservation_generation
    )
    old_job = provider.submit_edit(task.original_asset_url.url, plan)
    old_entry = repository.record_provider_submission(
        task.id,
        old_key,
        request_hash,
        old_entry.reservation_generation,
        provider_job_id=old_job.job_id,
        provider_status="queued",
        provider_idempotency_key=provider_key,
    )
    old_task = service.get_task(task.id)
    new_key = "generate-new-generation"
    new_entry = repository.reserve_generation_and_mark_task_generating(
        task.id, new_key, request_hash, provider_key
    )
    new_entry = repository.begin_provider_submission(
        task.id, new_key, request_hash, new_entry.reservation_generation
    )
    new_job = provider.submit_edit(task.original_asset_url.url, plan)
    new_entry = repository.record_provider_submission(
        task.id,
        new_key,
        request_hash,
        new_entry.reservation_generation,
        provider_job_id=new_job.job_id,
        provider_status="queued",
        provider_idempotency_key=provider_key,
    )
    succeeded = service._poll_generation(service.get_task(task.id), new_entry)
    assert succeeded.status is TaskStatus.SUCCEEDED

    late_result = service._poll_generation(old_task, old_entry)
    assert late_result.status is TaskStatus.SUCCEEDED
    current = repository.get_task(task.id)
    assert current is not None
    assert current.status is TaskStatus.SUCCEEDED
    new_record = repository.get_idempotency(task.id, "generate", new_key)
    assert new_record is not None
    assert new_record.result_status is TaskStatus.SUCCEEDED
    old_record = repository.get_idempotency(task.id, "generate", old_key)
    assert old_record is not None
    assert old_record.result_status is TaskStatus.GENERATING
    assert old_record.provider_status == "queued"
    assert old_record.candidate_position == 0


def test_new_generate_key_reclaims_stale_submitting_through_api(api_context):
    client, repository, storage, provider = api_context
    task_id = _prepare_confirmation(client)
    saved = client.post(
        f"/api/v1/tasks/{task_id}/plan",
        json=_plan_payload(),
        headers=INVITE_HEADERS,
    )
    assert saved.status_code == 200
    task = repository.get_task(UUID(task_id))
    assert task is not None and task.plan is not None
    settings = Settings(invite_tokens=["invite-demo"], asset_ttl_hours=1)
    service = TaskService(repository, storage, provider, settings=settings)
    request_hash = _request_hash(service._plan_hash_payload(task.plan))
    provider_key = service._provider_idempotency_key(
        "edit", task.original_asset_url.url, task.plan
    )
    old_entry = repository.reserve_generation_and_mark_task_generating(
        task.id, "generate-submitting-old", request_hash, provider_key
    )
    submitting = repository.begin_provider_submission(
        task.id,
        "generate-submitting-old",
        request_hash,
        old_entry.reservation_generation,
    )
    assert submitting.provider_status == "submitting"
    row = repository.session.scalar(
        select(IdempotencyRow).where(
            IdempotencyRow.task_id == task.id,
            IdempotencyRow.key == "generate-submitting-old",
        )
    )
    row.updated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    repository.session.commit()

    response = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-new-key"}),
    )

    assert response.status_code == 200
    assert response.json()["status"] == "succeeded"
    assert provider.edit_submissions == 1
    stale = repository.get_idempotency(task.id, "generate", "generate-submitting-old")
    assert stale is not None
    assert stale.provider_status == "stale_reservation"
    assert stale.candidate_position is None


def test_follow_up_task_endpoints_require_header_without_leaking_existence(
    api_context,
):
    client, _repository, _storage, _provider = api_context
    task_id = _create(client).json()["task_id"]
    requests = (
        ("get", f"/api/v1/tasks/{task_id}", {}),
        (
            "post",
            f"/api/v1/tasks/{task_id}/analyze",
            {"headers": {"Idempotency-Key": "auth-analyze"}},
        ),
        (
            "post",
            f"/api/v1/tasks/{task_id}/plan",
            {"json": _plan_payload()},
        ),
        (
            "post",
            f"/api/v1/tasks/{task_id}/generate",
            {"headers": {"Idempotency-Key": "auth-generate"}},
        ),
        ("get", f"/api/v1/tasks/{task_id}/download", {}),
    )

    for token in (None, "wrong-token"):
        for method, path, kwargs in requests:
            request_kwargs = dict(kwargs)
            headers = dict(request_kwargs.get("headers", {}))
            if token is not None:
                headers["X-Invite-Token"] = token
            if headers:
                request_kwargs["headers"] = headers
            response = getattr(client, method)(path, **request_kwargs)
            assert response.status_code == 401
            assert response.json()["error"]["code"] == "UNAUTHORIZED"
            assert task_id not in response.text
            assert "original_asset_url" not in response.text


def test_open_mode_allows_task_creation_without_an_invite_token(repository):
    from app.main import create_app

    settings = Settings(
        invite_tokens=["invite-demo"],
        require_invite_tokens=False,
        max_upload_bytes=1024 * 1024,
        asset_ttl_hours=1,
    )
    app = create_app(
        settings=settings,
        repository=repository,
        storage=InMemoryStorageAdapter(settings),
        provider=MockImageModelProvider(settings),
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/tasks",
            json={
                "filename": "cos-photo.jpg",
                "content_type": "image/jpeg",
                "byte_size": 1200,
            },
        )

    assert response.status_code == 200
    assert response.json()["status"] == "uploading"


def test_strict_mode_still_rejects_missing_and_invalid_invite_tokens(repository):
    from app.main import create_app

    settings = Settings(
        invite_tokens=["invite-demo"],
        require_invite_tokens=True,
        max_upload_bytes=1024 * 1024,
        asset_ttl_hours=1,
    )
    app = create_app(
        settings=settings,
        repository=repository,
        storage=InMemoryStorageAdapter(settings),
        provider=MockImageModelProvider(settings),
    )

    with TestClient(app) as client:
        base_payload = {
            "filename": "cos-photo.jpg",
            "content_type": "image/jpeg",
            "byte_size": 1200,
        }
        missing = client.post("/api/v1/tasks", json=base_payload)
        invalid = client.post(
            "/api/v1/tasks",
            json={**base_payload, "invite_token": "wrong-token"},
        )

    for response in (missing, invalid):
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_default_app_scopes_sessions_per_request_and_closes_adapters(tmp_path):
    from app.main import create_app

    class ClosableStorage(InMemoryStorageAdapter):
        def __init__(self, settings):
            super().__init__(settings)
            self.closed = False

        def close(self):
            self.closed = True

    class ClosableProvider(CountingProvider):
        def __init__(self, settings):
            super().__init__(settings)
            self.closed = False

        def close(self):
            self.closed = True

    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'lifecycle.db'}",
        invite_tokens=["invite-demo"],
    )
    storage = ClosableStorage(settings)
    provider = ClosableProvider(settings)
    app = create_app(settings=settings, storage=storage, provider=provider)

    assert not hasattr(app.state, "task_service")
    with TestClient(app) as client:
        created = _create(client)
        assert created.status_code == 200
        task_id = created.json()["task_id"]
        fetched = client.get(f"/api/v1/tasks/{task_id}", headers=INVITE_HEADERS)
        assert fetched.status_code == 200
        assert not hasattr(app.state, "task_service")

    assert storage.closed is True
    assert provider.closed is True


def test_queued_jobs_poll_until_success_with_one_persisted_provider_job(
    scripted_context,
):
    client, repository, _storage, provider, _settings = scripted_context
    provider.analysis_statuses = ("queued", "succeeded")
    provider.edit_statuses = ("queued", "succeeded")
    task_id = _create(client).json()["task_id"]

    analyzed = client.post(
        f"/api/v1/tasks/{task_id}/analyze",
        headers=_authenticated_headers(**{"Idempotency-Key": "analysis-queued"}),
    )
    assert analyzed.status_code == 200
    assert analyzed.json()["status"] == "awaiting_confirmation"
    assert provider.analysis_submissions == 1
    assert provider.poll_counts["analysis-job-1"] == 2

    client.post(
        f"/api/v1/tasks/{task_id}/plan",
        json=_plan_payload(),
        headers=INVITE_HEADERS,
    )
    generated = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-queued"}),
    )
    record = repository.get_idempotency(UUID(task_id), "generate", "generate-queued")

    assert generated.status_code == 200
    assert generated.json()["status"] == "succeeded"
    assert provider.edit_submissions == 1
    assert provider.poll_counts["edit-job-1"] == 2
    assert record is not None
    assert record.provider_status == "succeeded"


def test_queued_job_poll_limit_returns_retryable_task_and_reuses_job_on_retry(
    scripted_context,
):
    client, repository, _storage, provider, _settings = scripted_context
    provider.analysis_statuses = ("queued",)
    task_id = _create(client).json()["task_id"]

    first = client.post(
        f"/api/v1/tasks/{task_id}/analyze",
        headers=_authenticated_headers(**{"Idempotency-Key": "analysis-timeout"}),
    )
    retry = client.post(
        f"/api/v1/tasks/{task_id}/analyze",
        headers=_authenticated_headers(**{"Idempotency-Key": "analysis-timeout"}),
    )
    record = repository.get_idempotency(UUID(task_id), "analyze", "analysis-timeout")

    assert first.status_code == retry.status_code == 200
    assert first.headers.get("Retry-After") == "1"
    assert first.json()["status"] == retry.json()["status"] == "analyzing"
    assert provider.analysis_submissions == 1
    assert provider.poll_counts["analysis-job-1"] == 6
    assert record is not None
    assert record.provider_job_id == "analysis-job-1"
    assert record.result_status is TaskStatus.ANALYZING
    assert record.provider_status == "queued"


def test_provider_failure_persists_failed_idempotency_state_before_safe_error(
    scripted_context,
):
    client, repository, _storage, provider, _settings = scripted_context
    provider.analysis_statuses = ("failed",)
    task_id = _create(client).json()["task_id"]

    response = client.post(
        f"/api/v1/tasks/{task_id}/analyze",
        headers=_authenticated_headers(**{"Idempotency-Key": "analysis-failed"}),
    )
    record = repository.get_idempotency(UUID(task_id), "analyze", "analysis-failed")

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "PROVIDER_ERROR"
    assert record is not None
    assert record.provider_job_id == "analysis-job-1"
    assert record.result_status is TaskStatus.FAILED
    assert record.provider_status == "failed"


def test_database_rejects_duplicate_version_positions_for_one_task(api_context):
    client, repository, _storage, _provider = api_context
    task_id = _create(client).json()["task_id"]
    first = VersionRecord(
        asset_url=AssetURL(
            kind="version",
            url="https://storage.example.test/first.png",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
    )
    second = VersionRecord(
        asset_url=AssetURL(
            kind="version",
            url="https://storage.example.test/second.png",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
    )
    repository.add_version(UUID(task_id), first, position=0)

    with pytest.raises(IntegrityError):
        repository.session.add(
            VersionRow(
                id=second.id,
                task_id=UUID(task_id),
                position=0,
                payload=second.model_dump(mode="json"),
            )
        )
        repository.session.commit()
    repository.session.rollback()


def test_generate_rejects_a_task_that_already_has_two_candidates(api_context):
    client, repository, _storage, provider = api_context
    task_id = _prepare_confirmation(client)
    client.post(
        f"/api/v1/tasks/{task_id}/plan",
        json=_plan_payload(),
        headers=INVITE_HEADERS,
    )

    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    for index in range(2):
        repository.add_version(
            UUID(task_id),
            VersionRecord(
                asset_url=AssetURL(
                    kind="version",
                    url=f"https://storage.example.test/version-{index}.png",
                    expires_at=expires_at,
                )
            ),
        )

    response = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-over-limit"}),
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CANDIDATE_LIMIT"
    assert provider.edit_submissions == 0


def test_succeeded_task_regenerates_into_the_next_candidate_slot(scripted_context):
    client, repository, _storage, provider, _settings = scripted_context
    task_id = _prepare_confirmation(client)
    saved = client.post(
        f"/api/v1/tasks/{task_id}/plan",
        json=_plan_payload(),
        headers=INVITE_HEADERS,
    )
    assert saved.status_code == 200

    first = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-first"}),
    )
    assert first.status_code == 200
    assert first.json()["status"] == "succeeded"
    assert len(first.json()["versions"]) == 1
    first_version_id = first.json()["versions"][0]["id"]
    first_asset_url = first.json()["versions"][0]["asset_url"]["url"]

    provider.edit_statuses = ("queued",)
    second = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-second"}),
    )
    second_record = repository.get_idempotency(
        UUID(task_id), "generate", "generate-second"
    )

    assert second.status_code == 200
    assert second.json()["status"] == "generating"
    assert [version["asset_url"]["url"] for version in second.json()["versions"]] == [
        first_asset_url
    ]
    assert repository.get_task(UUID(task_id)).status is TaskStatus.GENERATING
    assert second_record is not None
    assert second_record.candidate_position == 1

    busy = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-busy"}),
    )
    assert busy.status_code == 409
    assert busy.json()["error"]["code"] == "TASK_NOT_READY"

    provider.edit_statuses = ("succeeded",)
    completed = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-second"}),
    )
    assert completed.status_code == 200
    assert completed.json()["status"] == "succeeded"
    assert len(completed.json()["versions"]) == 2
    assert completed.json()["versions"][0]["id"] == first_version_id
    assert completed.json()["versions"][0]["asset_url"]["url"] == first_asset_url
    stored_versions = repository.session.scalars(
        select(VersionRow)
        .where(VersionRow.task_id == UUID(task_id))
        .order_by(VersionRow.position)
    ).all()
    assert [version.position for version in stored_versions] == [0, 1]
    assert [version.id for version in stored_versions][0] == UUID(first_version_id)

    third = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-third"}),
    )
    assert third.status_code == 409
    assert third.json()["error"]["code"] == "CANDIDATE_LIMIT"
    assert provider.edit_submissions == 2


@pytest.mark.parametrize(
    ("status", "error_code"),
    [
        (TaskStatus.GENERATING, "TASK_NOT_READY"),
        (TaskStatus.VALIDATING, "TASK_NOT_READY"),
        (TaskStatus.EXPIRED, "TASK_EXPIRED"),
    ],
)
def test_generate_rejects_busy_or_expired_tasks(api_context, status, error_code):
    client, repository, _storage, provider = api_context
    task_id = _prepare_confirmation(client)
    client.post(
        f"/api/v1/tasks/{task_id}/plan",
        json=_plan_payload(),
        headers=INVITE_HEADERS,
    )
    generated = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-state-base"}),
    )
    assert generated.status_code == 200

    task_row = repository.session.get(TaskRow, UUID(task_id))
    assert task_row is not None
    task_row.status = status.value
    repository.session.commit()

    response = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-state-new"}),
    )

    assert response.status_code in {409, 410}
    assert response.json()["error"]["code"] == error_code
    assert provider.edit_submissions == 1


def test_download_is_only_available_for_successful_unexpired_task(api_context):
    client, repository, _storage, _provider = api_context
    task_id = _create(client).json()["task_id"]

    not_ready = client.get(f"/api/v1/tasks/{task_id}/download", headers=INVITE_HEADERS)
    assert not_ready.status_code == 409
    assert not_ready.json()["error"]["code"] == "TASK_NOT_READY"

    _prepare_confirmation(client, task_id)
    client.post(
        f"/api/v1/tasks/{task_id}/plan",
        json=_plan_payload(),
        headers=INVITE_HEADERS,
    )
    generated = client.post(
        f"/api/v1/tasks/{task_id}/generate",
        headers=_authenticated_headers(**{"Idempotency-Key": "generate-download"}),
    )
    assert generated.status_code == 200

    available = client.get(f"/api/v1/tasks/{task_id}/download", headers=INVITE_HEADERS)
    assert available.status_code == 200
    assert available.json()["url"].startswith("https://")
    assert available.json()["expires_at"]

    loaded = repository.get_task(__import__("uuid").UUID(task_id))
    assert loaded is not None
    version_row = repository.session.get(VersionRow, loaded.versions[0].id)
    assert version_row is not None
    expired_payload = dict(version_row.payload)
    expired_asset = dict(expired_payload["asset_url"])
    expired_asset["expires_at"] = (
        datetime.now(timezone.utc) - timedelta(seconds=1)
    ).isoformat()
    expired_payload["asset_url"] = expired_asset
    version_row.payload = expired_payload
    repository.session.commit()
    unavailable = client.get(
        f"/api/v1/tasks/{task_id}/download", headers=INVITE_HEADERS
    )
    assert unavailable.status_code == 410
    assert unavailable.json()["error"]["code"] == "TASK_EXPIRED"


def test_provider_failure_is_safe_and_never_returns_raw_upstream_body(api_context):
    client, repository, _storage, _provider = api_context
    from app.main import create_app

    settings = Settings(invite_tokens=["invite-demo"], asset_ttl_hours=1)
    failing = FailingProvider(settings)
    failing_app = create_app(
        settings=settings,
        repository=repository,
        storage=InMemoryStorageAdapter(settings),
        provider=failing,
    )
    with TestClient(failing_app) as failing_client:
        task_id = _create(failing_client).json()["task_id"]
        _prepare_confirmation(failing_client, task_id)
        failing_client.post(
            f"/api/v1/tasks/{task_id}/plan",
            json=_plan_payload(),
            headers=INVITE_HEADERS,
        )
        response = failing_client.post(
            f"/api/v1/tasks/{task_id}/generate",
            headers=_authenticated_headers(
                **{"Idempotency-Key": "generate-provider-error"}
            ),
        )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "PROVIDER_ERROR"
    assert response.json()["error"]["retryable"] is True
    assert "server-only-secret" not in response.text
    assert "upstream body" not in response.text


def test_missing_task_and_missing_idempotency_key_use_stable_errors(api_context):
    client, _repository, _storage, _provider = api_context

    missing = client.get(
        "/api/v1/tasks/00000000-0000-0000-0000-000000000000",
        headers=INVITE_HEADERS,
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "NOT_FOUND"

    task_id = _create(client).json()["task_id"]
    missing_key = client.post(
        f"/api/v1/tasks/{task_id}/analyze", headers=INVITE_HEADERS
    )
    assert missing_key.status_code == 400
    assert missing_key.json()["error"]["code"] == "INVALID_IDEMPOTENCY_KEY"


def test_task_view_redacts_untrusted_error_details_and_assets_without_expiry():
    class UnsafeTask:
        def model_dump(self, **_kwargs):
            return {
                "task_id": "task-unsafe",
                "status": "failed",
                "error": {
                    "code": "PROVIDER_TIMEOUT",
                    "message": "Traceback provider response body storage://private",
                    "retryable": True,
                },
                "original_asset_url": {
                    "kind": "original",
                    "url": "https://storage.example/private-original.jpg",
                    "expires_at": "",
                },
                "versions": [],
            }

    view = _task_view(UnsafeTask())

    assert view["error"] == {
        "code": "PROVIDER_TIMEOUT",
        "message": "图片处理超时，请重试。",
        "retryable": True,
    }
    assert view["original_asset_url"] is None
