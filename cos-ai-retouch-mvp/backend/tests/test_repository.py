from datetime import datetime, timedelta, timezone
import inspect as python_inspect
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.db import (
    AssetRow,
    Base,
    EditPlanRow,
    IdempotencyRow,
    TaskRow,
    VersionRow,
    _sync_database_url,
)
from app.repositories.tasks import TaskRepository, VersionConflictError
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
        mask_strokes=(
            {
                "mode": "add",
                "width": 14,
                "points": [{"x": 0.2, "y": 0.3}, {"x": 0.4, "y": 0.5}],
            },
            {
                "mode": "erase",
                "width": 7,
                "points": [{"x": 0.25, "y": 0.35}],
            },
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


def test_repository_round_trips_the_full_typed_task_aggregate(repository, db_session):
    task, card, plan, version = _aggregate()

    created = repository.create_task(task)
    initial_asset_count = repository.session.scalar(
        select(func.count(AssetRow.id)).where(AssetRow.task_id == task.id)
    )
    repository.save_analysis(task.id, [card])
    repository.save_plan(task.id, plan)
    repository.add_version(task.id, version)

    stored_plan = db_session.scalar(
        select(EditPlanRow).where(EditPlanRow.task_id == task.id)
    )

    loaded = repository.get_task(task.id)

    assert created.id == task.id
    assert initial_asset_count == 3
    assert loaded is not task
    assert loaded.id == task.id
    assert loaded.status is task.status
    assert loaded.created_at == task.created_at
    assert loaded.updated_at > task.updated_at
    assert isinstance(loaded.original_asset_url, AssetURL)
    assert loaded.analysis == (card,)
    assert loaded.analysis[0].regions == (card.regions[0],)
    assert loaded.plan == plan
    assert loaded.plan.operations[0].goal is Goal.STRUCTURE_REPAIR
    assert loaded.plan.mask_strokes == plan.mask_strokes
    assert stored_plan is not None
    assert (
        stored_plan.payload["mask_strokes"]
        == plan.model_dump(mode="json")["mask_strokes"]
    )
    assert loaded.versions == (version,)
    assert loaded.versions[0].validation == version.validation
    assert isinstance(loaded.error, TaskError)


def test_repository_returns_none_for_a_missing_task(repository):
    assert repository.get_task(uuid4()) is None


def test_repository_reads_legacy_plan_without_mask_strokes_as_empty(
    repository, db_session
):
    task = TaskRecord(
        id=uuid4(),
        status=TaskStatus.AWAITING_CONFIRMATION,
    )
    repository.create_task(task)
    db_session.add(
        EditPlanRow(
            task_id=task.id,
            payload={
                "goals": ["natural_retouch"],
                "preserve": list(EditPlan().preserve),
                "regions": [],
                "operations": [],
                "intensity": 55,
                "integration": [],
                "validation": [],
                "notes": None,
            },
        )
    )
    db_session.commit()

    loaded = repository.get_task(task.id)

    assert loaded is not None
    assert loaded.plan is not None
    assert loaded.plan.mask_strokes == ()


def test_backend_declares_a_sync_postgresql_driver():
    pyproject = Path(__file__).parents[1] / "pyproject.toml"

    assert '"psycopg[binary]' in pyproject.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    ("database_url", "expected"),
    [
        (
            "postgresql://retouch:secret@example.test/retouch",
            "postgresql+psycopg://retouch:secret@example.test/retouch",
        ),
        (
            "postgres://retouch:secret@example.test/retouch",
            "postgresql+psycopg://retouch:secret@example.test/retouch",
        ),
        (
            "postgresql+psycopg://retouch:secret@example.test/retouch",
            "postgresql+psycopg://retouch:secret@example.test/retouch",
        ),
        (
            "sqlite+aiosqlite:///./cos-retouch-test.db",
            "sqlite:///./cos-retouch-test.db",
        ),
    ],
)
def test_database_url_normalization_selects_psycopg_only_for_unqualified_postgres(
    database_url, expected
):
    assert _sync_database_url(database_url) == expected


def test_add_version_is_idempotent_without_duplicate_assets(repository, db_session):
    task = TaskRecord.new()
    version = VersionRecord(asset_url=_asset("version", "version-1.jpg"))
    repository.create_task(task)

    repository.add_version(task.id, version)
    repository.add_version(task.id, version)

    loaded = repository.get_task(task.id)
    asset_count = db_session.scalar(
        select(func.count(AssetRow.id)).where(AssetRow.task_id == task.id)
    )

    assert loaded.versions == (version,)
    assert asset_count == 1


