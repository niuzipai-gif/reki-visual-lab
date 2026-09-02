"""FastAPI application factory and server-side dependency wiring."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text
from sqlalchemy.orm import sessionmaker

from app.api.routes_tasks import (
    maintenance_router,
    router as tasks_router,
    storage_router,
)
from app.config import Settings, get_settings
from app.db import create_db_engine
from app.repositories.tasks import TaskRepository
from app.services.image_provider import create_image_provider
from app.services.storage import InMemoryStorageAdapter, S3StorageAdapter
from app.services.task_service import (
    TaskService,
    TaskServiceError,
    ValidationAdapter,
)


def _safe_error(code: str, message: str, status_code: int) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


def _upgrade_schema(database_url: str) -> None:
    """Apply committed Alembic migrations before serving requests."""

    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
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


async def _close_adapter(adapter: Any) -> None:
    close = getattr(adapter, "close", None)
    if not callable(close):
        return
    result = close()
    if hasattr(result, "__await__"):
        await result


@asynccontextmanager
async def _lifespan(app: FastAPI):
    try:
        yield
    finally:
        if getattr(app.state, "manage_adapters", False):
            for adapter in (
                getattr(app.state, "provider", None),
                getattr(app.state, "storage", None),
            ):
                try:
                    await _close_adapter(adapter)
                except Exception:
                    # Shutdown must still dispose the DB engine if an adapter
                    # has a best-effort close failure.
                    continue
        engine = getattr(app.state, "db_engine", None)
        if engine is not None:
            engine.dispose()


def create_app(
    settings: Settings | None = None,
    *,
    repository: TaskRepository | None = None,
    storage: Any = None,
    provider: Any = None,
    session_factory: sessionmaker | None = None,
    validation_adapter: ValidationAdapter | None = None,
) -> FastAPI:
    """Build an app with injectable adapters and request-scoped DB services."""

    resolved = settings or get_settings()
    app = FastAPI(
        title="COS AI Retouch MVP",
        version="0.1.0",
        lifespan=_lifespan,
    )

    default_production_path = repository is None
    if (
        default_production_path
        and storage is None
        and resolved.runtime_environment == "production"
        and not resolved.storage_bucket
    ):
        raise RuntimeError(
            "STORAGE_BUCKET must be configured for the default production "
            "storage path."
        )

    if default_production_path:
        _upgrade_schema(resolved.get_database_url())
        engine = create_db_engine(resolved.get_database_url())
        factory = session_factory or sessionmaker(
            bind=engine,
            autoflush=False,
            expire_on_commit=False,
        )
        # No session is opened here. The dependency owns one per request.
        app.state.db_engine = engine
        app.state.session_factory = factory
    else:
        # Explicit injection is the test/embedding path and may own its service.
        app.state.task_service = None

    if storage is None:
        storage = (
            S3StorageAdapter(resolved)
            if resolved.storage_bucket
            else InMemoryStorageAdapter(resolved)
        )
    if provider is None:
        provider = create_image_provider(resolved)

    app.state.settings = resolved
    app.state.storage = storage
    app.state.provider = provider
    app.state.manage_adapters = default_production_path
    if not default_production_path:
        app.state.task_service = TaskService(
            repository,
            storage,
            provider,
            settings=resolved,
            validation_adapter=validation_adapter,
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
        response = {"error": {"code": exc.code, "message": exc.message}}
        if exc.retryable:
            response["error"]["retryable"] = True
        return JSONResponse(status_code=exc.status_code, content=response)

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(
        _request: Request, _exc: RequestValidationError
    ) -> JSONResponse:
        return _safe_error("INVALID_REQUEST", "请求格式无效。", 400)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(tasks_router)
    app.include_router(maintenance_router)
    app.include_router(storage_router)
    return app


app = create_app()


__all__ = ["app", "create_app"]
