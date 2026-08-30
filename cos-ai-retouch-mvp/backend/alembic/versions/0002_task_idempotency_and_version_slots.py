"""Persist provider operation state and reserve bounded version slots."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "0002_task_idempotency_and_version_slots"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _json_payload() -> sa.types.TypeEngine:
    return sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    task_id = sa.Uuid(as_uuid=True)
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # Check legacy data before any non-transactional SQLite DDL.  A duplicate
    # slot cannot be deterministically migrated and must be fixed explicitly,
    # rather than leaving half of 0002 applied.
    duplicate_positions = bind.execute(
        sa.text(
            "SELECT task_id, position, COUNT(*) AS total "
            "FROM versions GROUP BY task_id, position HAVING COUNT(*) > 1"
        )
    ).fetchall()
    if duplicate_positions:
        raise RuntimeError(
            "0002 cannot add the version slot constraint: duplicate version "
            "position exists; resolve duplicate (task_id, position) rows first"
        )
    over_limit = bind.execute(
        sa.text(
            "SELECT task_id, COUNT(*) AS total FROM versions "
            "GROUP BY task_id HAVING COUNT(*) > 2"
        )
    ).fetchall()
    if over_limit:
        raise RuntimeError(
            "0002 cannot add the version slot constraint: a task has more "
            "than two legacy versions; resolve it first"
        )

    if "idempotency_records" not in tables:
        op.create_table(
            "idempotency_records",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("task_id", task_id, nullable=False),
            sa.Column("operation", sa.String(length=16), nullable=False),
            sa.Column("key", sa.String(length=128), nullable=False),
            sa.Column("request_hash", sa.String(length=128), nullable=False),
            sa.Column("result_status", sa.String(length=32), nullable=False),
            sa.Column("provider_job_id", sa.String(length=255), nullable=True),
            sa.Column("provider_idempotency_key", sa.String(length=128), nullable=True),
            sa.Column("provider_status", sa.String(length=32), nullable=True),
            sa.Column(
                "reservation_generation",
                sa.Integer(),
                nullable=False,
                server_default="1",
            ),
            sa.Column("candidate_position", sa.Integer(), nullable=True),
            sa.Column("version_id", task_id, nullable=True),
            sa.Column("result_asset_url", _json_payload(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "task_id",
                "operation",
                "key",
                name="uq_idempotency_task_operation_key",
            ),
            sa.UniqueConstraint(
                "task_id",
                "operation",
                "candidate_position",
                name="uq_idempotency_task_operation_candidate",
            ),
        )
        op.create_index(
            "ix_idempotency_records_task_id",
            "idempotency_records",
            ["task_id"],
            unique=False,
        )
        op.create_index(
            "ix_idempotency_task_operation",
            "idempotency_records",
            ["task_id", "operation"],
            unique=False,
        )
    else:
        existing_columns = {
            column["name"]
            for column in sa.inspect(bind).get_columns("idempotency_records")
        }
        additions = {
            "provider_idempotency_key": sa.Column(
                "provider_idempotency_key", sa.String(length=128), nullable=True
            ),
            "reservation_generation": sa.Column(
                "reservation_generation",
                sa.Integer(),
                nullable=False,
                server_default="1",
            ),
            "version_id": sa.Column("version_id", task_id, nullable=True),
            "result_asset_url": sa.Column(
                "result_asset_url", _json_payload(), nullable=True
            ),
        }
        missing = [
            column for name, column in additions.items() if name not in existing_columns
        ]
        if missing:
            with op.batch_alter_table("idempotency_records") as batch_op:
                for column in missing:
                    batch_op.add_column(column)

    # Batch mode is required by SQLite for adding a table constraint and also
    # keeps the same migration valid on PostgreSQL.
    if not any(
        item["name"] == "uq_versions_task_position"
        for item in sa.inspect(bind).get_unique_constraints("versions")
    ):
        with op.batch_alter_table("versions") as batch_op:
            batch_op.create_unique_constraint(
                "uq_versions_task_position", ["task_id", "position"]
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "versions" in inspector.get_table_names() and any(
        item["name"] == "uq_versions_task_position"
        for item in inspector.get_unique_constraints("versions")
    ):
        with op.batch_alter_table("versions") as batch_op:
            batch_op.drop_constraint("uq_versions_task_position", type_="unique")
    if "idempotency_records" in inspector.get_table_names():
        current_indexes = {
            item["name"] for item in inspector.get_indexes("idempotency_records")
        }
        if "ix_idempotency_task_operation" in current_indexes:
            op.drop_index(
                "ix_idempotency_task_operation", table_name="idempotency_records"
            )
        if "ix_idempotency_records_task_id" in current_indexes:
            op.drop_index(
                "ix_idempotency_records_task_id", table_name="idempotency_records"
            )
        op.drop_table("idempotency_records")