def test_add_version_repairs_a_historical_version_with_a_missing_asset(
    repository, db_session
):
    task = TaskRecord.new()
    version = VersionRecord(asset_url=_asset("version", "version-1.jpg"))
    repository.create_task(task)
    db_session.add(
        VersionRow(
            id=version.id,
            task_id=task.id,
            position=0,
            payload=version.model_dump(mode="json"),
        )
    )
    db_session.commit()

    repository.add_version(task.id, version)
    repository.add_version(task.id, version)

    asset_count = db_session.scalar(
        select(func.count(AssetRow.id)).where(AssetRow.task_id == task.id)
    )
    assert asset_count == 1


def test_add_version_rejects_same_uuid_with_a_changed_asset_and_preserves_state(
    repository, db_session
):
    task = TaskRecord.new()
    original = VersionRecord(asset_url=_asset("version", "version-1.jpg"))
    conflicting = VersionRecord(
        id=original.id,
        asset_url=_asset("version", "version-2.jpg"),
    )
    repository.create_task(task)
    repository.add_version(task.id, original)
    before = repository.get_task(task.id)

    with pytest.raises(VersionConflictError, match="asset payload conflict"):
        repository.add_version(task.id, conflicting)

    after = repository.get_task(task.id)
    asset_count = db_session.scalar(
        select(func.count(AssetRow.id)).where(AssetRow.task_id == task.id)
    )
    assert after.versions == (original,)
    assert after.updated_at == before.updated_at
    assert asset_count == 1


def test_add_version_reraises_integrity_error_and_allows_a_clean_retry(
    repository, db_session, monkeypatch
):
    task = TaskRecord.new()
    version = VersionRecord(asset_url=_asset("version", "version-1.jpg"))
    repository.create_task(task)
    real_commit = db_session.commit

    def fail_commit():
        raise IntegrityError("insert version", {}, RuntimeError("database failure"))

    monkeypatch.setattr(db_session, "commit", fail_commit)
    with pytest.raises(IntegrityError, match="database failure"):
        repository.add_version(task.id, version)

    assert repository.get_task(task.id).versions == ()
    assert (
        db_session.scalar(
            select(func.count(AssetRow.id)).where(AssetRow.task_id == task.id)
        )
        == 0
    )

    monkeypatch.setattr(db_session, "commit", real_commit)
    repository.add_version(task.id, version)

    assert repository.get_task(task.id).versions == (version,)


def test_integrity_retry_helper_does_not_use_implicit_bare_raise():
    source = python_inspect.getsource(TaskRepository._retry_existing_version)

    assert "raise\n" not in source


def test_child_writes_refresh_task_updated_at_as_utc(repository):
    old = datetime(2000, 1, 1, tzinfo=timezone.utc)
    task = TaskRecord(
        id=uuid4(),
        created_at=old,
        updated_at=old,
    )
    card = AnalysisCard(
        id="card-1",
        category="face",
        title="Face detail",
    )
    plan = EditPlan()
    version = VersionRecord(asset_url=_asset("version", "version-1.jpg"))
    repository.create_task(task)

    before_analysis = repository.get_task(task.id).updated_at
    repository.save_analysis(task.id, [card])
    after_analysis = repository.get_task(task.id).updated_at

    repository.save_plan(task.id, plan)
    after_plan = repository.get_task(task.id).updated_at

    repository.add_version(task.id, version)
    after_version = repository.get_task(task.id).updated_at

    for timestamp in (after_analysis, after_plan, after_version):
        assert timestamp > before_analysis
        assert timestamp.tzinfo == timezone.utc
        assert timestamp.utcoffset() == timedelta(0)
    assert after_plan >= after_analysis
    assert after_version >= after_plan


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


