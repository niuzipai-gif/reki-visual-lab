"""Persist provider operation state and reserve bounded version slots."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002_task_idempotency_and_version_slots"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    task_id = sa.Uuid(as_uuid=True)
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

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
            sa.Column("provider_status", sa.String(length=32), nullable=True),
            sa.Column("candidate_position", sa.Integer(), nullable=True),
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
    with op.batch_alter_table("versions") as batch_op:
        batch_op.drop_constraint("uq_versions_task_position", type_="unique")
    op.drop_index(
        "ix_idempotency_task_operation", table_name="idempotency_records"
    )
    op.drop_index("ix_idempotency_records_task_id", table_name="idempotency_records")
    op.drop_table("idempotency_records")
