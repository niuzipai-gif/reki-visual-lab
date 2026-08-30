from datetime import datetime, timezone
from urllib.parse import unquote, urlparse
from uuid import uuid4

import pytest

from app.config import Settings
from app.services.storage import (
    InMemoryStorageAdapter,
    S3StorageAdapter,
    StorageError,
    mask_object_key,
    version_object_key,
)


def test_memory_storage_uses_a_basename_and_returns_an_expiring_upload_asset():
    settings = Settings(asset_ttl_hours=2, max_upload_bytes=1024)
    storage = InMemoryStorageAdapter(settings)
    task_id = uuid4()

    asset = storage.create_upload_url(
        task_id,
        r"C:\uploads\..\cos-look.png",
        "image/png",
        content_length=1024,
    )

    assert asset.kind == "original"
    assert asset.object_key == f"tasks/{task_id}/original/cos-look.png"
    assert asset.expires_at > datetime.now(timezone.utc)
    assert "X-Amz-Expires=7200" in asset.url
    assert "tasks/" in unquote(urlparse(asset.url).path)
    assert "uploads" not in asset.url
    assert ".." not in asset.object_key


@pytest.mark.parametrize("content_type", ["image/gif", "application/octet-stream", "IMAGE/PNG"])
def test_storage_rejects_content_types_before_signing(content_type):
    storage = InMemoryStorageAdapter(Settings(max_upload_bytes=100))

    with pytest.raises(StorageError, match="unsupported content type"):
        storage.create_upload_url(
            uuid4(),
            "cos-look.png",
            content_type,
            content_length=1,
        )


def test_storage_rejects_an_oversized_upload_before_signing():
    storage = InMemoryStorageAdapter(Settings(max_upload_bytes=100))

    with pytest.raises(StorageError, match="maximum upload size"):
        storage.create_upload_url(
            uuid4(),
            "cos-look.jpg",
            "image/jpeg",
            content_length=101,
        )


def test_storage_builds_scoped_mask_and_version_keys_and_deletes_memory_objects():
    storage = InMemoryStorageAdapter(Settings())
    task_id = uuid4()
    mask_id = uuid4()
    version_id = uuid4()

    mask_key = mask_object_key(task_id, mask_id)
    version_key = version_object_key(task_id, version_id)
    assert mask_key == f"tasks/{task_id}/mask/{mask_id}.json"
    assert version_key == f"tasks/{task_id}/versions/{version_id}.png"

    storage.put_object(version_key, b"png marker", content_type="image/png")
    assert version_key in storage.objects
    storage.delete_object(version_key)
    assert version_key not in storage.objects


class _PresigningS3Client:
    def __init__(self):
        self.presign_calls = []
        self.delete_calls = []

    def generate_presigned_url(self, operation, *, Params, ExpiresIn, HttpMethod=None):
        self.presign_calls.append((operation, Params, ExpiresIn, HttpMethod))
        return f"https://s3.example.test/{Params['Key']}?X-Amz-Expires={ExpiresIn}"

    def delete_object(self, **kwargs):
        self.delete_calls.append(kwargs)


def test_s3_storage_uses_boto3_presigning_for_upload_and_download():
    client = _PresigningS3Client()
    settings = Settings(
        asset_ttl_hours=1,
        max_upload_bytes=2048,
        storage_bucket="retouch-assets",
        storage_region="eu-west-1",
        storage_endpoint="https://s3.example.test",
        storage_access_key="access",
        storage_secret_key="secret",
    )
    storage = S3StorageAdapter(settings, client=client)
    task_id = uuid4()

    upload = storage.create_upload_url(
        task_id,
        "look.jpg",
        "image/jpeg",
        content_length=12,
    )
    download = storage.create_download_url(upload.object_key)
    storage.delete_object(upload.object_key)

    assert upload.kind == "original"
    assert upload.object_key in upload.url
    assert download.endswith("X-Amz-Expires=3600")
    assert [call[0] for call in client.presign_calls] == ["put_object", "get_object"]
    assert client.presign_calls[0][1]["ContentType"] == "image/jpeg"
    assert client.presign_calls[0][2] == 3600
    assert client.delete_calls == [{"Bucket": "retouch-assets", "Key": upload.object_key}]