def test_settings_have_task2_defaults_and_secret_values_are_accessible(monkeypatch):
    for name in (
        "DATABASE_URL",
        "INVITE_TOKENS",
        "IMAGE_PROVIDER_API_KEY",
        "STORAGE_ACCESS_KEY",
        "STORAGE_SECRET_KEY",
    ):
        monkeypatch.delenv(name, raising=False)

    settings = Settings()

    assert settings.database_url.get_secret_value() == (
        "sqlite+aiosqlite:///./cos-retouch-test.db"
    )
    assert settings.allowed_origins == ["http://localhost:5173"]
    assert settings.invite_tokens == []
    assert settings.asset_ttl_hours == 24
    assert settings.max_upload_bytes == 20 * 1024 * 1024
    assert settings.image_provider_mode == "mock"
    assert settings.image_provider_model == "cos-retouch-default"


def test_settings_redact_all_secret_values_from_public_serializations(monkeypatch):
    database_url = "postgresql://retouch:db-password@example.test/retouch"
    secrets = {
        "DATABASE_URL": database_url,
        "INVITE_TOKENS": '["invite-secret-1", "invite-secret-2"]',
        "IMAGE_PROVIDER_API_KEY": "provider-secret",
        "STORAGE_ACCESS_KEY": "storage-access-secret",
        "STORAGE_SECRET_KEY": "storage-secret",
    }
    for name, value in secrets.items():
        monkeypatch.setenv(name, value)

    settings = Settings()

    assert settings.database_url.get_secret_value() == database_url
    assert settings.get_invite_tokens() == ("invite-secret-1", "invite-secret-2")
    assert settings.image_provider_api_key.get_secret_value() == "provider-secret"
    assert settings.storage_access_key.get_secret_value() == "storage-access-secret"
    assert settings.storage_secret_key.get_secret_value() == "storage-secret"

    dumped = settings.model_dump()
    assert str(dumped["database_url"]) == "**********"
    assert tuple(str(token) for token in dumped["invite_tokens"]) == (
        "**********",
        "**********",
    )
    assert str(dumped["image_provider_api_key"]) == "**********"
    assert str(dumped["storage_access_key"]) == "**********"
    assert str(dumped["storage_secret_key"]) == "**********"

    serialized_values = (
        repr(settings),
        repr(dumped),
        settings.model_dump_json(),
    )
    for secret in (
        "db-password",
        "invite-secret-1",
        "invite-secret-2",
        "provider-secret",
        "storage-access-secret",
        "storage-secret",
    ):
        for serialized in serialized_values:
            assert secret not in serialized


