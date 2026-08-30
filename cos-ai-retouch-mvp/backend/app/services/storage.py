"""S3-compatible and in-memory storage adapters for task assets."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any, Protocol
from urllib.parse import quote
from uuid import UUID

import boto3
from pydantic import ConfigDict

from app.config import Settings, get_settings
from app.domain.models import AssetURL


class StorageError(ValueError):
    """A safe, user-facing storage validation or adapter error."""


class SignedAsset(AssetURL):
    """A signed asset URL together with its internal object key."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    object_key: str
    content_type: str | None = None

    @property
    def key(self) -> str:
        """Return the internal key under the conventional short name."""

        return self.object_key


class StorageAdapter(Protocol):
    """The storage boundary used by the task service."""

    def create_upload_url(
        self,
        task_id: UUID,
        filename: str,
        content_type: str,
        content_length: int | None = None,
    ) -> SignedAsset: ...

    def create_download_url(self, object_key: str) -> str: ...

    def put_object(
        self, object_key: str, body: bytes, *, content_type: str
    ) -> None: ...

    def delete_object(self, object_key: str) -> None: ...


_ALLOWED_CONTENT_TYPES = frozenset({"image/jpeg", "image/png"})


def _safe_basename(filename: str) -> str:
    if not isinstance(filename, str) or not filename:
        raise StorageError("filename must not be empty")
    if "\x00" in filename:
        raise StorageError("filename contains an invalid character")

    basename = filename.replace("\\", "/").rsplit("/", 1)[-1].strip()
    if basename in {"", ".", ".."}:
        raise StorageError("filename must contain a basename")
    return basename


def _safe_component(value: UUID | str, label: str) -> str:
    component = str(value)
    if (
        not component
        or component in {".", ".."}
        or "\x00" in component
        or "/" in component
        or "\\" in component
    ):
        raise StorageError(f"{label} contains an invalid path component")
    return component


def original_object_key(task_id: UUID, filename: str) -> str:
    """Build the task-scoped key for an uploaded original."""

    return (
        f"tasks/{_safe_component(task_id, 'task_id')}/original/"
        f"{_safe_basename(filename)}"
    )


def mask_object_key(task_id: UUID, mask_id: UUID | str) -> str:
    """Build the task-scoped JSON key for a normalized mask."""

    return (
        f"tasks/{_safe_component(task_id, 'task_id')}/mask/"
        f"{_safe_component(mask_id, 'mask_id')}.json"
    )


def version_object_key(task_id: UUID, version_id: UUID | str) -> str:
    """Build the task-scoped PNG key for a generated version."""

    return (
        f"tasks/{_safe_component(task_id, 'task_id')}/versions/"
        f"{_safe_component(version_id, 'version_id')}.png"
    )


def version_position_object_key(task_id: UUID, position: int) -> str:
    """Build the stable task-scoped key used for a candidate slot."""

    if isinstance(position, bool) or position not in (0, 1):
        raise StorageError("version position must be 0 or 1")
    return f"tasks/{_safe_component(task_id, 'task_id')}/versions/{position}.png"


def _validate_upload(
    settings: Settings,
    filename: str,
    content_type: str,
    content_length: int | None,
) -> str:
    safe_filename = _safe_basename(filename)
    if content_type not in _ALLOWED_CONTENT_TYPES:
        raise StorageError("unsupported content type; use image/jpeg or image/png")
    if content_length is None:
        raise StorageError("content length is required before signing")
    if content_length is not None and (
        not isinstance(content_length, int) or isinstance(content_length, bool)
    ):
        raise StorageError("content length must be a non-negative integer")
    if content_length is not None and content_length < 0:
        raise StorageError("content length must be a non-negative integer")
    if content_length is not None and content_length > settings.max_upload_bytes:
        raise StorageError("upload exceeds the maximum upload size")
    return safe_filename


def _ttl_seconds(settings: Settings) -> int:
    ttl_seconds = settings.asset_ttl_hours * 60 * 60
    if ttl_seconds <= 0:
        raise StorageError("asset URL expiry must be positive")
    return ttl_seconds


def _expires_at(settings: Settings) -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=_ttl_seconds(settings))


def _asset(
    *,
    kind: str,
    url: str,
    object_key: str,
    content_type: str | None,
    expires_at: datetime,
) -> SignedAsset:
    return SignedAsset(
        kind=kind,
        url=url,
        expires_at=expires_at,
        object_key=object_key,
        content_type=content_type,
    )


def _validate_object_key(object_key: str) -> str:
    if not isinstance(object_key, str) or not object_key or "\x00" in object_key:
        raise StorageError("object key must not be empty")
    if "\\" in object_key:
        raise StorageError("object key contains an invalid path separator")

    parts = object_key.split("/")
    if len(parts) != 4 or parts[0] != "tasks":
        raise StorageError("object key is outside the asset namespace")
    if any(not part or part in {".", ".."} for part in parts):
        raise StorageError("object key contains an invalid path component")
    if parts[2] not in {"original", "mask", "versions"}:
        raise StorageError("object key is outside the asset namespace")
    if parts[2] == "mask" and not parts[3].endswith(".json"):
        raise StorageError("mask object key must end with .json")
    if parts[2] == "versions" and not parts[3].endswith(".png"):
        raise StorageError("version object key must end with .png")
    return object_key


