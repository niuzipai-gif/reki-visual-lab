"""Expiry cleanup for task-owned object-storage assets."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from app.domain.models import AssetURL, TaskRecord


def _object_key(task_id: UUID, asset: AssetURL | None) -> str | None:
    """Return only task-scoped storage keys that this service can delete."""

    if asset is None or not isinstance(asset.url, str):
        return None
    try:
        parts = urlsplit(asset.url).path.lstrip("/").split("/")
    except ValueError:
        return None
    if len(parts) != 4 or parts[0] != "tasks" or parts[1] != str(task_id):
        return None
    if parts[2] not in {"original", "mask", "versions"} or not all(parts):
        return None
    if parts[2] == "mask" and not parts[3].endswith(".json"):
        return None
    if parts[2] == "versions" and not parts[3].endswith(".png"):
        return None
    return "/".join(parts)


def _task_asset_keys(task: TaskRecord) -> set[str]:
    assets: list[AssetURL | None] = [task.original_asset_url, task.mask_asset_url]
    assets.extend(version.asset_url for version in task.versions)
    return {key for asset in assets if (key := _object_key(task.id, asset)) is not None}


def cleanup_expired_assets(
    repository: Any,
    storage: Any,
    *,
    now: datetime | None = None,
    ttl_hours: int = 24,
) -> int:
    """Delete task assets older than the configured retention window.

    Metadata is cleared in the same repository operation after object deletion,
    which prevents an expired task from retaining a usable download URL.
    """

    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None or current.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    if ttl_hours <= 0:
        raise ValueError("ttl_hours must be positive")
    cutoff = current.astimezone(timezone.utc) - timedelta(hours=ttl_hours)
    expired_tasks = repository.list_tasks_before(cutoff)
    cleaned = 0
    for task in expired_tasks:
        for key in _task_asset_keys(task):
            storage.delete_object(key)
        repository.clear_expired_assets(task.id)
        cleaned += 1
    return cleaned


__all__ = ["cleanup_expired_assets"]