def test_settings_have_task2_defaults_and_redact_secret_values(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("INVITE_TOKENS", raising=False)
    monkeypatch.setenv("IMAGE_PROVIDER_API_KEY", "provider-secret")
    monkeypatch.setenv("STORAGE_ACCESS_KEY", "storage-access-secret")
    monkeypatch.setenv("STORAGE_SECRET_KEY", "storage-secret")

    settings = Settings()

    assert settings.database_url.get_secret_value() == (
        "sqlite+aiosqlite:///./cos-retouch-test.db"
    )
    assert settings.allowed_origins == ["http://localhost:5173"]
    assert settings.invite_tokens == []
    assert settings.asset_ttl_hours == 24
    assert settings.max_upload_bytes == 20 * 1024 * 1024
    assert settings.image_provider_mode == "mock"
    assert settings.image_provider_model == "cos-retouch-default"
    assert settings.image_provider_api_key.get_secret_value() == "provider-secret"
    assert settings.storage_access_key.get_secret_value() == "storage-access-secret"
    assert settings.storage_secret_key.get_secret_value() == "storage-secret"
    rendered = repr(settings)
    assert "provider-secret" not in rendered
    assert "storage-access-secret" not in rendered
    assert "storage-secret" not in rendered


def test_database_metadata_and_alembic_upgrade_define_the_named_tables(tmp_path):
    expected = {
        "tasks",
        "assets",
        "analysis_cards",
        "edit_plans",
        "versions",
        "idempotency_records",
    }
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
        for child in (
            "assets",
            "analysis_cards",
            "edit_plans",
            "versions",
            "idempotency_records",
        ):
            foreign_keys = inspector.get_foreign_keys(child)
            assert any(fk["referred_table"] == "tasks" for fk in foreign_keys)
    finally:
        engine.dispose()


def test_two_stage_migration_supports_old_data_repeat_upgrade_and_downgrade(
    tmp_path,
):
    database_url = f"sqlite:///{tmp_path / 'migration-chain.db'}"
    alembic_ini = Path(__file__).parents[1] / "alembic.ini"
    alembic_config = Config(str(alembic_ini))
    alembic_config.set_main_option("sqlalchemy.url", database_url)

    command.upgrade(alembic_config, "0001_initial")
    engine = create_engine(database_url)
    old_task_id = uuid4()
    old_version = VersionRecord(asset_url=_asset("version", "old-version.jpg"))
    try:
        inspector = inspect(engine)
        assert "idempotency_records" not in inspector.get_table_names()
        assert not any(
            item["name"] == "uq_versions_task_position"
            for item in inspector.get_unique_constraints("versions")
        )
        with engine.begin() as connection:
            connection.execute(
                TaskRow.__table__.insert().values(
                    id=old_task_id,
                    status=TaskStatus.UPLOADING.value,
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                    idempotency_key=None,
                    original_asset_url=None,
                    mask_asset_url=None,
                    error=None,
                )
            )
            connection.execute(
                VersionRow.__table__.insert().values(
                    id=old_version.id,
                    task_id=old_task_id,
                    position=0,
                    payload=old_version.model_dump(mode="json"),
                )
            )
    finally:
        engine.dispose()

    command.upgrade(alembic_config, "head")
    command.upgrade(alembic_config, "head")
    engine = create_engine(database_url)
    try:
        inspector = inspect(engine)
        assert "idempotency_records" in inspector.get_table_names()
        assert {
            "task_id",
            "operation",
            "key",
            "request_hash",
            "result_status",
            "created_at",
            "provider_job_id",
        }.issubset(
            {column["name"] for column in inspector.get_columns("idempotency_records")}
        )
        assert any(
            item["name"] == "uq_versions_task_position"
            for item in inspector.get_unique_constraints("versions")
        )
        idempotency_constraints = inspector.get_unique_constraints(
            "idempotency_records"
        )
        assert any(
            item["name"] == "uq_idempotency_task_operation_key"
            and item["column_names"] == ["task_id", "operation", "key"]
            for item in idempotency_constraints
        )
        with engine.connect() as connection:
            assert (
                connection.execute(
                    select(func.count())
                    .select_from(VersionRow.__table__)
                    .where(VersionRow.__table__.c.task_id == old_task_id)
                ).scalar_one()
                == 1
            )
    finally:
        engine.dispose()

    command.downgrade(alembic_config, "0001_initial")
    engine = create_engine(database_url)
    try:
        assert not any(
            item["name"] == "ck_versions_position_zero_or_one"
            for item in inspect(engine).get_check_constraints("versions")
        )
    finally:
        engine.dispose()
    command.upgrade(alembic_config, "head")
    engine = create_engine(database_url)
    try:
        inspector = inspect(engine)
        assert "idempotency_records" in inspector.get_table_names()
        assert any(
            item["name"] == "uq_versions_task_position"
            for item in inspector.get_unique_constraints("versions")
        )
    finally:
        engine.dispose()


def test_migration_rejects_duplicate_old_version_positions_before_schema_changes(
    tmp_path,
):
    database_url = f"sqlite:///{tmp_path / 'migration-duplicate.db'}"
    alembic_ini = Path(__file__).parents[1] / "alembic.ini"
    alembic_config = Config(str(alembic_ini))
    alembic_config.set_main_option("sqlalchemy.url", database_url)

    command.upgrade(alembic_config, "0001_initial")
    task_id = uuid4()
    first = VersionRecord(asset_url=_asset("version", "duplicate-1.jpg"))
    second = VersionRecord(asset_url=_asset("version", "duplicate-2.jpg"))
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            now = datetime.now(timezone.utc)
            connection.execute(
                TaskRow.__table__.insert().values(
                    id=task_id,
                    status=TaskStatus.UPLOADING.value,
                    created_at=now,
                    updated_at=now,
                    idempotency_key=None,
                    original_asset_url=None,
                    mask_asset_url=None,
                    error=None,
                )
            )
            connection.execute(
                VersionRow.__table__.insert(),
                [
                    {
                        "id": first.id,
                        "task_id": task_id,
                        "position": 0,
                        "payload": first.model_dump(mode="json"),
                    },
                    {
                        "id": second.id,
                        "task_id": task_id,
                        "position": 0,
                        "payload": second.model_dump(mode="json"),
                    },
                ],
            )
    finally:
        engine.dispose()

    with pytest.raises(RuntimeError, match="duplicate.*position"):
        command.upgrade(alembic_config, "head")

    engine = create_engine(database_url)
    try:
        inspector = inspect(engine)
        assert "idempotency_records" not in inspector.get_table_names()
        assert inspect(engine).get_table_names()
    finally:
        engine.dispose()


def test_migration_rejects_legacy_version_position_outside_candidate_slots(
    tmp_path,
):
    database_url = f"sqlite:///{tmp_path / 'migration-invalid-position.db'}"
    alembic_ini = Path(__file__).parents[1] / "alembic.ini"
    alembic_config = Config(str(alembic_ini))
    alembic_config.set_main_option("sqlalchemy.url", database_url)

    command.upgrade(alembic_config, "0001_initial")
    task_id = uuid4()
    invalid_version = VersionRecord(asset_url=_asset("version", "invalid-position.jpg"))
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            now = datetime.now(timezone.utc)
            connection.execute(
                TaskRow.__table__.insert().values(
                    id=task_id,
                    status=TaskStatus.UPLOADING.value,
                    created_at=now,
                    updated_at=now,
                    idempotency_key=None,
                    original_asset_url=None,
                    mask_asset_url=None,
                    error=None,
                )
            )
            connection.execute(
                VersionRow.__table__.insert().values(
                    id=invalid_version.id,
                    task_id=task_id,
                    position=2,
                    payload=invalid_version.model_dump(mode="json"),
                )
            )
    finally:
        engine.dispose()

    with pytest.raises(RuntimeError, match="position.*0.*1"):
        command.upgrade(alembic_config, "head")


def _create_legacy_idempotency_table(connection) -> None:
    connection.exec_driver_sql(
        """
        CREATE TABLE idempotency_records (
            id INTEGER PRIMARY KEY,
            task_id CHAR(32) NOT NULL,
            operation VARCHAR(16) NOT NULL,
            key VARCHAR(128) NOT NULL,
            request_hash VARCHAR(128) NOT NULL,
            result_status VARCHAR(32) NOT NULL,
            provider_job_id VARCHAR(255),
            provider_status VARCHAR(32),
            candidate_position INTEGER,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
        )
        """
    )


def test_migration_repairs_existing_idempotency_constraints_and_indexes(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'migration-existing-idempotency.db'}"
    alembic_ini = Path(__file__).parents[1] / "alembic.ini"
    alembic_config = Config(str(alembic_ini))
    alembic_config.set_main_option("sqlalchemy.url", database_url)

    command.upgrade(alembic_config, "0001_initial")
    task_id = uuid4()
    now = datetime.now(timezone.utc)
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(
                TaskRow.__table__.insert().values(
                    id=task_id,
                    status=TaskStatus.UPLOADING.value,
                    created_at=now,
                    updated_at=now,
                    idempotency_key=None,
                    original_asset_url=None,
                    mask_asset_url=None,
                    error=None,
                )
            )
            _create_legacy_idempotency_table(connection)
            connection.exec_driver_sql(
                """
                INSERT INTO idempotency_records
                    (id, task_id, operation, key, request_hash,
                     result_status, provider_job_id, provider_status,
                     candidate_position, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    1,
                    task_id.hex,
                    "generate",
                    "legacy-key",
                    "legacy-hash",
                    TaskStatus.GENERATING.value,
                    None,
                    "reserved",
                    0,
                    now,
                    now,
                ),
            )
    finally:
        engine.dispose()

    command.upgrade(alembic_config, "head")
    engine = create_engine(database_url)
    try:
        inspector = inspect(engine)
        columns = {
            column["name"] for column in inspector.get_columns("idempotency_records")
        }
        assert {
            "provider_idempotency_key",
            "reservation_generation",
            "version_id",
            "result_asset_url",
        }.issubset(columns)
        constraints = inspector.get_unique_constraints("idempotency_records")
        assert any(
            item["column_names"] == ["task_id", "operation", "key"]
            for item in constraints
        )
        assert any(
            item["column_names"] == ["task_id", "operation", "candidate_position"]
            for item in constraints
        )
        indexes = inspector.get_indexes("idempotency_records")
        assert any(item["name"] == "ix_idempotency_records_task_id" for item in indexes)
        assert any(item["name"] == "ix_idempotency_task_operation" for item in indexes)
    finally:
        engine.dispose()


def test_migration_rejects_duplicate_existing_idempotency_keys_before_repair(
    tmp_path,
):
    database_url = f"sqlite:///{tmp_path / 'migration-duplicate-idempotency.db'}"
    alembic_ini = Path(__file__).parents[1] / "alembic.ini"
    alembic_config = Config(str(alembic_ini))
    alembic_config.set_main_option("sqlalchemy.url", database_url)

    command.upgrade(alembic_config, "0001_initial")
    task_id = uuid4()
    now = datetime.now(timezone.utc)
    engine = create_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(
                TaskRow.__table__.insert().values(
                    id=task_id,
                    status=TaskStatus.UPLOADING.value,
                    created_at=now,
                    updated_at=now,
                    idempotency_key=None,
                    original_asset_url=None,
                    mask_asset_url=None,
                    error=None,
                )
            )
            _create_legacy_idempotency_table(connection)
            connection.exec_driver_sql(
                """
                INSERT INTO idempotency_records
                    (id, task_id, operation, key, request_hash,
                     result_status, candidate_position, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        1,
                        task_id.hex,
                        "analyze",
                        "duplicate-key",
                        "hash-1",
                        TaskStatus.ANALYZING.value,
                        None,
                        now,
                        now,
                    ),
                    (
                        2,
                        task_id.hex,
                        "analyze",
                        "duplicate-key",
                        "hash-2",
                        TaskStatus.ANALYZING.value,
                        None,
                        now,
                        now,
                    ),
                ],
            )
    finally:
        engine.dispose()

    with pytest.raises(RuntimeError, match="duplicate.*idempotency"):
        command.upgrade(alembic_config, "head")


