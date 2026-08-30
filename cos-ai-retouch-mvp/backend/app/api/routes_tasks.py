"""REST routes for the invite-only COS retouch task workflow."""

from __future__ import annotations

from collections.abc import Generator
from math import isfinite
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, Request, Response
from pydantic import BaseModel, ConfigDict

from app.domain.models import EditPlan, TaskStatus
from app.repositories.tasks import TaskRepository
from app.services.cleanup import cleanup_expired_assets
from app.services.task_service import TaskService, TaskServiceError


router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])
maintenance_router = APIRouter(prefix="/api/v1/maintenance", tags=["maintenance"])


class CreateTaskRequest(BaseModel):
    """Metadata used to reserve one original upload."""

    model_config = ConfigDict(extra="ignore")

    invite_token: Any = None
    filename: Any = None
    content_type: Any = None
    byte_size: Any = None


def get_task_service(request: Request) -> Generator[TaskService, None, None]:
    """Yield one service backed by one request-owned SQLAlchemy session."""

    injected = getattr(request.app.state, "task_service", None)
    if injected is not None:
        yield injected
        return

    session = request.app.state.session_factory()
    service = TaskService(
        TaskRepository(session),
        request.app.state.storage,
        request.app.state.provider,
        settings=request.app.state.settings,
    )
    try:
        yield service
    except BaseException:
        try:
            session.rollback()
        finally:
            session.close()
        raise
    else:
        try:
            if session.in_transaction():
                session.rollback()
        finally:
            session.close()


def _task_view(task: Any) -> dict[str, Any]:
    return task.model_dump(
        mode="json",
        by_alias=True,
        exclude={"idempotency_key"},
    )


def _isoformat(value: Any) -> str:
    rendered = value.isoformat()
    return rendered[:-6] + "Z" if rendered.endswith("+00:00") else rendered


def _authorize(service: TaskService, invite_token: str | None) -> None:
    # Authenticate before lookup so invalid invites reveal no task metadata.
    service.authorize_request(invite_token)


def _set_retry_after(response: Response, service: TaskService, task: Any) -> None:
    if task.status in {TaskStatus.ANALYZING, TaskStatus.GENERATING}:
        response.headers["Retry-After"] = str(service.retry_after_seconds)


def _has_enabled_structure_repair(payload: Any) -> bool:
    if not isinstance(payload, dict) or not isinstance(payload.get("operations"), list):
        return False
    return any(
        isinstance(operation, dict)
        and operation.get("goal") == "structure_repair"
        and operation.get("enabled", True) is not False
        for operation in payload["operations"]
    )


def _has_invalid_mask_strokes(payload: Any) -> bool:
    strokes = payload.get("mask_strokes") if isinstance(payload, dict) else None
    if not isinstance(strokes, list) or not strokes:
        return True
    for stroke in strokes:
        if not isinstance(stroke, dict):
            return True
        if stroke.get("mode") not in {"add", "erase"}:
            return True
        width = stroke.get("width")
        points = stroke.get("points")
        if (
            not isinstance(width, (int, float))
            or isinstance(width, bool)
            or not isfinite(width)
            or width <= 0
            or not isinstance(points, list)
            or not points
        ):
            return True
        for point in points:
            if not isinstance(point, dict):
                return True
            x, y = point.get("x"), point.get("y")
            if (
                not isinstance(x, (int, float))
                or isinstance(x, bool)
                or not isfinite(x)
                or not 0 <= x <= 1
                or not isinstance(y, (int, float))
                or isinstance(y, bool)
                or not isfinite(y)
                or not 0 <= y <= 1
            ):
                return True
    return False


@router.post("")
def create_task(
    payload: CreateTaskRequest | None = Body(default=None),
    service: TaskService = Depends(get_task_service),
) -> dict[str, Any]:
    payload = payload or CreateTaskRequest()
    task, upload = service.create_task(
        invite_token=payload.invite_token,
        filename=payload.filename,
        content_type=payload.content_type,
        byte_size=payload.byte_size,
    )
    return {
        "task_id": str(task.id),
        "upload_url": upload.url,
        "expires_at": _isoformat(upload.expires_at),
        "status": task.status.value,
    }


@router.post("/{task_id}/analyze")
def analyze_task(
    task_id: str,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    invite_token: str | None = Header(default=None, alias="X-Invite-Token"),
    service: TaskService = Depends(get_task_service),
) -> dict[str, Any]:
    _authorize(service, invite_token)
    task = service.analyze(task_id, idempotency_key)
    _set_retry_after(response, service, task)
    return _task_view(task)


@router.get("/{task_id}")
def get_task(
    task_id: str,
    invite_token: str | None = Header(default=None, alias="X-Invite-Token"),
    service: TaskService = Depends(get_task_service),
) -> dict[str, Any]:
    _authorize(service, invite_token)
    return _task_view(service.get_task(task_id))


@router.post("/{task_id}/plan")
def save_plan(
    task_id: str,
    payload: Any = Body(default_factory=dict),
    invite_token: str | None = Header(default=None, alias="X-Invite-Token"),
    service: TaskService = Depends(get_task_service),
) -> dict[str, Any]:
    _authorize(service, invite_token)
    try:
        plan = EditPlan.model_validate(payload)
    except Exception as exc:
        message = "处理计划格式无效。"
        if _has_enabled_structure_repair(payload) and _has_invalid_mask_strokes(
            payload
        ):
            message = "结构修复需要至少一笔有效的局部蒙版。"
        raise TaskServiceError("INVALID_PLAN", message) from exc
    return _task_view(service.save_plan(task_id, plan))


@router.post("/{task_id}/generate")
def generate_task(
    task_id: str,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    invite_token: str | None = Header(default=None, alias="X-Invite-Token"),
    service: TaskService = Depends(get_task_service),
) -> dict[str, Any]:
    _authorize(service, invite_token)
    task = service.generate(task_id, idempotency_key)
    _set_retry_after(response, service, task)
    return _task_view(task)


@router.get("/{task_id}/download")
def download_task(
    task_id: str,
    invite_token: str | None = Header(default=None, alias="X-Invite-Token"),
    service: TaskService = Depends(get_task_service),
) -> dict[str, Any]:
    _authorize(service, invite_token)
    asset = service.download(task_id)
    return {
        "url": asset.url,
        "expires_at": _isoformat(asset.expires_at),
    }


@maintenance_router.post("/cleanup")
def cleanup_assets(
    invite_token: str | None = Header(default=None, alias="X-Invite-Token"),
    service: TaskService = Depends(get_task_service),
) -> dict[str, int]:
    _authorize(service, invite_token)
    return {
        "cleaned_tasks": cleanup_expired_assets(
            service.repository,
            service.storage,
            ttl_hours=service.settings.asset_ttl_hours,
        )
    }


__all__ = [
    "CreateTaskRequest",
    "get_task_service",
    "maintenance_router",
    "router",
]
