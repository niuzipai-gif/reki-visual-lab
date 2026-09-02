from app.services.workflow_planner import WorkflowPlanner, WorkflowPlanRequest
from fastapi.testclient import TestClient

from app.config import Settings


def test_planner_builds_bounded_cos_chain_without_image_generation():
    result = WorkflowPlanner().plan(
        WorkflowPlanRequest(
            filename="miku.jpg",
            preset="clear-japanese",
            modules=["skin", "hair", "background"],
            has_mask=True,
        )
    )

    assert result.provider == "rules"
    assert result.image_generation_calls == 0
    assert [operation.module for operation in result.operations] == [
        "light",
        "style",
        "hair",
        "skin",
        "background",
    ]
    assert result.operations[-1].requires_remote_ai is True
    assert "face identity" in result.preserve
    assert result.validation


def test_planner_deduplicates_modules_and_keeps_unknown_input_safe():
    result = WorkflowPlanner().plan(
        WorkflowPlanRequest(
            filename="cos.png",
            modules=["hair", "hair", "not-a-module", "style"],
        )
    )

    assert [operation.module for operation in result.operations] == ["hair", "style"]
    assert result.notes


def test_workflow_endpoint_returns_planner_graph_without_invite_gate(repository):
    from app.main import create_app

    app = create_app(settings=Settings(), repository=repository)
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/workflows/plan",
            json={"filename": "miku.jpg", "modules": ["skin", "hair"]},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "rules"
    assert payload["image_generation_calls"] == 0
    assert [operation["module"] for operation in payload["operations"]] == [
        "skin",
        "hair",
    ]
