from __future__ import annotations

import pytest

from app.config import Settings, get_settings


def test_default_production_path_requires_storage_bucket(monkeypatch, tmp_path):
    # The module-level ASGI app is constructed at import time; give that
    # separate application a valid storage bucket before importing it.
    monkeypatch.setenv("STORAGE_BUCKET", "test-bucket")
    get_settings.cache_clear()

    from app.main import create_app

    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'production.db'}",
        storage_bucket=None,
        runtime_environment="production",
    )
    with pytest.raises(RuntimeError, match="STORAGE_BUCKET"):
        create_app(settings=settings)
