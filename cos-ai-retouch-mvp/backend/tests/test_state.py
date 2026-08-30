from datetime import datetime, timezone
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.domain.models import (
    AnalysisCard,
    EditPlan,
    Goal,
    Operation,
    Region,
    TaskRecord,
    TaskStatus,
    VersionRecord,
)
from app.domain.state import InvalidTransition, advance, transition_table


def test_task_can_move_from_upload_to_analysis_to_confirmation_to_generation_to_success():
    task = TaskRecord.new()

    task.advance(TaskStatus.UPLOADING)
    task.advance(TaskStatus.ANALYZING)
    task.advance(TaskStatus.AWAITING_CONFIRMATION)
    task.advance(TaskStatus.GENERATING)
    task.advance(TaskStatus.VALIDATING)
    task.advance(TaskStatus.SUCCEEDED)

    assert task.status is TaskStatus.SUCCEEDED


def test_task_cannot_generate_before_plan_confirmation():
    task = TaskRecord.new()
    task.advance(TaskStatus.UPLOADING)
    task.advance(TaskStatus.ANALYZING)

    with pytest.raises(InvalidTransition) as exc_info:
        task.advance(TaskStatus.GENERATING)

    message = str(exc_info.value)
    assert TaskStatus.ANALYZING.value in message
    assert TaskStatus.GENERATING.value in message


@pytest.mark.parametrize(
    ("current", "requested"),
    [
        (TaskStatus.CREATED, TaskStatus.ANALYZING),
        (TaskStatus.AWAITING_CONFIRMATION, TaskStatus.VALIDATING),
        (TaskStatus.SUCCEEDED, TaskStatus.GENERATING),
        (TaskStatus.EXPIRED, TaskStatus.SUCCEEDED),
    ],
)
def test_invalid_transition_mentions_current_and_requested_status(current, requested):
    with pytest.raises(InvalidTransition) as exc_info:
        advance(current, requested)

    message = str(exc_info.value)
    assert current.value in message
    assert requested.value in message


def test_transition_table_contains_only_the_supported_edges():
    assert transition_table == {
        TaskStatus.CREATED: frozenset({TaskStatus.UPLOADING}),
        TaskStatus.UPLOADING: frozenset({TaskStatus.ANALYZING, TaskStatus.FAILED}),
        TaskStatus.ANALYZING: frozenset(
            {TaskStatus.AWAITING_CONFIRMATION, TaskStatus.FAILED}
        ),
        TaskStatus.AWAITING_CONFIRMATION: frozenset(
            {TaskStatus.GENERATING, TaskStatus.FAILED}
        ),
        TaskStatus.GENERATING: frozenset({TaskStatus.VALIDATING, TaskStatus.FAILED}),
        TaskStatus.VALIDATING: frozenset({TaskStatus.SUCCEEDED, TaskStatus.FAILED}),
        TaskStatus.FAILED: frozenset(
            {TaskStatus.ANALYZING, TaskStatus.GENERATING, TaskStatus.EXPIRED}
        ),
        TaskStatus.SUCCEEDED: frozenset({TaskStatus.EXPIRED}),
        TaskStatus.EXPIRED: frozenset(),
    }


def test_status_and_goal_enums_have_the_contract_values_only():
    assert [status.value for status in TaskStatus] == [
        "created",
        "uploading",
        "analyzing",
        "awaiting_confirmation",
        "generating",
        "validating",
        "succeeded",
        "failed",
        "expired",
    ]
    assert [goal.value for goal in Goal] == [
        "natural_retouch",
        "structure_repair",
    ]


def test_task_record_new_has_uuid_created_status_and_utc_timestamps():
    task = TaskRecord.new()

    assert isinstance(task.id, UUID)
    assert task.status is TaskStatus.CREATED
    assert isinstance(task.created_at, datetime)
    assert isinstance(task.updated_at, datetime)
    assert task.created_at.tzinfo == timezone.utc
    assert task.updated_at.tzinfo == timezone.utc
    assert task.updated_at >= task.created_at


def test_edit_plan_preserves_the_default_protected_attributes():
    plan = EditPlan()

    assert plan.preserve == [
        "face identity",
        "composition",
        "main pose",
        "costume design",
        "background structure",
        "original light direction",
        "perspective",
        "depth of field",
        "noise consistency",
    ]


def test_domain_models_validate_normalized_regions_and_store_task_shapes():
    region = Region(
        id="face-1",
        label="face",
        x=0.25,
        y=0.2,
        width=0.3,
        height=0.4,
        source="analysis",
    )
    card = AnalysisCard(
        id="card-1",
        category="face",
        title="Face detail",
        summary="Minor skin detail",
        confidence=0.92,
        risk="Keep identity unchanged",
        regions=[region],
    )
    operation = Operation(
        kind="skin_retouch",
        goal=Goal.NATURAL_RETOUCH,
        region_ids=[region.id],
        intensity=55,
    )
    plan = EditPlan(
        goals=[Goal.NATURAL_RETOUCH],
        regions=[region],
        operations=[operation],
    )
    version = VersionRecord(
        asset_url="https://assets.example.test/tasks/task-1/version-1.jpg",
        validation={"face": "pass"},
    )
    task = TaskRecord.new()
    task.analysis = [card]
    task.plan = plan
    task.versions.append(version)

    assert task.analysis[0].regions[0].x == 0.25
    assert task.plan.operations[0].goal is Goal.NATURAL_RETOUCH
    assert task.versions[0].asset_url.endswith("version-1.jpg")


@pytest.mark.parametrize(
    "coordinate",
    [
        {"x": -0.01, "y": 0.2, "width": 0.3, "height": 0.4},
        {"x": 0.1, "y": 1.01, "width": 0.3, "height": 0.4},
        {"x": 0.1, "y": 0.2, "width": 1.01, "height": 0.4},
        {"x": 0.1, "y": 0.2, "width": 0.3, "height": -0.01},
    ],
)
def test_region_rejects_coordinates_outside_zero_to_one(coordinate):
    with pytest.raises(ValidationError):
        Region(id="bad", label="bad", **coordinate)