def test_idempotency_key_is_rejected_by_the_database_when_reused(repository):
    task = TaskRecord.new()
    repository.create_task(task)
    now = datetime.now(timezone.utc)
    repository.session.add(
        IdempotencyRow(
            task_id=task.id,
            operation="analyze",
            key="same-key",
            request_hash="hash-1",
            result_status=TaskStatus.ANALYZING.value,
            created_at=now,
            updated_at=now,
        )
    )
    repository.session.commit()
    repository.session.add(
        IdempotencyRow(
            task_id=task.id,
            operation="analyze",
            key="same-key",
            request_hash="hash-2",
            result_status=TaskStatus.ANALYZING.value,
            created_at=now,
            updated_at=now,
        )
    )
    with pytest.raises(IntegrityError):
        repository.session.commit()
    repository.session.rollback()


def test_database_rejects_version_positions_outside_candidate_slots(repository):
    task = TaskRecord.new()
    repository.create_task(task)
    version = VersionRecord(asset_url=_asset("version", "out-of-range.jpg"))
    repository.session.add(
        VersionRow(
            id=version.id,
            task_id=task.id,
            position=2,
            payload=version.model_dump(mode="json"),
        )
    )
    with pytest.raises(IntegrityError):
        repository.session.commit()
    repository.session.rollback()


