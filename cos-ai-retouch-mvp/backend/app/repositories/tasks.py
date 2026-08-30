"""Repository for the typed COS retouch task aggregate."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import delete, select, update
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


class IdempotencyConflictError(ValueError):
    """Raised when one idempotency key is reused for another request."""


class CandidateLimitError(ValueError):
    """Raised when no durable candidate slot remains for a task."""


@dataclass(frozen=True)
class IdempotencyEntry:
    """Public repository representation of a durable operation record."""

    task_id: UUID
    operation: str
    key: str
    request_hash: str
    result_status: TaskStatus
    created_at: datetime
    updated_at: datetime
    provider_job_id: str | None = None
    provider_status: str | None = None
    candidate_position: int | None = None


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
            idempotency_records=[],
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

    @staticmethod
    def _record_entry(payload: dict[str, Any]) -> IdempotencyEntry:
        def timestamp(value: Any) -> datetime:
            if isinstance(value, datetime):
                return _as_utc(value)
            return _as_utc(datetime.fromisoformat(str(value)))

        return IdempotencyEntry(
            task_id=UUID(str(payload["task_id"])),
            operation=str(payload["operation"]),
            key=str(payload["key"]),
            request_hash=str(payload["request_hash"]),
            result_status=TaskStatus(str(payload["result_status"])),
            created_at=timestamp(payload["created_at"]),
            updated_at=timestamp(payload["updated_at"]),
            provider_job_id=(
                str(payload["provider_job_id"])
                if payload.get("provider_job_id") is not None
                else None
            ),
            provider_status=(
                str(payload["provider_status"])
                if payload.get("provider_status") is not None
                else None
            ),
            candidate_position=(
                int(payload["candidate_position"])
                if payload.get("candidate_position") is not None
                else None
            ),
        )

    @staticmethod
    def _record_payload(
        task_id: UUID,
        operation: str,
        key: str,
        request_hash: str,
        result_status: TaskStatus,
        created_at: datetime,
        updated_at: datetime,
        *,
        provider_job_id: str | None = None,
        provider_status: str | None = None,
        candidate_position: int | None = None,
    ) -> dict[str, Any]:
        return {
            "task_id": str(task_id),
            "operation": operation,
            "key": key,
            "request_hash": request_hash,
            "result_status": result_status.value,
            "provider_job_id": provider_job_id,
            "provider_status": provider_status,
            "candidate_position": candidate_position,
            "created_at": _as_utc(created_at).isoformat(),
            "updated_at": _as_utc(updated_at).isoformat(),
        }

    @staticmethod
    def _records(row: TaskRow) -> list[dict[str, Any]]:
        value = row.idempotency_records
        if value is None:
            return []
        if not isinstance(value, list) or any(
            not isinstance(item, dict) for item in value
        ):
            raise ValueError("invalid persisted idempotency records")
        return [dict(item) for item in value]

    @staticmethod
    def _find_record(
        records: list[dict[str, Any]], operation: str, key: str
    ) -> dict[str, Any] | None:
        return next(
            (
                item
                for item in records
                if item.get("operation") == operation and item.get("key") == key
            ),
            None,
        )

    def _replace_records(
        self,
        task_id: UUID,
        expected: list[dict[str, Any]] | None,
        replacement: list[dict[str, Any]],
    ) -> bool:
        """Compare-and-swap the JSON record list to prevent lost updates."""

        result = self.session.execute(
            update(TaskRow)
            .where(
                TaskRow.id == task_id,
                TaskRow.idempotency_records == expected,
            )
            .values(idempotency_records=replacement)
        )
        if result.rowcount != 1:
            self.session.rollback()
            return False
        self.session.commit()
        return True

    def get_idempotency(
        self, task_id: UUID, operation: str, key: str
    ) -> IdempotencyEntry | None:
        row = self.session.get(TaskRow, task_id)
        if row is None:
            return None
        record = self._find_record(self._records(row), operation, key)
        return self._record_entry(record) if record is not None else None

    # Explicit aliases make the persistence boundary easy to discover for
    # callers while keeping the concise method used by the task service.
    get_idempotency_record = get_idempotency

    def create_idempotency(
        self,
        task_id: UUID,
        operation: str,
        key: str,
        request_hash: str,
        result_status: TaskStatus,
        *,
        provider_job_id: str | None = None,
        provider_status: str | None = None,
        candidate_position: int | None = None,
    ) -> IdempotencyEntry:
        """Create or safely recover one durable operation record."""

        for _attempt in range(3):
            row = self._task_row(task_id)
            records = self._records(row)
            existing_payload = self._find_record(records, operation, key)
            if existing_payload is not None:
                existing = self._record_entry(existing_payload)
                self._require_idempotency_hash(existing, request_hash)
                return existing
            now = utc_now()
            payload = self._record_payload(
                task_id,
                operation,
                key,
                request_hash,
                result_status,
                now,
                now,
                provider_job_id=provider_job_id,
                provider_status=provider_status,
                candidate_position=candidate_position,
            )
            replacement = [*records, payload]
            if self._replace_records(task_id, row.idempotency_records, replacement):
                return self._record_entry(payload)
        raise RuntimeError("could not persist idempotency record")

    create_idempotency_record = create_idempotency

    def reserve_generation(
        self,
        task_id: UUID,
        key: str,
        request_hash: str,
    ) -> IdempotencyEntry:
        """Reserve one of two candidate slots in the same transaction.

        The task row CAS is the cross-process arbiter. A losing transaction
        rolls back and retries with the next slot; no in-memory counter is
        trusted for the limit.
        """

        for _attempt in range(3):
            row = self._task_row(task_id)
            records = self._records(row)
            existing_payload = self._find_record(records, "generate", key)
            if existing_payload is not None:
                existing = self._record_entry(existing_payload)
                self._require_idempotency_hash(existing, request_hash)
                return existing
            occupied_versions = set(
                self.session.scalars(
                    select(VersionRow.position).where(
                        VersionRow.task_id == task_id
                    )
                ).all()
            )
            occupied_reservations = {
                int(item["candidate_position"])
                for item in records
                if item.get("operation") == "generate"
                and item.get("result_status") != TaskStatus.FAILED.value
                and item.get("candidate_position") is not None
            }
            position = next(
                (
                    candidate
                    for candidate in range(2)
                    if candidate not in occupied_versions
                    and candidate not in occupied_reservations
                ),
                None,
            )
            if position is None:
                raise CandidateLimitError(
                    "a task may have at most two candidate versions"
                )

            now = utc_now()
            payload = self._record_payload(
                task_id,
                "generate",
                key,
                request_hash,
                TaskStatus.GENERATING,
                now,
                now,
                candidate_position=position,
            )
            if self._replace_records(
                task_id, row.idempotency_records, [*records, payload]
            ):
                return self._record_entry(payload)
            # Another worker changed the task row.  Re-read and choose the
            # other slot before making the stable limit decision.
            continue

        raise CandidateLimitError("a task may have at most two candidate versions")

    def update_idempotency(
        self,
        task_id: UUID,
        operation: str,
        key: str,
        *,
        request_hash: str | None = None,
        result_status: TaskStatus | None = None,
        provider_job_id: str | None | object = ...,
        provider_status: str | None | object = ...,
        candidate_position: int | None | object = ...,
    ) -> IdempotencyEntry:
        """Update provider progress and final state durably."""

        for _attempt in range(3):
            row = self._task_row(task_id)
            records = self._records(row)
            current = self._find_record(records, operation, key)
            if current is None:
                raise ValueError("idempotency record does not exist")
            existing = self._record_entry(current)
            if request_hash is not None and existing.request_hash != request_hash:
                raise IdempotencyConflictError("idempotency request hash conflict")
            replacement_record = dict(current)
            if result_status is not None:
                replacement_record["result_status"] = result_status.value
            if provider_job_id is not ...:
                replacement_record["provider_job_id"] = provider_job_id
            if provider_status is not ...:
                replacement_record["provider_status"] = provider_status
            if candidate_position is not ...:
                replacement_record["candidate_position"] = candidate_position
            replacement_record["updated_at"] = utc_now().isoformat()
            replacement = [
                replacement_record if item is current else item for item in records
            ]
            if self._replace_records(task_id, row.idempotency_records, replacement):
                return self._record_entry(replacement_record)
        raise RuntimeError("could not update idempotency record")

    update_idempotency_record = update_idempotency

    @staticmethod
    def _require_idempotency_hash(
        existing: IdempotencyEntry, request_hash: str
    ) -> None:
        if existing.request_hash != request_hash:
            raise IdempotencyConflictError("idempotency request hash conflict")

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

    def add_version(
        self, task_id: UUID, version: VersionRecord, *, position: int | None = None
    ) -> None:
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

        occupied_positions = set(
            self.session.scalars(
                select(VersionRow.position).where(VersionRow.task_id == task_id)
            ).all()
        )
        if len(occupied_positions) >= 2:
            raise CandidateLimitError("a task may have at most two candidate versions")
        if position is None:
            position = next(
                candidate
                for candidate in range(2)
                if candidate not in occupied_positions
            )
        if position not in (0, 1):
            raise CandidateLimitError("a task may have at most two candidate versions")
        self._ensure_asset(task_id, validated_version.asset_url)
        self.session.add(
            VersionRow(
                id=validated_version.id,
                task_id=task_id,
                position=position,
                payload=version_payload,
            )
        )
        task_row.updated_at = utc_now()
        try:
            self.session.commit()
        except IntegrityError as error:
            self.session.rollback()
            if "uq_versions_task_position" in str(error.orig) or (
                position in (0, 1)
                and self.session.scalar(
                    select(VersionRow.id).where(
                        VersionRow.task_id == task_id,
                        VersionRow.position == position,
                    )
                )
                is not None
            ):
                raise CandidateLimitError(
                    "a task may have at most two candidate versions"
                ) from error
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
