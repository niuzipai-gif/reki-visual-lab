"""Quota-safe workflow planning routes for the browser editor."""

from __future__ import annotations

from fastapi import APIRouter

from app.services.workflow_planner import (
    WorkflowPlan,
    WorkflowPlanRequest,
    WorkflowPlanner,
)


router = APIRouter(prefix="/api/v1/workflows", tags=["workflows"])
_planner = WorkflowPlanner()


@router.post("/plan", response_model=WorkflowPlan)
def create_workflow_plan(payload: WorkflowPlanRequest) -> WorkflowPlan:
    """Return an editable execution graph without invoking image generation."""

    return _planner.plan(payload)


__all__ = ["router"]
