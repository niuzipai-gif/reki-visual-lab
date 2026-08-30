"""Repository for the typed COS retouch task aggregate."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import (
    AnalysisCardRow,
    AssetRow,
    EditPlanRow,
    TaskRow,
    VersionRow,
    utc_now,
)
from app.domain.models import (
    AnalysisCard,
    AssetURL,
    EditPlan,
    TaskRecord,
    TaskStatus,
    VersionRecord,
)


_CARDS_ADAPTER = TypeAdapter(tuple[AnalysisCard, ...])


class VersionConflictError(ValueError):
    """Raised when a version UUID is reused with a different asset payload."""


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _require_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("cutoff must be timezone-aware UTC")
    if value.utcoffset().total_seconds() != 0:
        raise ValueError("cutoff must be timezone-aware UTC")
    return value


def _payload(model: Any) -> dict[str, Any]:
    """Serialize a validated Pydantic model into a JSON-column payload."""

    return model.model_dump(mode="json")


class TaskRepository:
    """Concrete SQLAlchemy repository using a caller-owned session."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def _task_row(self, task_id: UUID) -> TaskRow:
        row = self.session.get(TaskRow, task_id)
        if row is None:
            raise ValueError(f"Task {task_id} does not exist")
        return row

    def _ensure_asset(self, task_id: UUID, asset: AssetURL) -> None:
        asset_payload = _payload(asset)
        if any(
            isinstance(pending, AssetRow)
            and pending.task_id == task_id
            and pending.kind == asset.kind
            and pending.payload == asset_payload
            for pending in self.session.new
        ):
            return

        existing_assets = self.session.scalars(
            select(AssetRow).where(
                AssetRow.task_id == task_id,
                AssetRow.kind == asset.kind,
            )
        ).all()
        if any(existing.payload == asset_payload for existing in existing_assets):
            return

        self.session.add(
            AssetRow(task_id=task_id, kind=asset.kind, payload=asset_payload)
        )

    def _save_initial_children(self, task: TaskRecord) -> None:
        for position, card in enumerate(task.analysis):
            self.session.add(
                AnalysisCardRow(
                    task_id=task.id,
                    card_id=card.id,
                    position=position,
                    payload=_payload(card),
                )
            )
        if task.plan is not None:
            self.session.add(EditPlanRow(task_id=task.id, payload=_payload(task.plan)))
        for position, version in enumerate(task.versions):
            self._ensure_asset(task.id, version.asset_url)
            self.session.add(
                VersionRow(
                    id=version.id,
                    task_id=task.id,
                    position=position,
                    payload=_payload(version),
                )
            )

    def create_task(self, task: TaskRecord) -> TaskRecord:
        validated = TaskRecord.model_validate(task)
        row = TaskRow(
            id=validated.id,
            status=validated.status.value,
            created_at=validated.created_at,
            updated_at=validated.updated_at,
            idempotency_key=validated.idempotency_key,
            original_asset_url=(
                _payload(validated.original_asset_url)
                if validated.original_asset_url is not None
                else None
            ),
            mask_asset_url=(
                _payload(validated.mask_asset_url)
                if validated.mask_asset_url is not None
                else None
            ),
            error=_payload(validated.error) if validated.error is not None else None,
        )
        self.session.add(row)
        for asset in (validated.original_asset_url, validated.mask_asset_url):
            if asset is not None:
                self._ensure_asset(validated.id, asset)
        self._save_initial_children(validated)
        self.session.commit()
        return validated

    def get_task(self, task_id: UUID) -> TaskRecord | None:
        row = self.session.get(TaskRow, task_id)
        if row is None:
            return None

        cards = self.session.scalars(
            select(AnalysisCardRow)
            .where(AnalysisCardRow.task_id == task_id)
            .order_by(AnalysisCardRow.position, AnalysisCardRow.id)
        ).all()
        plan_row = self.session.scalar(
            select(EditPlanRow).where(EditPlanRow.task_id == task_id)
        )
        versions = self.session.scalars(
            select(VersionRow)
            .where(VersionRow.task_id == task_id)
            .order_by(VersionRow.position)
        ).all()

        aggregate = {
            "id": row.id,
            "status": row.status,
            "created_at": _as_utc(row.created_at),
            "updated_at": _as_utc(row.updated_at),
            "idempotency_key": row.idempotency_key,
            "original_asset_url": row.original_asset_url,
            "mask_asset_url": row.mask_asset_url,
            "analysis": [card.payload for card in cards],
            "plan": plan_row.payload if plan_row is not None else None,
            "versions": [version.payload for version in versions],
            "error": row.error,
        }
        return TaskRecord.model_validate(aggregate)

    def save_analysis(self, task_id: UUID, cards: list[AnalysisCard]) -> None:
        task_row = self._task_row(task_id)
        validated_cards = _CARDS_ADAPTER.validate_python(cards)
        self.session.execute(
            delete(AnalysisCardRow).where(AnalysisCardRow.task_id == task_id)
        )
        for position, card in enumerate(validated_cards):
            self.session.add(
                AnalysisCardRow(
                    task_id=task_id,
                    card_id=card.id,
                    position=position,
                    payload=_payload(card),
                )
            )
        task_row.updated_at = utc_now()
        self.session.commit()

    def save_plan(self, task_id: UUID, plan: EditPlan) -> None:
        task_row = self._task_row(task_id)
        validated_plan = EditPlan.model_validate(plan)
        self.session.execute(delete(EditPlanRow).where(EditPlanRow.task_id == task_id))
        self.session.add(
            EditPlanRow(task_id=task_id, payload=_payload(validated_plan))
        )
        task_row.updated_at = utc_now()
        self.session.commit()

    def add_version(self, task_id: UUID, version: VersionRecord) -> None:
        validated_version = VersionRecord.model_validate(version)
        version_payload = _payload(validated_version)
        task_row = self._task_row(task_id)
        existing = self.session.get(VersionRow, validated_version.id)
        if existing is not None:
            if existing.task_id != task_id:
                raise ValueError(
                    f"Version {validated_version.id} belongs to another task"
                )
            stored_version = VersionRecord.model_validate(existing.payload)
            if stored_version.asset_url != validated_version.asset_url:
                raise VersionConflictError(
                    f"Version {validated_version.id} asset payload conflict: "
                    "existing asset differs from retry"
                )
            existing.payload = version_payload
            self._ensure_asset(task_id, validated_version.asset_url)
            task_row.updated_at = utc_now()
            try:
                self.session.commit()
            except IntegrityError as error:
                self.session.rollback()
                self._retry_existing_version(task_id, validated_version, error)
            return

        last_position = self.session.scalar(
            select(func.max(VersionRow.position)).where(
                VersionRow.task_id == task_id
            )
        )
        self._ensure_asset(task_id, validated_version.asset_url)
        self.session.add(
            VersionRow(
                id=validated_version.id,
                task_id=task_id,
                position=(last_position + 1 if last_position is not None else 0),
                payload=version_payload,
            )
        )
        task_row.updated_at = utc_now()
        try:
            self.session.commit()
        except IntegrityError as error:
            self.session.rollback()
            self._retry_existing_version(task_id, validated_version, error)

    def _retry_existing_version(
        self,
        task_id: UUID,
        validated_version: VersionRecord,
        failure: IntegrityError,
    ) -> None:
        """Resolve a concurrent insert after rolling back the losing transaction."""

        existing = self.session.get(VersionRow, validated_version.id)
        if existing is None:
            raise failure
        if existing.task_id != task_id:
            raise VersionConflictError(
                f"Version {validated_version.id} asset payload conflict: "
                "version belongs to another task"
            )

        stored_version = VersionRecord.model_validate(existing.payload)
        if stored_version.asset_url != validated_version.asset_url:
            raise VersionConflictError(
                f"Version {validated_version.id} asset payload conflict: "
                "existing asset differs from retry"
            )

        self._ensure_asset(task_id, validated_version.asset_url)
        task_row = self._task_row(task_id)
        task_row.updated_at = utc_now()
        try:
            self.session.commit()
        except IntegrityError as retry_failure:
            self.session.rollback()
            raise retry_failure

    def mark_expired_before(self, cutoff: datetime) -> int:
        cutoff = _require_utc(cutoff)
        result = self.session.execute(
            update(TaskRow)
            .where(
                TaskRow.status != TaskStatus.EXPIRED.value,
                TaskRow.created_at < cutoff,
            )
            .values(status=TaskStatus.EXPIRED.value, updated_at=utc_now())
        )
        self.session.commit()
        return int(result.rowcount or 0)
