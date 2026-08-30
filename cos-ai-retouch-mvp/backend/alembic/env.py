"""Alembic runtime configuration for the COS retouch schema."""

from logging.config import fileConfig
import os

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.db import Base, _sync_database_url


config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
_DEFAULT_URL = "sqlite:///./cos-retouch-test.db"


def _configured_url() -> str:
    configured = config.get_main_option("sqlalchemy.url")
    if not configured or (
        configured == _DEFAULT_URL and os.getenv("DATABASE_URL")
    ):
        configured = os.getenv("DATABASE_URL") or _DEFAULT_URL
    return _sync_database_url(configured)


def run_migrations_offline() -> None:
    context.configure(
        url=_configured_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = _configured_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
