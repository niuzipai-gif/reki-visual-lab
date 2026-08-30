from datetime import datetime, timezone
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.domain.models import (
    AnalysisCard,
    AssetURL,
    EditPlan,
    Goal,
    IdempotencyRecord,
    Operation,
    Region,
    TaskError,
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


def test_task_status_cannot_be_changed_by_direct_assignment():
    task = TaskRecord.new()

    with pytest.raises(ValidationError):
        task.status = TaskStatus.UPLOADING

    task.advance(TaskStatus.UPLOADING)
    assert task.status is TaskStatus.UPLOADING


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

    assert plan.preserve == (
        "face identity",
        "composition",
        "main pose",
        "costume design",
        "background structure",
        "original light direction",
        "perspective",
        "depth of field",
        "noise consistency",
    )
    assert isinstance(plan.preserve, tuple)

    with pytest.raises(ValidationError):
        EditPlan(preserve=[])

    with pytest.raises(AttributeError):
        plan.preserve.remove("face identity")


def test_transition_table_cannot_be_mutated_at_runtime():
    with pytest.raises(TypeError):
        transition_table[TaskStatus.CREATED] = frozenset()


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
        asset_url=AssetURL(
            kind="version",
            url="https://assets.example.test/tasks/task-1/version-1.jpg",
            expires_at=datetime(2026, 8, 30, 12, 30, tzinfo=timezone.utc),
        ),
        validation={"face": "pass"},
    )
    task = TaskRecord.new()
    task.analysis = [card]
    task.plan = plan
    task.versions.append(version)

    assert task.analysis[0].regions[0].x == 0.25
    assert task.plan.operations[0].goal is Goal.NATURAL_RETOUCH
    assert task.versions[0].asset_url.url.endswith("version-1.jpg")


def test_region_mask_asset_url_is_typed_and_serializes_as_a_mask_asset():
    mask = AssetURL(
        kind="mask",
        url="https://assets.example.test/tasks/task-1/mask.png",
        expires_at=datetime(2026, 8, 30, 12, 30, tzinfo=timezone.utc),
    )
    region = Region(
        id="face-1",
        label="face",
        x=0.25,
        y=0.2,
        width=0.3,
        height=0.4,
        mask_asset_url=mask,
    )

    payload = region.model_dump(mode="json")
    assert payload["mask_asset_url"]["kind"] == "mask"
    assert payload["mask_asset_url"]["url"].endswith("mask.png")

    with pytest.raises(ValidationError):
        Region(
            id="bad-mask",
            label="face",
            x=0.25,
            y=0.2,
            width=0.3,
            height=0.4,
            mask_asset_url={
                "kind": "mask",
                "url": "https://assets.example.test/tasks/task-1/mask.png",
            },
        )


def test_enabled_structure_repair_operations_require_existing_regions():
    region = Region(
        id="hands-1",
        label="hands",
        x=0.1,
        y=0.2,
        width=0.2,
        height=0.2,
    )

    with pytest.raises(ValidationError):
        EditPlan(
            regions=[region],
            operations=[
                Operation(
                    kind="structure_repair",
                    goal=Goal.STRUCTURE_REPAIR,
                    region_ids=[],
                )
            ],
        )
    with pytest.raises(ValidationError):
        EditPlan(
            regions=[region],
            operations=[
                Operation(
                    kind="structure_repair",
                    goal=Goal.STRUCTURE_REPAIR,
                    region_ids=["missing-region"],
                )
            ],
        )

    plan = EditPlan(
        regions=[region],
        operations=[
            Operation(
                kind="structure_repair",
                goal=Goal.STRUCTURE_REPAIR,
                region_ids=[region.id],
            )
        ],
    )
    assert plan.operations[0].region_ids == [region.id]


def test_version_validation_values_are_limited_to_pass_or_review():
    asset = AssetURL(
        kind="version",
        url="https://assets.example.test/tasks/task-1/version-1.jpg",
        expires_at=datetime(2026, 8, 30, 12, 30, tzinfo=timezone.utc),
    )
    version = VersionRecord(
        asset_url=asset,
        validation={"face_identity": "pass", "hands_and_costume": "review"},
    )

    assert version.validation == {
        "face_identity": "pass",
        "hands_and_costume": "review",
    }

    with pytest.raises(ValidationError):
        VersionRecord(asset_url=asset, validation={"face_identity": "fail"})


def test_typed_assets_errors_and_task_id_serialization_match_contract():
    expires_at = datetime(2026, 8, 30, 12, 30, tzinfo=timezone.utc)
    original = AssetURL(
        kind="original",
        url="https://assets.example.test/tasks/task-1/original.jpg",
        expires_at=expires_at,
    )
    mask = AssetURL(
        kind="mask",
        url="https://assets.example.test/tasks/task-1/mask.png",
        expires_at=expires_at,
    )
    error = TaskError(
        code="ANALYSIS_FAILED",
        message="Analysis is temporarily unavailable.",
        retryable=True,
    )
    task = TaskRecord(
        original_asset_url=original,
        mask_asset_url=mask,
        error=error,
    )

    assert task.original_asset_url.kind == "original"
    assert task.mask_asset_url.kind == "mask"
    assert task.error is error
    assert task.model_dump(by_alias=True)["task_id"] == task.id

    with pytest.raises(ValidationError):
        AssetURL(kind="other", url="https://assets.example.test/object", expires_at=expires_at)
    with pytest.raises(ValidationError):
        TaskRecord(error={"traceback": "Traceback (most recent call last)"})


def test_idempotency_record_is_scoped_to_supported_operations_and_key_length():
    record = IdempotencyRecord(
        task_id=UUID("00000000-0000-0000-0000-000000000001"),
        operation="analyze",
        key="retry-1",
        request_hash="sha256:abc",
        result_status=TaskStatus.ANALYZING,
        created_at=datetime(2026, 8, 30, 12, 30, tzinfo=timezone.utc),
    )

    assert record.operation == "analyze"
    assert record.key == "retry-1"

    base = {
        "task_id": record.task_id,
        "operation": "generate",
        "request_hash": record.request_hash,
        "result_status": TaskStatus.GENERATING,
        "created_at": record.created_at,
    }
    with pytest.raises(ValidationError):
        IdempotencyRecord(**base, key="")
    with pytest.raises(ValidationError):
        IdempotencyRecord(**base, key="x" * 129)
    with pytest.raises(ValidationError):
        IdempotencyRecord(**{**base, "operation": "upload"})


@pytest.mark.parametrize(
    "factory",
    [
        lambda: AssetURL(
            kind="original",
            url="https://assets.example.test/object",
            expires_at=datetime(2026, 8, 30, 12, 30),
        ),
        lambda: VersionRecord(
            asset_url=AssetURL(
                kind="version",
                url="https://assets.example.test/object",
                expires_at=datetime(2026, 8, 30, 12, 30, tzinfo=timezone.utc),
            ),
            created_at=datetime(2026, 8, 30, 12, 30),
        ),
        lambda: TaskRecord(
            created_at=datetime(2026, 8, 30, 12, 30),
            updated_at=datetime(2026, 8, 30, 12, 30, tzinfo=timezone.utc),
        ),
        lambda: IdempotencyRecord(
            task_id=UUID("00000000-0000-0000-0000-000000000001"),
            operation="analyze",
            key="retry-1",
            request_hash="sha256:abc",
            result_status=TaskStatus.ANALYZING,
            created_at=datetime(2026, 8, 30, 12, 30),
        ),
    ],
)
def test_timestamp_fields_reject_naive_datetimes(factory):
    with pytest.raises(ValidationError):
        factory()


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
