from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.config import Settings
from app.db import Base
from app.domain.models import (
    AnalysisCard,
    AssetURL,
    EditPlan,
    Goal,
    Operation,
    Region,
    TaskError,
    TaskRecord,
    TaskStatus,
    VersionRecord,
)


def _asset(kind: str, name: str) -> AssetURL:
    return AssetURL(
        kind=kind,
        url=f"https://assets.example.test/tasks/task-1/{name}",
        expires_at=datetime(2026, 8, 31, 12, 30, tzinfo=timezone.utc),
    )


def _aggregate() -> tuple[TaskRecord, AnalysisCard, EditPlan, VersionRecord]:
    region = Region(
        id="hands-1",
        label="hands",
        x=0.1,
        y=0.2,
        width=0.2,
        height=0.2,
        mask_asset_url=_asset("mask", "mask.png"),
    )
    card = AnalysisCard(
        id="card-hands-1",
        category="hands",
        title="Repair hand connection",
        summary="A bounded structure repair suggestion.",
        confidence=0.88,
        risk="Review fingers before generation.",
        enabled=True,
        regions=(region,),
    )
    plan = EditPlan(
        goals=(Goal.NATURAL_RETOUCH, Goal.STRUCTURE_REPAIR),
        regions=(region,),
        operations=(
            Operation(
                kind="structure_repair",
                goal=Goal.STRUCTURE_REPAIR,
                region_ids=(region.id,),
                intensity=62,
                instructions="Keep the original costume silhouette.",
            ),
        ),
        intensity=62,
        notes="Preserve identity and lighting.",
    )
    version = VersionRecord(
        id=UUID("00000000-0000-0000-0000-000000000123"),
        asset_url=_asset("version", "version-1.jpg"),
        created_at=datetime(2026, 8, 30, 13, 30, tzinfo=timezone.utc),
        validation={"face_identity": "pass", "hands_and_costume": "review"},
        selected=True,
    )
    task = TaskRecord(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        status=TaskStatus.AWAITING_CONFIRMATION,
        created_at=datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 8, 30, 12, 15, tzinfo=timezone.utc),
        idempotency_key="create-task-1",
        original_asset_url=_asset("original", "original.jpg"),
        mask_asset_url=_asset("mask", "mask.png"),
        analysis=(card,),
        plan=plan,
        versions=(version,),
        error=TaskError(
            code="ANALYSIS_FAILED",
            message="A safe retryable error.",
            retryable=True,
        ),
    )
    return task, card, plan, version


def test_repository_round_trips_the_full_typed_task_aggregate(repository):
    task, card, plan, version = _aggregate()

    created = repository.create_task(task)
    repository.save_analysis(task.id, [card])
    repository.save_plan(task.id, plan)
    repository.add_version(task.id, version)

    loaded = repository.get_task(task.id)

    assert created.id == task.id
    assert loaded == task
    assert loaded is not task
    assert isinstance(loaded.original_asset_url, AssetURL)
    assert loaded.analysis == (card,)
    assert loaded.analysis[0].regions == (card.regions[0],)
    assert loaded.plan == plan
    assert loaded.plan.operations[0].goal is Goal.STRUCTURE_REPAIR
    assert loaded.versions == (version,)
    assert loaded.versions[0].validation == version.validation
    assert isinstance(loaded.error, TaskError)


def test_repository_returns_none_for_a_missing_task(repository):
    assert repository.get_task(uuid4()) is None


def test_mark_expired_before_only_changes_older_non_expired_tasks(repository):
    now = datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc)
    cutoff = now - timedelta(days=1)
    old_created = TaskRecord(
        id=UUID("00000000-0000-0000-0000-000000000010"),
        status=TaskStatus.CREATED,
        created_at=cutoff - timedelta(seconds=1),
        updated_at=cutoff - timedelta(seconds=1),
    )
    old_succeeded = TaskRecord(
        id=UUID("00000000-0000-0000-0000-000000000011"),
        status=TaskStatus.SUCCEEDED,
        created_at=cutoff - timedelta(days=1),
        updated_at=cutoff - timedelta(days=1),
    )
    already_expired = TaskRecord(
        id=UUID("00000000-0000-0000-0000-000000000012"),
        status=TaskStatus.EXPIRED,
        created_at=cutoff - timedelta(days=2),
        updated_at=cutoff - timedelta(days=2),
    )
    newer = TaskRecord(
        id=UUID("00000000-0000-0000-0000-000000000013"),
        status=TaskStatus.CREATED,
        created_at=cutoff,
        updated_at=cutoff,
    )
    for item in (old_created, old_succeeded, already_expired, newer):
        repository.create_task(item)

    changed = repository.mark_expired_before(cutoff)

    assert changed == 2
    assert repository.get_task(old_created.id).status is TaskStatus.EXPIRED
    assert repository.get_task(old_succeeded.id).status is TaskStatus.EXPIRED
    assert repository.get_task(already_expired.id).status is TaskStatus.EXPIRED
    assert repository.get_task(newer.id).status is TaskStatus.CREATED
    assert repository.get_task(newer.id).created_at == newer.created_at


def test_settings_have_task2_defaults_and_redact_secret_values(monkeypatch):
    monkeypatch.setenv("IMAGE_PROVIDER_API_KEY", "provider-secret")
    monkeypatch.setenv("STORAGE_ACCESS_KEY", "storage-access-secret")
    monkeypatch.setenv("STORAGE_SECRET_KEY", "storage-secret")

    settings = Settings()

    assert settings.database_url == "sqlite+aiosqlite:///./cos-retouch-test.db"
    assert settings.allowed_origins == ["http://localhost:5173"]
    assert settings.invite_tokens == []
    assert settings.asset_ttl_hours == 24
    assert settings.max_upload_bytes == 20 * 1024 * 1024
    assert settings.image_provider_mode == "mock"
    assert settings.image_provider_model == "cos-retouch-default"
    assert settings.image_provider_api_key == "provider-secret"
    assert settings.storage_access_key == "storage-access-secret"
    assert settings.storage_secret_key == "storage-secret"
    rendered = repr(settings)
    assert "provider-secret" not in rendered
    assert "storage-access-secret" not in rendered
    assert "storage-secret" not in rendered


def test_database_metadata_and_alembic_upgrade_define_the_five_named_tables(tmp_path):
    expected = {"tasks", "assets", "analysis_cards", "edit_plans", "versions"}
    assert set(Base.metadata.tables) == expected

    database_url = f"sqlite:///{tmp_path / 'migration.db'}"
    alembic_ini = Path(__file__).parents[1] / "alembic.ini"
    alembic_config = Config(str(alembic_ini))
    alembic_config.set_main_option("sqlalchemy.url", database_url)

    command.upgrade(alembic_config, "head")
    command.upgrade(alembic_config, "head")

    engine = create_engine(database_url)
    try:
        inspector = inspect(engine)
        assert set(inspector.get_table_names()) == expected | {"alembic_version"}
        for child in ("assets", "analysis_cards", "edit_plans", "versions"):
            foreign_keys = inspector.get_foreign_keys(child)
            assert any(fk["referred_table"] == "tasks" for fk in foreign_keys)
    finally:
        engine.dispose()