def test_db_module_does_not_create_an_engine_during_import():
    import app.db as db

    assert db.engine is None
    assert db.SessionLocal is not None


def test_submit_race_preserves_reservation_generation_and_rejects_late_worker(
    repository,
):
    task = TaskRecord.new()
    repository.create_task(task)
    reserved = repository.reserve_generation_and_mark_task_generating(
        task.id, "submit-race", "hash-race", "provider-key-race"
    )

    # A worker captured generation 1 but timed out before claiming the
    # external submit.  Reclaiming must advance the reservation generation.
    row = repository.session.scalar(
        select(IdempotencyRow).where(
            IdempotencyRow.task_id == task.id,
            IdempotencyRow.key == "submit-race",
        )
    )
    row.updated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    repository.session.commit()
    assert (
        repository.reclaim_stale_generation_reservations(
            task.id, datetime.now(timezone.utc) - timedelta(minutes=5)
        )
        == 1
    )

    late = repository.record_provider_submission(
        task.id,
        "submit-race",
        "hash-race",
        reserved.reservation_generation,
        provider_job_id="late-job-must-not-win",
        provider_status="queued",
    )
    assert late.provider_job_id is None
    assert late.provider_status == "stale_reservation"
    assert late.reservation_generation > reserved.reservation_generation

    recovered = repository.reacquire_generation_slot(
        task.id, "submit-race", "hash-race", "provider-key-race"
    )
    assert recovered.provider_status == "reserved"
    assert recovered.candidate_position is not None
    claimed = repository.begin_provider_submission(
        task.id,
        "submit-race",
        "hash-race",
        recovered.reservation_generation,
    )
    assert claimed.provider_status == "submitting"
    assert (
        repository.reclaim_stale_generation_reservations(
            task.id, datetime.now(timezone.utc) - timedelta(minutes=5)
        )
        == 0
    )
    accepted = repository.record_provider_submission(
        task.id,
        "submit-race",
        "hash-race",
        recovered.reservation_generation,
        provider_job_id="recovered-job",
        provider_status="queued",
    )
    assert accepted.provider_job_id == "recovered-job"


