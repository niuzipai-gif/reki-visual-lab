"""FastAPI application factory and server-side dependency wiring."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings, get_settings
from app.db import create_db_engine
from app.repositories.tasks import TaskRepository
from app.services.image_provider import create_image_provider
from app.services.storage import InMemoryStorageAdapter, S3StorageAdapter
from app.services.task_service import TaskService, TaskServiceError
from app.api.routes_tasks import router as tasks_router


def _safe_error(code: str, message: str, status_code: int) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


def _upgrade_schema(database_url: str) -> None:
    """Apply committed Alembic migrations before opening the repository."""

    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    # Alembic's ConfigParser treats percent signs as interpolation markers.
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    # Adopt a pre-Alembic development database as the immutable 0001 baseline,
    # then let 0002 add the coordination schema. Existing schemas are never
    # changed through create_all.
    existing_engine = create_db_engine(database_url)
    try:
        inspector = inspect(existing_engine)
        tables = set(inspector.get_table_names())
        has_migration_history = False
        if "alembic_version" in tables:
            with existing_engine.connect() as connection:
                has_migration_history = bool(
                    connection.execute(
                        text("SELECT 1 FROM alembic_version LIMIT 1")
                    ).first()
                )
    finally:
        existing_engine.dispose()
    baseline_tables = {"tasks", "assets", "analysis_cards", "edit_plans", "versions"}
    if not has_migration_history and baseline_tables.issubset(tables):
        command.stamp(config, "0001_initial")
    command.upgrade(config, "head")


def create_app(
    settings: Settings | None = None,
    *,
    repository: TaskRepository | None = None,
    storage: Any = None,
    provider: Any = None,
    session_factory: sessionmaker | None = None,
) -> FastAPI:
    """Build an app with injectable repository, storage, and provider adapters."""

    resolved = settings or get_settings()
    app = FastAPI(title="COS AI Retouch MVP", version="0.1.0")

    if repository is None:
        _upgrade_schema(resolved.get_database_url())
        engine = create_db_engine(resolved.get_database_url())
        factory = session_factory or sessionmaker(
            bind=engine,
            autoflush=False,
            expire_on_commit=False,
        )
        session: Session = factory()
        repository = TaskRepository(session)
        app.state.db_engine = engine
        app.state.db_session = session

    if storage is None:
        storage = (
            S3StorageAdapter(resolved)
            if resolved.storage_bucket
            else InMemoryStorageAdapter(resolved)
        )
    if provider is None:
        provider = create_image_provider(resolved)

    app.state.settings = resolved
    app.state.task_service = TaskService(
        repository,
        storage,
        provider,
        settings=resolved,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved.allowed_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(TaskServiceError)
    async def handle_task_service_error(
        _request: Request, exc: TaskServiceError
    ) -> JSONResponse:
        return _safe_error(exc.code, exc.message, exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(
        _request: Request, _exc: RequestValidationError
    ) -> JSONResponse:
        return _safe_error("INVALID_REQUEST", "请求格式无效。", 400)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(tasks_router)
    return app


app = create_app()


__all__ = ["app", "create_app"]
