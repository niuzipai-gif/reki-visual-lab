"""Application settings for the COS AI retouch MVP."""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed environment-backed application configuration.

    Storage credentials and provider credentials intentionally have no local
    defaults.  The mock provider and SQLite test database can therefore be
    used without putting secrets in a repository or a test fixture.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    database_url: str = "sqlite+aiosqlite:///./cos-retouch-test.db"
    allowed_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173"]
    )
    invite_tokens: list[str] = Field(default_factory=list)
    asset_ttl_hours: int = 24
    max_upload_bytes: int = 20 * 1024 * 1024
    image_provider_mode: Literal["mock", "external"] = "mock"
    image_provider_api_key: str | None = Field(default=None, repr=False)
    image_provider_base_url: str | None = None
    image_provider_model: str = "cos-retouch-default"

    storage_endpoint: str | None = Field(default=None, repr=False)
    storage_bucket: str | None = None
    storage_region: str | None = None
    storage_access_key: str | None = Field(default=None, repr=False)
    storage_secret_key: str | None = Field(default=None, repr=False)
    storage_public_url: str | None = None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings instance used by application wiring."""

    return Settings()