def test_stale_submitting_reservation_is_reclaimed_and_late_worker_is_ignored(
    repository,
):
    task = TaskRecord.new()
    repository.create_task(task)
    reserved = repository.reserve_generation_and_mark_task_generating(
        task.id, "submitting-timeout", "hash-timeout", "provider-key-timeout"
    )
    submitting = repository.begin_provider_submission(
        task.id,
        "submitting-timeout",
        "hash-timeout",
        reserved.reservation_generation,
    )
    assert submitting.provider_status == "submitting"

    row = repository.session.scalar(
        select(IdempotencyRow).where(
            IdempotencyRow.task_id == task.id,
            IdempotencyRow.key == "submitting-timeout",
        )
    )
    row.updated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    repository.session.commit()

    assert (
        repository.reclaim_stale_generation_reservations(
            task.id, datetime.now(timezone.utc) - timedelta(minutes=5)
        )
        == 1
    )
    stale = repository.get_idempotency(task.id, "generate", "submitting-timeout")
    assert stale.provider_status == "stale_reservation"
    assert stale.candidate_position is None
    assert stale.reservation_generation > submitting.reservation_generation
    assert repository.get_task(task.id).status is TaskStatus.FAILED

    late = repository.record_provider_submission(
        task.id,
        "submitting-timeout",
        "hash-timeout",
        submitting.reservation_generation,
        provider_job_id="late-submit-must-not-win",
        provider_status="queued",
    )
    assert late.provider_job_id is None
    assert late.reservation_generation == stale.reservation_generation

    recovered = repository.reacquire_generation_slot(
        task.id, "submitting-timeout", "hash-timeout", "provider-key-timeout"
    )
    assert recovered.provider_status == "reserved"
    assert recovered.candidate_position is not None


def test_stale_unsubmitted_generation_reservation_can_be_reclaimed(repository):
    task = TaskRecord.new()
    repository.create_task(task)
    first = repository.reserve_generation_and_mark_task_generating(
        task.id, "abandoned-generation", "hash-abandoned", "provider-key"
    )
    row = repository.session.scalar(
        select(IdempotencyRow).where(IdempotencyRow.task_id == task.id)
    )
    row.updated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    repository.session.commit()

    reclaimed = repository.reclaim_stale_generation_reservations(
        task.id,
        datetime.now(timezone.utc) - timedelta(minutes=5),
    )
    second = repository.reserve_generation(
        task.id, "new-generation", "hash-new", "provider-key-new"
    )

    assert reclaimed == 1
    assert first.candidate_position == second.candidate_position == 0
    stale = repository.get_idempotency(task.id, "generate", "abandoned-generation")
    assert stale.result_status is TaskStatus.GENERATING
    assert stale.provider_status == "stale_reservation"
    assert stale.candidate_position is None
    assert repository.get_task(task.id).status is TaskStatus.FAILED


def test_reclaim_does_not_downgrade_a_task_with_another_active_reservation(
    repository,
):
    task = TaskRecord.new()
    repository.create_task(task)
    stale = repository.reserve_generation_and_mark_task_generating(
        task.id, "stale-generation", "hash-stale", "provider-stale"
    )
    active = repository.reserve_generation(
        task.id, "active-generation", "hash-active", "provider-active"
    )
    stale_row = repository.session.scalar(
        select(IdempotencyRow).where(
            IdempotencyRow.task_id == task.id,
            IdempotencyRow.key == "stale-generation",
        )
    )
    stale_row.updated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    repository.session.commit()

    reclaimed = repository.reclaim_stale_generation_reservations(
        task.id, datetime.now(timezone.utc) - timedelta(minutes=5)
    )

    assert reclaimed == 1
    assert active.candidate_position != stale.candidate_position
    assert repository.get_task(task.id).status is TaskStatus.GENERATING