class InMemoryStorageAdapter:
    """Deterministic fake storage for local development and tests."""

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.objects: dict[str, bytes] = {}
        self.content_types: dict[str, str] = {}

    def _signed_url(
        self,
        object_key: str,
        expires_at: datetime,
        content_length: int | None = None,
    ) -> str:
        encoded_key = quote(object_key, safe="/")
        expires = int(expires_at.timestamp())
        signature = sha256(f"{object_key}:{expires}".encode("utf-8")).hexdigest()
        size_query = (
            f"&X-Upload-Content-Length={content_length}"
            if content_length is not None
            else ""
        )
        return (
            f"https://storage.local/{encoded_key}"
            f"?X-Amz-Expires={_ttl_seconds(self.settings)}"
            f"&X-Amz-Date={expires}&X-Amz-Signature={signature}{size_query}"
        )

    def create_upload_url(
        self,
        task_id: UUID,
        filename: str,
        content_type: str,
        content_length: int | None = None,
    ) -> SignedAsset:
        safe_filename = _validate_upload(
            self.settings, filename, content_type, content_length
        )
        object_key = original_object_key(task_id, safe_filename)
        expires_at = _expires_at(self.settings)
        return _asset(
            kind="original",
            url=self._signed_url(object_key, expires_at, content_length),
            object_key=object_key,
            content_type=content_type,
            expires_at=expires_at,
        )

    def create_download_url(self, object_key: str) -> str:
        object_key = _validate_object_key(object_key)
        return self._signed_url(object_key, _expires_at(self.settings))

    def delete_object(self, object_key: str) -> None:
        object_key = _validate_object_key(object_key)
        self.objects.pop(object_key, None)
        self.content_types.pop(object_key, None)

    def put_object(self, object_key: str, body: bytes, *, content_type: str) -> None:
        """Store bytes in the fake using the same key boundary as S3."""

        object_key = _validate_object_key(object_key)
        if not isinstance(body, bytes):
            raise StorageError("object body must be bytes")
        self.objects[object_key] = body
        self.content_types[object_key] = content_type


class S3StorageAdapter:
    """Storage adapter backed by an S3-compatible service."""

    def __init__(self, settings: Settings | None = None, *, client: Any = None):
        self.settings = settings or get_settings()
        if not self.settings.storage_bucket:
            raise StorageError("storage bucket is not configured")
        self.bucket = self.settings.storage_bucket
        self.client = client or self._build_client()

    def _build_client(self) -> Any:
        access_key = self.settings.get_storage_access_key()
        secret_key = self.settings.get_storage_secret_key()
        if (access_key is None) != (secret_key is None):
            raise StorageError("storage credentials are incomplete")

        kwargs: dict[str, Any] = {}
        if self.settings.storage_endpoint:
            kwargs["endpoint_url"] = self.settings.storage_endpoint
        if self.settings.storage_region:
            kwargs["region_name"] = self.settings.storage_region
        if access_key is not None:
            kwargs["aws_access_key_id"] = access_key
            kwargs["aws_secret_access_key"] = secret_key
        return boto3.client("s3", **kwargs)

    def _presign(
        self,
        operation: str,
        object_key: str,
        *,
        content_type: str | None = None,
        content_length: int | None = None,
    ) -> tuple[str, datetime]:
        object_key = _validate_object_key(object_key)
        expires_at = _expires_at(self.settings)
        params: dict[str, Any] = {"Bucket": self.bucket, "Key": object_key}
        if content_type is not None:
            params["ContentType"] = content_type
        if content_length is not None:
            params["ContentLength"] = content_length
        try:
            url = self.client.generate_presigned_url(
                operation,
                Params=params,
                ExpiresIn=_ttl_seconds(self.settings),
                HttpMethod="PUT" if operation == "put_object" else "GET",
            )
        except Exception as exc:
            raise StorageError("storage URL signing failed") from exc
        if not isinstance(url, str) or not url:
            raise StorageError("storage URL signing failed")
        return url, expires_at

    def create_upload_url(
        self,
        task_id: UUID,
        filename: str,
        content_type: str,
        content_length: int | None = None,
    ) -> SignedAsset:
        safe_filename = _validate_upload(
            self.settings, filename, content_type, content_length
        )
        object_key = original_object_key(task_id, safe_filename)
        url, expires_at = self._presign(
            "put_object",
            object_key,
            content_type=content_type,
            content_length=content_length,
        )
        return _asset(
            kind="original",
            url=url,
            object_key=object_key,
            content_type=content_type,
            expires_at=expires_at,
        )

    def create_download_url(self, object_key: str) -> str:
        url, _ = self._presign("get_object", object_key)
        return url

    def put_object(self, object_key: str, body: bytes, *, content_type: str) -> None:
        object_key = _validate_object_key(object_key)
        if not isinstance(body, bytes) or not body:
            raise StorageError("storage object body must not be empty")
        if not isinstance(content_type, str) or not content_type:
            raise StorageError("storage object content type is required")
        try:
            self.client.put_object(
                Bucket=self.bucket,
                Key=object_key,
                Body=body,
                ContentType=content_type,
            )
        except Exception as exc:
            raise StorageError("storage object upload failed") from exc

    def delete_object(self, object_key: str) -> None:
        object_key = _validate_object_key(object_key)
        try:
            self.client.delete_object(Bucket=self.bucket, Key=object_key)
        except Exception as exc:
            raise StorageError("storage object deletion failed") from exc


MemoryStorageAdapter = InMemoryStorageAdapter
S3Storage = S3StorageAdapter


__all__ = [
    "InMemoryStorageAdapter",
    "MemoryStorageAdapter",
    "S3Storage",
    "S3StorageAdapter",
    "SignedAsset",
    "StorageAdapter",
    "StorageError",
    "mask_object_key",
    "original_object_key",
    "version_object_key",
    "version_position_object_key",
]
