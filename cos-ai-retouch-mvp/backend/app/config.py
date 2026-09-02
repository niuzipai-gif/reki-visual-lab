"""Application settings for the COS AI retouch MVP."""

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
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

    database_url: SecretStr = SecretStr("sqlite+aiosqlite:///./cos-retouch-test.db")
    allowed_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173"]
    )
    invite_tokens: list[SecretStr] = Field(default_factory=list)
    require_invite_tokens: bool = False
    asset_ttl_hours: int = 24
    max_upload_bytes: int = 20 * 1024 * 1024
    runtime_environment: Literal["development", "production", "test"] = "development"
    image_provider_mode: Literal["mock", "external", "minimax"] = "mock"
    image_provider_api_key: SecretStr | None = Field(default=None, repr=False)
    image_provider_base_url: str | None = None
    image_provider_model: str = "cos-retouch-default"

    storage_endpoint: str | None = Field(default=None, repr=False)
    storage_bucket: str | None = None
    storage_region: str | None = None
    storage_access_key: SecretStr | None = Field(default=None, repr=False)
    storage_secret_key: SecretStr | None = Field(default=None, repr=False)
    storage_signing_secret: SecretStr = Field(
        default=SecretStr("local-development-signing-secret"), repr=False
    )
    storage_public_url: str | None = None

    def get_database_url(self) -> str:
        """Return the database URL for trusted server-side engine setup."""

        return self.database_url.get_secret_value()

    def get_invite_tokens(self) -> tuple[str, ...]:
        """Return invite tokens for trusted server-side authentication checks."""

        return tuple(token.get_secret_value() for token in self.invite_tokens)

    @staticmethod
    def _get_secret(value: SecretStr | None) -> str | None:
        return value.get_secret_value() if value is not None else None

    def get_image_provider_api_key(self) -> str | None:
        return self._get_secret(self.image_provider_api_key)

    def get_storage_access_key(self) -> str | None:
        return self._get_secret(self.storage_access_key)

    def get_storage_secret_key(self) -> str | None:
        return self._get_secret(self.storage_secret_key)

    def get_storage_signing_secret(self) -> str:
        return self.storage_signing_secret.get_secret_value()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings instance used by application wiring."""

    return Settings()
