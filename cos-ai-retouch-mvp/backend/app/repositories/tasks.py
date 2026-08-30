"""Repository for the typed COS retouch task aggregate."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import delete, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import (
    AnalysisCardRow,
    AssetRow,
    EditPlanRow,
    IdempotencyRow,
    TaskRow,
    VersionRow,
    utc_now,
)
from app.domain.models import (
    AnalysisCard,
    AssetURL,
    EditPlan,
    TaskRecord,
    TaskError,
    TaskStatus,
    VersionRecord,
)


_CARDS_ADAPTER = TypeAdapter(tuple[AnalysisCard, ...])
_UNSET = object()


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
    provider_idempotency_key: str | None = None
    provider_status: str | None = None
    reservation_generation: int = 1
    candidate_position: int | None = None
    version_id: UUID | None = None
    result_asset_url: AssetURL | None = None


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

    def _commit(self) -> None:
        """Commit a unit of work and always clear a failed transaction."""

        try:
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

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
        try:
            self.session.add(row)
            # SQLite enforces FK order during flush; make the parent visible
            # before adding initial asset rows while keeping create atomic.
            self.session.flush()
            for asset in (validated.original_asset_url, validated.mask_asset_url):
                if asset is not None:
                    self._ensure_asset(validated.id, asset)
            self._save_initial_children(validated)
            self._commit()
        except Exception:
            self.session.rollback()
            raise
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
    def _as_idempotency(row: IdempotencyRow) -> IdempotencyEntry:
        return IdempotencyEntry(
            task_id=row.task_id,
            operation=row.operation,
            key=row.key,
            request_hash=row.request_hash,
            result_status=TaskStatus(row.result_status),
            created_at=_as_utc(row.created_at),
            updated_at=_as_utc(row.updated_at),
            provider_job_id=row.provider_job_id,
            provider_idempotency_key=row.provider_idempotency_key,
            provider_status=row.provider_status,
            reservation_generation=row.reservation_generation,
            candidate_position=row.candidate_position,
            version_id=row.version_id,
            result_asset_url=(
                AssetURL.model_validate(row.result_asset_url)
                if row.result_asset_url is not None
                else None
            ),
        )

    def get_idempotency(
        self, task_id: UUID, operation: str, key: str
    ) -> IdempotencyEntry | None:
        row = self.session.scalar(
            select(IdempotencyRow).where(
                IdempotencyRow.task_id == task_id,
                IdempotencyRow.operation == operation,
                IdempotencyRow.key == key,
            )
        )
        return self._as_idempotency(row) if row is not None else None

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
        provider_idempotency_key: str | None = None,
        provider_status: str | None = None,
        candidate_position: int | None = None,
        version_id: UUID | None = None,
        result_asset_url: AssetURL | None = None,
    ) -> IdempotencyEntry:
        """Create or safely recover one durable operation record."""

        existing = self.get_idempotency(task_id, operation, key)
        if existing is not None:
            self._require_idempotency_hash(existing, request_hash)
            return existing
        self._task_row(task_id)
        now = utc_now()
        row = IdempotencyRow(
            task_id=task_id,
            operation=operation,
            key=key,
            request_hash=request_hash,
            result_status=result_status.value,
            provider_job_id=provider_job_id,
            provider_idempotency_key=provider_idempotency_key,
            provider_status=provider_status,
            candidate_position=candidate_position,
            version_id=version_id,
            result_asset_url=(
                _payload(result_asset_url) if result_asset_url is not None else None
            ),
            created_at=now,
            updated_at=now,
        )
        self.session.add(row)
        try:
            self._commit()
        except IntegrityError:
            self.session.rollback()
            existing = self.get_idempotency(task_id, operation, key)
            if existing is None:
                raise
            self._require_idempotency_hash(existing, request_hash)
            return existing
        return self._as_idempotency(row)

    create_idempotency_record = create_idempotency

    def reserve_generation(
        self,
        task_id: UUID,
        key: str,
        request_hash: str,
        provider_idempotency_key: str | None = None,
        *,
        mark_task_generating: bool = False,
    ) -> IdempotencyEntry:
        """Reserve one of two candidate slots in the same transaction.

        The unique key on ``(task_id, operation, candidate_position)`` is the
        cross-process arbiter. A losing transaction rolls back and retries
        with the next slot; no in-memory counter is trusted for the limit.
        """

        for _attempt in range(3):
            existing = self.get_idempotency(task_id, "generate", key)
            if existing is not None:
                self._require_idempotency_hash(existing, request_hash)
                if (
                    mark_task_generating
                    and existing.result_status is TaskStatus.GENERATING
                ):
                    task_row = self._task_row(task_id)
                    if task_row.status in {
                        TaskStatus.AWAITING_CONFIRMATION.value,
                        TaskStatus.FAILED.value,
                        TaskStatus.SUCCEEDED.value,
                    }:
                        task_row.status = TaskStatus.GENERATING.value
                        task_row.updated_at = utc_now()
                        self._commit()
                return existing
            self.reclaim_stale_generation_reservations(
                task_id,
                utc_now().replace(microsecond=0),
                keep_key=key,
                max_age_seconds=300,
            )
            task_row = self._task_row(task_id)
            occupied_versions = set(
                self.session.scalars(
                    select(VersionRow.position).where(VersionRow.task_id == task_id)
                ).all()
            )
            occupied_reservations = {
                int(position)
                for position in self.session.scalars(
                    select(IdempotencyRow.candidate_position).where(
                        IdempotencyRow.task_id == task_id,
                        IdempotencyRow.operation == "generate",
                        IdempotencyRow.result_status != TaskStatus.FAILED.value,
                        IdempotencyRow.candidate_position.is_not(None),
                    )
                ).all()
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
            row = IdempotencyRow(
                task_id=task_id,
                operation="generate",
                key=key,
                request_hash=request_hash,
                result_status=TaskStatus.GENERATING.value,
                provider_idempotency_key=provider_idempotency_key,
                provider_status="reserved",
                reservation_generation=1,
                candidate_position=position,
                created_at=now,
                updated_at=now,
            )
            if mark_task_generating:
                task_row.status = TaskStatus.GENERATING.value
                task_row.updated_at = now
            self.session.add(row)
            try:
                self._commit()
            except IntegrityError:
                self.session.rollback()
                existing = self.get_idempotency(task_id, "generate", key)
                if existing is not None:
                    self._require_idempotency_hash(existing, request_hash)
                    return existing
                # Another worker reserved the same slot. Re-read and choose
                # the other slot before making the stable limit decision.
                continue
            return self._as_idempotency(row)

        raise CandidateLimitError("a task may have at most two candidate versions")

    def reclaim_stale_generation_reservations(
        self,
        task_id: UUID,
        cutoff: datetime,
        *,
        keep_key: str | None = None,
        max_age_seconds: int | None = None,
    ) -> int:
        """Release abandoned pre-submit slots without deleting retry records.

        ``submitting`` is included once its lease is older than the cutoff:
        this covers a process that crashed after claiming the reservation but
        before it persisted the provider job.  The generation increment makes
        any late callback from that worker unable to claim the reacquired slot.
        """

        cutoff = _require_utc(cutoff)
        if max_age_seconds is not None:
            cutoff = utc_now() - timedelta(seconds=max_age_seconds)
        conditions = [
            IdempotencyRow.task_id == task_id,
            IdempotencyRow.operation == "generate",
            IdempotencyRow.result_status == TaskStatus.GENERATING.value,
            IdempotencyRow.provider_job_id.is_(None),
            IdempotencyRow.updated_at < cutoff,
            or_(
                IdempotencyRow.provider_status.is_(None),
                IdempotencyRow.provider_status == "reserved",
                IdempotencyRow.provider_status == "submitting",
            ),
        ]
        if keep_key is not None:
            conditions.append(IdempotencyRow.key != keep_key)
        now = utc_now()
        result = self.session.execute(
            update(IdempotencyRow)
            .where(*conditions)
            .values(
                result_status=TaskStatus.GENERATING.value,
                provider_status="stale_reservation",
                reservation_generation=IdempotencyRow.reservation_generation + 1,
                candidate_position=None,
                updated_at=now,
            )
            .execution_options(synchronize_session=False)
        )
        if (
            result.rowcount
            and self.session.scalar(
                select(IdempotencyRow.id)
                .where(
                    IdempotencyRow.task_id == task_id,
                    IdempotencyRow.operation == "generate",
                    IdempotencyRow.result_status != TaskStatus.FAILED.value,
                    IdempotencyRow.candidate_position.is_not(None),
                )
                .limit(1)
            )
            is None
        ):
            task_row = self._task_row(task_id)
            if task_row.status in {
                TaskStatus.GENERATING.value,
                TaskStatus.VALIDATING.value,
            }:
                task_row.status = TaskStatus.FAILED.value
                task_row.updated_at = now
        self._commit()
        # The bulk UPDATE intentionally bypasses ORM evaluation (SQLite
        # stores timezone-aware datetimes as naive values).  Main's factory
        # uses expire_on_commit=False, so explicitly clear stale ORM state.
        self.session.expire_all()
        return int(result.rowcount or 0)

    def reacquire_generation_slot(
        self,
        task_id: UUID,
        key: str,
        request_hash: str,
        provider_idempotency_key: str | None = None,
    ) -> IdempotencyEntry:
        """Reclaim one released slot for the original idempotency key."""

        row = self.session.scalar(
            select(IdempotencyRow)
            .where(
                IdempotencyRow.task_id == task_id,
                IdempotencyRow.operation == "generate",
                IdempotencyRow.key == key,
            )
            .with_for_update()
        )
        if row is None:
            raise ValueError("idempotency record does not exist")
        existing = self._as_idempotency(row)
        self._require_idempotency_hash(existing, request_hash)
        if existing.candidate_position is not None:
            return existing
        if existing.provider_status != "stale_reservation":
            return existing

        version_ids = self.session.scalars(
            select(VersionRow.id).where(VersionRow.task_id == task_id)
        ).all()
        if len(version_ids) >= 2:
            raise CandidateLimitError("a task may have at most two candidate versions")
        occupied = set(
            self.session.scalars(
                select(VersionRow.position).where(VersionRow.task_id == task_id)
            ).all()
        )
        occupied.update(
            int(position)
            for position in self.session.scalars(
                select(IdempotencyRow.candidate_position).where(
                    IdempotencyRow.task_id == task_id,
                    IdempotencyRow.operation == "generate",
                    IdempotencyRow.result_status != TaskStatus.FAILED.value,
                    IdempotencyRow.candidate_position.is_not(None),
                    IdempotencyRow.id != row.id,
                )
            ).all()
        )
        position = next(
            (candidate for candidate in range(2) if candidate not in occupied), None
        )
        if position is None:
            raise CandidateLimitError("a task may have at most two candidate versions")
        row.candidate_position = position
        row.result_status = TaskStatus.GENERATING.value
        row.provider_status = "reserved"
        if provider_idempotency_key is not None:
            row.provider_idempotency_key = provider_idempotency_key
        now = utc_now()
        row.updated_at = now
        task_row = self._task_row(task_id)
        if task_row.status in {
            TaskStatus.FAILED.value,
            TaskStatus.SUCCEEDED.value,
        }:
            task_row.status = TaskStatus.GENERATING.value
            task_row.updated_at = now
        self._commit()
        return self._as_idempotency(row)

    def begin_provider_submission(
        self,
        task_id: UUID,
        key: str,
        request_hash: str,
        reservation_generation: int,
    ) -> IdempotencyEntry:
        """Conditionally mark one reservation as being submitted.

        The generation check makes a worker that captured an old reservation
        harmless after a reclaimer has released that reservation.  A
        A fresh ``submitting`` row is left owned by its current worker.  Once
        its lease is stale, the reclaimer advances its generation and a
        same-key retry may safely reacquire it through the provider's stable
        idempotency key.
        """

        row = self.session.scalar(
            select(IdempotencyRow)
            .where(
                IdempotencyRow.task_id == task_id,
                IdempotencyRow.operation == "generate",
                IdempotencyRow.key == key,
            )
            .with_for_update()
        )
        if row is None:
            raise ValueError("idempotency record does not exist")
        existing = self._as_idempotency(row)
        self._require_idempotency_hash(existing, request_hash)
        if (
            existing.provider_job_id is not None
            or existing.reservation_generation != reservation_generation
            or existing.candidate_position is None
            or existing.provider_status == "stale_reservation"
        ):
            return existing
        if existing.provider_status not in {None, "reserved", "submitting"}:
            return existing
        if existing.provider_status == "submitting":
            return existing

        result = self.session.execute(
            update(IdempotencyRow)
            .where(
                IdempotencyRow.id == row.id,
                IdempotencyRow.reservation_generation == reservation_generation,
                IdempotencyRow.provider_job_id.is_(None),
                IdempotencyRow.candidate_position.is_not(None),
                or_(
                    IdempotencyRow.provider_status.is_(None),
                    IdempotencyRow.provider_status == "reserved",
                ),
            )
            .values(provider_status="submitting", updated_at=utc_now())
        )
        if result.rowcount:
            self._commit()
        return self.get_idempotency(task_id, "generate", key)  # type: ignore[return-value]

    def record_provider_submission(
        self,
        task_id: UUID,
        key: str,
        request_hash: str,
        reservation_generation: int,
        *,
        provider_job_id: str,
        provider_status: str,
        provider_idempotency_key: str | None = None,
    ) -> IdempotencyEntry:
        """Persist a provider job only if the reservation is still ours."""

        row = self.session.scalar(
            select(IdempotencyRow)
            .where(
                IdempotencyRow.task_id == task_id,
                IdempotencyRow.operation == "generate",
                IdempotencyRow.key == key,
            )
            .with_for_update()
        )
        if row is None:
            raise ValueError("idempotency record does not exist")
        existing = self._as_idempotency(row)
        self._require_idempotency_hash(existing, request_hash)
        if existing.provider_job_id is not None:
            return existing
        if (
            existing.reservation_generation != reservation_generation
            or existing.provider_status != "submitting"
            or existing.candidate_position is None
        ):
            return existing

        values: dict[str, Any] = {
            "provider_job_id": provider_job_id,
            "provider_status": provider_status,
            "updated_at": utc_now(),
        }
        if provider_idempotency_key is not None:
            values["provider_idempotency_key"] = provider_idempotency_key
        result = self.session.execute(
            update(IdempotencyRow)
            .where(
                IdempotencyRow.id == row.id,
                IdempotencyRow.reservation_generation == reservation_generation,
                IdempotencyRow.provider_status == "submitting",
                IdempotencyRow.provider_job_id.is_(None),
                IdempotencyRow.candidate_position.is_not(None),
            )
            .values(**values)
        )
        if result.rowcount:
            self._commit()
        return self.get_idempotency(task_id, "generate", key)  # type: ignore[return-value]

    def fail_generation_if_current(
        self,
        task_id: UUID,
        key: str,
        request_hash: str,
        reservation_generation: int,
        error: TaskError,
    ) -> bool:
        """Persist a generation failure only for the current reservation.

        Provider exceptions can arrive after a stale worker has been
        reclaimed and replaced.  Updating the idempotency row and task row in
        one transaction prevents that old worker from downgrading a newer
        successful result.
        """

        row = self.session.scalar(
            select(IdempotencyRow)
            .where(
                IdempotencyRow.task_id == task_id,
                IdempotencyRow.operation == "generate",
                IdempotencyRow.key == key,
            )
            .with_for_update()
        )
        if row is None:
            raise ValueError("idempotency record does not exist")
        existing = self._as_idempotency(row)
        self._require_idempotency_hash(existing, request_hash)
        if (
            existing.reservation_generation != reservation_generation
            or existing.result_status is TaskStatus.SUCCEEDED
            or existing.provider_status == "stale_reservation"
        ):
            return False

        task_row = self._task_row(task_id)
        if task_row.status in {
            TaskStatus.SUCCEEDED.value,
            TaskStatus.EXPIRED.value,
        }:
            return False
        now = utc_now()
        row.result_status = TaskStatus.FAILED.value
        row.provider_status = "failed"
        row.candidate_position = None
        row.updated_at = now
        task_row.status = TaskStatus.FAILED.value
        task_row.error = _payload(error)
        task_row.updated_at = now
        self._commit()
        self.session.expire_all()
        return True

    def reserve_generation_and_mark_task_generating(
        self,
        task_id: UUID,
        key: str,
        request_hash: str,
        provider_idempotency_key: str | None = None,
    ) -> IdempotencyEntry:
        """Reserve a candidate slot and persist ``generating`` atomically."""

        return self.reserve_generation(
            task_id,
            key,
            request_hash,
            provider_idempotency_key,
            mark_task_generating=True,
        )

    def update_idempotency(
        self,
        task_id: UUID,
        operation: str,
        key: str,
        *,
        request_hash: str | None = None,
        result_status: TaskStatus | None = None,
        provider_job_id: str | None | object = _UNSET,
        provider_idempotency_key: str | None | object = _UNSET,
        provider_status: str | None | object = _UNSET,
        candidate_position: int | None | object = _UNSET,
        version_id: UUID | None | object = _UNSET,
        result_asset_url: AssetURL | None | object = _UNSET,
        reservation_generation: int | None = None,
    ) -> IdempotencyEntry:
        """Update provider progress and final state durably."""

        row = self.session.scalar(
            select(IdempotencyRow)
            .where(
                IdempotencyRow.task_id == task_id,
                IdempotencyRow.operation == operation,
                IdempotencyRow.key == key,
            )
            .with_for_update()
        )
        if row is None:
            raise ValueError("idempotency record does not exist")
        existing = self._as_idempotency(row)
        if request_hash is not None and existing.request_hash != request_hash:
            raise IdempotencyConflictError("idempotency request hash conflict")

        values: dict[str, Any] = {"updated_at": utc_now()}
        if result_status is not None:
            values["result_status"] = result_status.value
        if provider_job_id is not _UNSET:
            values["provider_job_id"] = provider_job_id
        if provider_idempotency_key is not _UNSET:
            values["provider_idempotency_key"] = provider_idempotency_key
        if provider_status is not _UNSET:
            values["provider_status"] = provider_status
        if candidate_position is not _UNSET:
            values["candidate_position"] = candidate_position
        if version_id is not _UNSET:
            values["version_id"] = version_id
        if result_asset_url is not _UNSET:
            values["result_asset_url"] = (
                _payload(result_asset_url) if result_asset_url is not None else None
            )

        conditions = [IdempotencyRow.id == row.id]
        if reservation_generation is not None:
            conditions.append(
                IdempotencyRow.reservation_generation == reservation_generation
            )
            if operation == "generate":
                task_row = self._task_row(task_id)
                if task_row.status in {
                    TaskStatus.SUCCEEDED.value,
                    TaskStatus.EXPIRED.value,
                }:
                    return existing
        try:
            updated = self.session.execute(
                update(IdempotencyRow).where(*conditions).values(**values)
            )
            if not updated.rowcount:
                self.session.expire_all()
                current = self.get_idempotency(task_id, operation, key)
                if current is None:
                    raise ValueError("idempotency record does not exist")
                return current
            self._commit()
        except IntegrityError:
            self.session.rollback()
            raise
        self.session.expire_all()
        current = self.get_idempotency(task_id, operation, key)
        if current is None:
            raise ValueError("idempotency record does not exist")
        return current

    update_idempotency_record = update_idempotency

    def get_version(
        self,
        task_id: UUID,
        *,
        version_id: UUID | None = None,
        position: int | None = None,
    ) -> VersionRecord | None:
        """Read a candidate used to reconcile an interrupted generation."""

        if version_id is None and position is None:
            raise ValueError("version_id or position is required")
        query = select(VersionRow).where(VersionRow.task_id == task_id)
        if version_id is not None:
            query = query.where(VersionRow.id == version_id)
        else:
            query = query.where(VersionRow.position == position)
        row = self.session.scalar(query)
        return VersionRecord.model_validate(row.payload) if row is not None else None

    def prepare_generation_result(
        self,
        task_id: UUID,
        key: str,
        request_hash: str,
        version_id: UUID,
        result_asset_url: AssetURL,
        *,
        provider_status: str = "succeeded",
    ) -> IdempotencyEntry:
        """Durably record the chosen version UUID before final DB commit."""

        row = self.session.scalar(
            select(IdempotencyRow)
            .where(
                IdempotencyRow.task_id == task_id,
                IdempotencyRow.operation == "generate",
                IdempotencyRow.key == key,
            )
            .with_for_update()
        )
        if row is None:
            raise ValueError("idempotency record does not exist")
        existing = self._as_idempotency(row)
        self._require_idempotency_hash(existing, request_hash)
        if existing.version_id is not None and existing.version_id != version_id:
            raise VersionConflictError("generation version UUID differs on retry")
        if (
            existing.result_asset_url is not None
            and existing.result_asset_url != result_asset_url
        ):
            raise VersionConflictError("generation result asset differs on retry")
        row.version_id = version_id
        row.result_asset_url = _payload(result_asset_url)
        row.result_status = TaskStatus.VALIDATING.value
        row.provider_status = provider_status
        row.updated_at = utc_now()
        self._commit()
        return self._as_idempotency(row)

    def finalize_generation(
        self,
        task_id: UUID,
        key: str,
        request_hash: str,
        version: VersionRecord,
        *,
        position: int | None,
    ) -> IdempotencyEntry:
        """Atomically write version, task success, and idempotency final state."""

        validated = VersionRecord.model_validate(version)
        row = self.session.scalar(
            select(IdempotencyRow)
            .where(
                IdempotencyRow.task_id == task_id,
                IdempotencyRow.operation == "generate",
                IdempotencyRow.key == key,
            )
            .with_for_update()
        )
        if row is None:
            raise ValueError("idempotency record does not exist")
        existing = self._as_idempotency(row)
        self._require_idempotency_hash(existing, request_hash)
        if existing.version_id is not None and existing.version_id != validated.id:
            raise VersionConflictError("generation version UUID differs on retry")
        if (
            existing.result_asset_url is not None
            and existing.result_asset_url != validated.asset_url
        ):
            raise VersionConflictError("generation result asset differs on retry")

        task_row = self._task_row(task_id)
        stored = self.session.get(VersionRow, validated.id)
        if stored is not None:
            if stored.task_id != task_id:
                raise VersionConflictError("version belongs to another task")
            stored_version = VersionRecord.model_validate(stored.payload)
            if stored_version.asset_url != validated.asset_url:
                raise VersionConflictError("existing version asset differs on retry")
            actual_position = stored.position
        else:
            occupied = {
                int(item)
                for item in self.session.scalars(
                    select(VersionRow.position).where(VersionRow.task_id == task_id)
                ).all()
            }
            actual_position = (
                existing.candidate_position
                if existing.candidate_position is not None
                else position
            )
            if actual_position is None:
                actual_position = next(
                    (candidate for candidate in range(2) if candidate not in occupied),
                    None,
                )
            if actual_position not in (0, 1) or actual_position in occupied:
                raise CandidateLimitError(
                    "a task may have at most two candidate versions"
                )
            self._ensure_asset(task_id, validated.asset_url)
            self.session.add(
                VersionRow(
                    id=validated.id,
                    task_id=task_id,
                    position=actual_position,
                    payload=_payload(validated),
                )
            )

        row.version_id = validated.id
        row.result_asset_url = _payload(validated.asset_url)
        row.result_status = TaskStatus.SUCCEEDED.value
        row.provider_status = "succeeded"
        row.candidate_position = None
        row.updated_at = utc_now()
        task_row.status = TaskStatus.SUCCEEDED.value
        task_row.error = None
        task_row.updated_at = row.updated_at
        self._commit()
        return self._as_idempotency(row)

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
        self._commit()

    def save_plan(self, task_id: UUID, plan: EditPlan) -> None:
        task_row = self._task_row(task_id)
        validated_plan = EditPlan.model_validate(plan)
        self.session.execute(delete(EditPlanRow).where(EditPlanRow.task_id == task_id))
        self.session.add(EditPlanRow(task_id=task_id, payload=_payload(validated_plan)))
        task_row.updated_at = utc_now()
        self._commit()

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
                self._commit()
            except IntegrityError as error:
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
            self._commit()
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
            self._commit()
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
        self._commit()
        return int(result.rowcount or 0)

    def list_tasks_before(self, cutoff: datetime) -> list[TaskRecord]:
        """Return non-expired task aggregates before an expiry cutoff."""

        cutoff = _require_utc(cutoff)
        task_ids = self.session.scalars(
            select(TaskRow.id).where(
                TaskRow.status != TaskStatus.EXPIRED.value,
                TaskRow.created_at < cutoff,
            )
        ).all()
        return [
            task for task_id in task_ids if (task := self.get_task(task_id)) is not None
        ]

    def clear_expired_assets(self, task_id: UUID) -> None:
        """Expire a task and remove every persisted asset/download reference."""

        task_row = self._task_row(task_id)
        task_row.status = TaskStatus.EXPIRED.value
        task_row.original_asset_url = None
        task_row.mask_asset_url = None
        task_row.error = None
        task_row.updated_at = utc_now()
        self.session.execute(delete(AssetRow).where(AssetRow.task_id == task_id))
        self.session.execute(delete(VersionRow).where(VersionRow.task_id == task_id))
        self.session.execute(
            update(IdempotencyRow)
            .where(IdempotencyRow.task_id == task_id)
            .values(
                result_status=TaskStatus.EXPIRED.value,
                provider_status="expired",
                candidate_position=None,
                version_id=None,
                result_asset_url=None,
                updated_at=task_row.updated_at,
            )
        )
        self._commit()
