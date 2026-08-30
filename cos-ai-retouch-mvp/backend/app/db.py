"""SQLAlchemy schema and database-engine setup for COS retouch tasks."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from pydantic import SecretStr
from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    UniqueConstraint,
    Uuid,
    create_engine,
    event,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from app.config import get_settings


def _sync_database_url(database_url: str | SecretStr) -> str:
    """Adapt configured URLs for the synchronous SQLAlchemy repository."""

    if isinstance(database_url, SecretStr):
        database_url = database_url.get_secret_value()
    if database_url.startswith("sqlite+aiosqlite://"):
        return database_url.replace("sqlite+aiosqlite://", "sqlite://", 1)
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    if database_url.startswith("postgres://"):
        return database_url.replace("postgres://", "postgresql+psycopg://", 1)
    return database_url


def create_db_engine(
    database_url: str | SecretStr | None = None, **kwargs: Any
) -> Engine:
    """Create a SQLAlchemy 2.0 engine from an application or test URL."""

    url = _sync_database_url(database_url or get_settings().database_url)
    engine = create_engine(url, future=True, **kwargs)

    if engine.dialect.name == "sqlite":

        @event.listens_for(engine, "connect")
        def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
            finally:
                cursor.close()

    return engine


class Base(DeclarativeBase):
    """Declarative base shared by the ORM and Alembic metadata."""


JSON_PAYLOAD = JSON().with_variant(JSONB(), "postgresql")
TASK_ID = Uuid(as_uuid=True)


class TaskRow(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        Index("ix_tasks_status_created_at", "status", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(TASK_ID, primary_key=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(
        String(128), nullable=True, index=True
    )
    original_asset_url: Mapped[dict[str, Any] | None] = mapped_column(
        JSON_PAYLOAD, nullable=True
    )
    mask_asset_url: Mapped[dict[str, Any] | None] = mapped_column(
        JSON_PAYLOAD, nullable=True
    )
    error: Mapped[dict[str, Any] | None] = mapped_column(JSON_PAYLOAD, nullable=True)


class AssetRow(Base):
    __tablename__ = "assets"
    __table_args__ = (
        UniqueConstraint(
            "task_id",
            "kind",
            "payload",
            name="uq_assets_task_kind_payload",
        ),
        Index("ix_assets_task_kind", "task_id", "kind"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[UUID] = mapped_column(
        TASK_ID,
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON_PAYLOAD, nullable=False)


class AnalysisCardRow(Base):
    __tablename__ = "analysis_cards"
    __table_args__ = (
        Index("ix_analysis_cards_task_position", "task_id", "position"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[UUID] = mapped_column(
        TASK_ID,
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    card_id: Mapped[str] = mapped_column(String(255), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON_PAYLOAD, nullable=False)


class EditPlanRow(Base):
    __tablename__ = "edit_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[UUID] = mapped_column(
        TASK_ID,
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSON_PAYLOAD, nullable=False)


class VersionRow(Base):
    __tablename__ = "versions"
    __table_args__ = (
        UniqueConstraint(
            "task_id",
            "position",
            name="uq_versions_task_position",
        ),
        Index("ix_versions_task_position", "task_id", "position"),
    )

    id: Mapped[UUID] = mapped_column(TASK_ID, primary_key=True)
    task_id: Mapped[UUID] = mapped_column(
        TASK_ID,
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON_PAYLOAD, nullable=False)


class IdempotencyRow(Base):
    """Durable provider-operation state used to make retries crash-safe."""

    __tablename__ = "idempotency_records"
    __table_args__ = (
        UniqueConstraint(
            "task_id",
            "operation",
            "key",
            name="uq_idempotency_task_operation_key",
        ),
        UniqueConstraint(
            "task_id",
            "operation",
            "candidate_position",
            name="uq_idempotency_task_operation_candidate",
        ),
        Index("ix_idempotency_task_operation", "task_id", "operation"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[UUID] = mapped_column(
        TASK_ID,
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    operation: Mapped[str] = mapped_column(String(16), nullable=False)
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    result_status: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_job_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_idempotency_key: Mapped[str | None] = mapped_column(
        String(128), nullable=True
    )
    provider_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    candidate_position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # This is intentionally not an FK: the UUID is written before the version
    # row so a crash between durable result preparation and finalization can be
    # recovered by the same idempotency record.
    version_id: Mapped[UUID | None] = mapped_column(TASK_ID, nullable=True)
    result_asset_url: Mapped[dict[str, Any] | None] = mapped_column(
        JSON_PAYLOAD, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )




# Short aliases are useful to callers that prefer model names without the
# persistence-specific Row suffix.
TaskModel = TaskRow
AssetModel = AssetRow
AnalysisCardModel = AnalysisCardRow
EditPlanModel = EditPlanRow
VersionModel = VersionRow
IdempotencyModel = IdempotencyRow


settings = get_settings()
engine = create_db_engine(settings.get_database_url())
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def utc_now() -> datetime:
    """Return an aware UTC timestamp for database updates."""

    return datetime.now(timezone.utc)
