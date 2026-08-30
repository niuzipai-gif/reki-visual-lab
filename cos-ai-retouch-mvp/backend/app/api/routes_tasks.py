"""REST routes for the invite-only COS retouch task workflow."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Header, Request
from pydantic import BaseModel, ConfigDict

from app.domain.models import EditPlan
from app.services.task_service import TaskService, TaskServiceError


router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])


class CreateTaskRequest(BaseModel):
    """Metadata used to reserve one original upload."""

    model_config = ConfigDict(extra="ignore")

    invite_token: Any = None
    filename: Any = None
    content_type: Any = None
    byte_size: Any = None


def _service(request: Request) -> TaskService:
    return request.app.state.task_service


def _task_view(task: Any) -> dict[str, Any]:
    return task.model_dump(
        mode="json",
        by_alias=True,
        exclude={"idempotency_key"},
    )


def _isoformat(value: Any) -> str:
    rendered = value.isoformat()
    return rendered[:-6] + "Z" if rendered.endswith("+00:00") else rendered


@router.post("")
def create_task(
    request: Request,
    payload: CreateTaskRequest | None = Body(default=None),
) -> dict[str, Any]:
    payload = payload or CreateTaskRequest()
    task, upload = _service(request).create_task(
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
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    task = _service(request).analyze(task_id, idempotency_key)
    return _task_view(task)


@router.get("/{task_id}")
def get_task(task_id: str, request: Request) -> dict[str, Any]:
    return _task_view(_service(request).get_task(task_id))


@router.post("/{task_id}/plan")
def save_plan(
    task_id: str,
    request: Request,
    payload: Any = Body(default_factory=dict),
) -> dict[str, Any]:
    try:
        plan = EditPlan.model_validate(payload)
    except Exception as exc:
        raise TaskServiceError("INVALID_PLAN", "处理计划格式无效。") from exc
    return _task_view(_service(request).save_plan(task_id, plan))


@router.post("/{task_id}/generate")
def generate_task(
    task_id: str,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    return _task_view(_service(request).generate(task_id, idempotency_key))


@router.get("/{task_id}/download")
def download_task(task_id: str, request: Request) -> dict[str, Any]:
    asset = _service(request).download(task_id)
    return {
        "url": asset.url,
        "expires_at": _isoformat(asset.expires_at),
    }


__all__ = ["CreateTaskRequest", "router"]
