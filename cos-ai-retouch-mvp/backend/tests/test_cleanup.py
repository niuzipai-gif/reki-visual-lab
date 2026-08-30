from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from app.config import Settings
from app.domain.models import AssetURL, TaskRecord, TaskStatus, VersionRecord
from app.services.image_provider import MockImageModelProvider
from app.services.storage import (
    InMemoryStorageAdapter,
    mask_object_key,
    original_object_key,
    version_object_key,
)
from app.services.cleanup import cleanup_expired_assets
from app.services.task_service import TaskService


def _asset(kind: str, key: str, expires_at: datetime) -> AssetURL:
    return AssetURL(
        kind=kind,  # type: ignore[arg-type]
        url=f"https://storage.local/{key}",
        expires_at=expires_at,
    )


def _expired_task(repository, storage, *, created_at: datetime):
    task_id = uuid4()
    expires_at = created_at + timedelta(hours=24)
    original_key = original_object_key(task_id, "cos-photo.jpg")
    mask_id = uuid4()
    mask_key = mask_object_key(task_id, mask_id)
    task = TaskRecord(
        id=task_id,
        status=TaskStatus.SUCCEEDED,
        created_at=created_at,
        updated_at=created_at,
        original_asset_url=_asset("original", original_key, expires_at),
        mask_asset_url=_asset("mask", mask_key, expires_at),
    )
    repository.create_task(task)
    version_id = UUID("00000000-0000-0000-0000-000000000001")
    version = VersionRecord(
        id=version_id,
        asset_url=_asset(
            "version",
            version_object_key(task_id, version_id),
            expires_at,
        ),
    )
    repository.add_version(task_id, version, position=0)
    result_key = version_object_key(task_id, version.id)
    for key in (original_key, mask_key, result_key):
        storage.put_object(key, b"asset", content_type="application/octet-stream")
    return task_id, (original_key, mask_key, result_key)


def test_cleanup_expired_assets_deletes_all_asset_objects_and_download_metadata(
    repository,
):
    settings = Settings(asset_ttl_hours=24)
    storage = InMemoryStorageAdapter(settings)
    now = datetime.now(timezone.utc)
    task_id, keys = _expired_task(
        repository,
        storage,
        created_at=now - timedelta(hours=25),
    )

    deleted = cleanup_expired_assets(repository, storage, now=now)

    assert deleted == 1
    assert all(key not in storage.objects for key in keys)
    expired = repository.get_task(task_id)
    assert expired is not None
    assert expired.status is TaskStatus.EXPIRED
    assert expired.original_asset_url is None
    assert expired.mask_asset_url is None
    assert expired.versions == ()


def test_cleanup_expired_assets_leaves_tasks_inside_the_24_hour_window_untouched(
    repository,
):
    settings = Settings(asset_ttl_hours=24)
    storage = InMemoryStorageAdapter(settings)
    now = datetime.now(timezone.utc)
    task_id, keys = _expired_task(
        repository,
        storage,
        created_at=now - timedelta(hours=23),
    )

    deleted = cleanup_expired_assets(repository, storage, now=now)

    assert deleted == 0
    assert all(key in storage.objects for key in keys)
    current = repository.get_task(task_id)
    assert current is not None
    assert current.status is TaskStatus.SUCCEEDED
    assert current.versions


def test_creating_a_task_runs_expired_asset_cleanup(repository):
    settings = Settings(invite_tokens=["invite-demo"], asset_ttl_hours=24)
    storage = InMemoryStorageAdapter(settings)
    now = datetime.now(timezone.utc)
    expired_id, expired_keys = _expired_task(
        repository,
        storage,
        created_at=now - timedelta(hours=25),
    )

    service = TaskService(
        repository,
        storage,
        MockImageModelProvider(settings),
        settings=settings,
    )
    created, _upload = service.create_task(
        "invite-demo",
        "new-photo.jpg",
        "image/jpeg",
        12,
    )

    assert created.status is TaskStatus.UPLOADING
    assert repository.get_task(expired_id).status is TaskStatus.EXPIRED
    assert all(key not in storage.objects for key in expired_keys)


def test_maintenance_cleanup_reuses_invite_boundary_and_returns_cleanup_count(
    repository,
):
    from fastapi.testclient import TestClient

    from app.main import create_app

    settings = Settings(invite_tokens=["invite-demo"], asset_ttl_hours=24)
    storage = InMemoryStorageAdapter(settings)
    old_id, old_keys = _expired_task(
        repository,
        storage,
        created_at=datetime.now(timezone.utc) - timedelta(hours=25),
    )
    app = create_app(
        settings=settings,
        repository=repository,
        storage=storage,
        provider=MockImageModelProvider(settings),
    )

    with TestClient(app) as client:
        denied = client.post("/api/v1/maintenance/cleanup")
        allowed = client.post(
            "/api/v1/maintenance/cleanup",
            headers={"X-Invite-Token": "invite-demo"},
        )

    assert denied.status_code == 401
    assert allowed.status_code == 200
    assert allowed.json() == {"cleaned_tasks": 1}
    assert repository.get_task(old_id).status is TaskStatus.EXPIRED
    assert all(key not in storage.objects for key in old_keys)
