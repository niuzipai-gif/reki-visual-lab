"""Create the initial COS retouch task schema."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _json_payload() -> sa.types.TypeEngine:
    return sa.JSON().with_variant(JSONB(), "postgresql")


def upgrade() -> None:
    payload = _json_payload()
    task_id = sa.Uuid(as_uuid=True)

    op.create_table(
        "tasks",
        sa.Column("id", task_id, nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("original_asset_url", payload, nullable=True),
        sa.Column("mask_asset_url", payload, nullable=True),
        sa.Column("error", payload, nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tasks_status", "tasks", ["status"], unique=False)
    op.create_index("ix_tasks_created_at", "tasks", ["created_at"], unique=False)
    op.create_index(
        "ix_tasks_status_created_at",
        "tasks",
        ["status", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_tasks_idempotency_key", "tasks", ["idempotency_key"], unique=False
    )

    op.create_table(
        "assets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("task_id", task_id, nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("payload", payload, nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_assets_task_id", "assets", ["task_id"], unique=False)
    op.create_index(
        "ix_assets_task_kind", "assets", ["task_id", "kind"], unique=False
    )

    op.create_table(
        "analysis_cards",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("task_id", task_id, nullable=False),
        sa.Column("card_id", sa.String(length=255), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("payload", payload, nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_analysis_cards_task_id", "analysis_cards", ["task_id"], unique=False
    )
    op.create_index(
        "ix_analysis_cards_task_position",
        "analysis_cards",
        ["task_id", "position"],
        unique=False,
    )

    op.create_table(
        "edit_plans",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("task_id", task_id, nullable=False),
        sa.Column("payload", payload, nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id"),
    )
    op.create_index("ix_edit_plans_task_id", "edit_plans", ["task_id"], unique=False)

    op.create_table(
        "versions",
        sa.Column("id", task_id, nullable=False),
        sa.Column("task_id", task_id, nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("payload", payload, nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_versions_task_id", "versions", ["task_id"], unique=False)
    op.create_index(
        "ix_versions_task_position", "versions", ["task_id", "position"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_versions_task_position", table_name="versions")
    op.drop_index("ix_versions_task_id", table_name="versions")
    op.drop_table("versions")
    op.drop_index("ix_edit_plans_task_id", table_name="edit_plans")
    op.drop_table("edit_plans")
    op.drop_index("ix_analysis_cards_task_position", table_name="analysis_cards")
    op.drop_index("ix_analysis_cards_task_id", table_name="analysis_cards")
    op.drop_table("analysis_cards")
    op.drop_index("ix_assets_task_kind", table_name="assets")
    op.drop_index("ix_assets_task_id", table_name="assets")
    op.drop_table("assets")
    op.drop_index("ix_tasks_idempotency_key", table_name="tasks")
    op.drop_index("ix_tasks_status_created_at", table_name="tasks")
    op.drop_index("ix_tasks_created_at", table_name="tasks")
    op.drop_index("ix_tasks_status", table_name="tasks")
    op.drop_table("tasks")
