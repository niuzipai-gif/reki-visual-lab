"""Application service for the invite-only COS retouch task workflow."""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
import os
import secrets
import time
from threading import RLock
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID, uuid4

from pydantic import ValidationError

from app.config import Settings, get_settings
from app.db import TaskRow, utc_now
from app.domain.models import (
    AssetURL,
    EditPlan,
    TaskError,
    TaskRecord,
    TaskStatus,
    VersionRecord,
)
from app.domain.state import InvalidTransition
from app.repositories.tasks import (
    CandidateLimitError,
    IdempotencyConflictError,
    IdempotencyEntry,
    TaskRepository,
)
from app.services.image_provider import (
    ImageModelProvider,
    ProviderError,
)
from app.services.storage import SignedAsset, StorageAdapter, StorageError


class TaskServiceError(RuntimeError):
    """A safe error that can be translated into the public API error shape."""

    def __init__(self, code: str, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


_ALLOWED_CONTENT_TYPES = frozenset({"image/jpeg", "image/png"})
_VALIDATION_RESULT = {
    "face_identity": "pass",
    "pose_and_composition": "pass",
    "hands_and_costume": "pass",
    "background_geometry": "pass",
    "lighting_and_noise": "pass",
}


def _request_hash(payload: Any) -> str:
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return sha256(canonical.encode("utf-8")).hexdigest()


def _public_asset(asset: SignedAsset | AssetURL) -> AssetURL:
    return AssetURL(
        kind=asset.kind,
        url=asset.url,
        expires_at=asset.expires_at,
    )


class TaskService:
    """Orchestrate task state, persistence, storage signing, and provider jobs.

    Provider operation records live in the repository.  The service may use a
    process lock to keep its own calls tidy, but correctness never depends on
    process memory surviving a restart.
    """

    MAX_POLL_ATTEMPTS = 3

    def __init__(
        self,
        repository: TaskRepository,
        storage: StorageAdapter,
        provider: ImageModelProvider,
        settings: Settings | None = None,
        *,
        poll_delay_seconds: float | None = None,
        poll_backoff_factor: float = 1.0,
        retry_after_seconds: int | None = None,
    ) -> None:
        self.repository = repository
        self.storage = storage
        self.provider = provider
        self.settings = settings or get_settings()
        self.poll_delay_seconds = max(
            0.0,
            float(
                os.getenv("COS_PROVIDER_POLL_DELAY_SECONDS", "0")
                if poll_delay_seconds is None
                else poll_delay_seconds
            ),
        )
        self.poll_backoff_factor = max(1.0, float(poll_backoff_factor))
        self.retry_after_seconds = max(
            0,
            int(
                os.getenv("COS_PROVIDER_RETRY_AFTER_SECONDS", "1")
                if retry_after_seconds is None
                else retry_after_seconds
            ),
        )
        self._version_keys: dict[tuple[UUID, UUID], str] = {}
        self._lock = RLock()

    def create_task(
        self,
        invite_token: Any,
        filename: Any,
        content_type: Any,
        byte_size: Any,
    ) -> tuple[TaskRecord, SignedAsset]:
        self._authorize(invite_token)
        self._validate_file(filename, content_type, byte_size)

        task = TaskRecord.new()
        try:
            signed = self.storage.create_upload_url(
                task.id,
                filename,
                content_type,
                content_length=byte_size,
            )
        except StorageError as exc:
            raise TaskServiceError(
                "INVALID_FILE",
                "文件类型、文件名或文件大小无效。",
                status_code=400,
            ) from exc

        task.advance(TaskStatus.UPLOADING)
        task.original_asset_url = _public_asset(signed)
        try:
            self.repository.create_task(task)
        except Exception:
            raise
        return task, signed

    def get_task(self, task_id: UUID | str) -> TaskRecord:
        parsed_id = self._parse_task_id(task_id)
        task = self.repository.get_task(parsed_id)
        if task is None:
            raise TaskServiceError("NOT_FOUND", "任务不存在。", status_code=404)
        return task

    def authorize_request(self, invite_token: Any) -> None:
        """Authorize a non-create request before any task lookup."""

        self._authorize(invite_token)

    def analyze(self, task_id: UUID | str, idempotency_key: Any) -> TaskRecord:
        parsed_id = self._parse_task_id(task_id)
        key = self._validate_idempotency_key(idempotency_key)
        task = self.get_task(parsed_id)
        request_hash = _request_hash({"operation": "analyze"})

        with self._lock:
            if task.status is TaskStatus.AWAITING_CONFIRMATION and task.analysis:
                return task
            if task.original_asset_url is None:
                raise TaskServiceError(
                    "TASK_NOT_READY",
                    "任务尚未准备好分析。",
                    status_code=409,
                )

            try:
                existing = self.repository.get_idempotency(parsed_id, "analyze", key)
                if existing is not None:
                    self._require_same_request(existing, request_hash)
                    if existing.result_status is TaskStatus.FAILED:
                        raise self._provider_failure(None)
                    if (
                        existing.result_status is TaskStatus.AWAITING_CONFIRMATION
                        or task.status is TaskStatus.AWAITING_CONFIRMATION
                    ):
                        return self.get_task(parsed_id)
                else:
                    self._require_status(
                        task, {TaskStatus.UPLOADING, TaskStatus.FAILED}
                    )
                    if task.status is not TaskStatus.ANALYZING:
                        self._advance(task, TaskStatus.ANALYZING)
                        self._persist_task(task)
                    existing = self.repository.create_idempotency(
                        parsed_id,
                        "analyze",
                        key,
                        request_hash,
                        TaskStatus.ANALYZING,
                        provider_idempotency_key=self._provider_idempotency_key(
                            "analysis", task.original_asset_url.url
                        ),
                    )

                if existing.provider_job_id is None:
                    job = self.provider.submit_analysis(task.original_asset_url.url)
                    provider_job_id = self._provider_job_id(job)
                    existing = self.repository.update_idempotency(
                        parsed_id,
                        "analyze",
                        key,
                        request_hash=request_hash,
                        provider_job_id=provider_job_id,
                        provider_idempotency_key=(
                            existing.provider_idempotency_key
                            or self._provider_idempotency_key(
                                "analysis", task.original_asset_url.url
                            )
                        ),
                        provider_status=self._provider_status(job),
                        result_status=TaskStatus.ANALYZING,
                    )
                return self._poll_analysis(task, existing)
            except IdempotencyConflictError as exc:
                raise TaskServiceError(
                    "IDEMPOTENCY_CONFLICT",
                    "幂等键已用于不同的请求。",
                    status_code=409,
                ) from exc
            except ProviderError as exc:
                self._fail_task(task)
                self._mark_provider_failed(parsed_id, "analyze", key, request_hash)
                raise self._provider_failure(exc) from exc
            except TaskServiceError:
                raise
            except Exception as exc:
                self._fail_task(task)
                self._mark_provider_failed(parsed_id, "analyze", key, request_hash)
                raise self._provider_failure(None) from exc

    def _poll_analysis(self, task: TaskRecord, entry: IdempotencyEntry) -> TaskRecord:
        if entry.provider_job_id is None:
            return task
        for _attempt in range(self.MAX_POLL_ATTEMPTS):
            self._sleep_before_poll(_attempt)
            result = self.provider.poll(entry.provider_job_id)
            provider_status = self._result_status(result)
            entry = self.repository.update_idempotency(
                task.id,
                "analyze",
                entry.key,
                result_status=TaskStatus.ANALYZING,
                provider_status=provider_status,
            )
            if provider_status == "failed":
                self._fail_task(task)
                self.repository.update_idempotency(
                    task.id,
                    "analyze",
                    entry.key,
                    result_status=TaskStatus.FAILED,
                    provider_status="failed",
                )
                raise self._provider_failure(None)
            if provider_status != "succeeded":
                continue

            analysis = getattr(result, "analysis", None)
            if not isinstance(analysis, (list, tuple)):
                self._fail_task(task)
                self.repository.update_idempotency(
                    task.id,
                    "analyze",
                    entry.key,
                    result_status=TaskStatus.FAILED,
                    provider_status="failed",
                )
                raise self._provider_failure(None)
            self.repository.save_analysis(task.id, list(analysis))
            task.set_analysis(analysis)
            self._advance(task, TaskStatus.AWAITING_CONFIRMATION)
            task.error = None
            self._persist_task(task)
            self.repository.update_idempotency(
                task.id,
                "analyze",
                entry.key,
                result_status=TaskStatus.AWAITING_CONFIRMATION,
                provider_status="succeeded",
            )
            return task
        return self.get_task(task.id)

    def save_plan(self, task_id: UUID | str, plan: Any) -> TaskRecord:
        parsed_id = self._parse_task_id(task_id)
        if not isinstance(plan, EditPlan):
            try:
                plan = EditPlan.model_validate(plan)
            except (ValidationError, TypeError, ValueError) as exc:
                raise TaskServiceError("INVALID_PLAN", "处理计划格式无效。") from exc
        task = self.get_task(parsed_id)
        self._require_status(task, {TaskStatus.AWAITING_CONFIRMATION})
        if not any(operation.enabled for operation in plan.operations):
            raise TaskServiceError(
                "INVALID_PLAN",
                "处理计划至少需要一个已启用的操作。",
            )

        try:
            self.repository.save_plan(parsed_id, plan)
        except (ValidationError, ValueError) as exc:
            raise TaskServiceError("INVALID_PLAN", "处理计划格式无效。") from exc
        task.plan = plan
        task.error = None
        task.updated_at = utc_now()
        self._persist_task(task)
        return task

    def generate(self, task_id: UUID | str, idempotency_key: Any) -> TaskRecord:
        parsed_id = self._parse_task_id(task_id)
        key = self._validate_idempotency_key(idempotency_key)
        task = self.get_task(parsed_id)
        if task.plan is None:
            raise TaskServiceError(
                "TASK_NOT_READY",
                "请先确认修图区域和处理目标。",
                status_code=409,
            )

        plan = task.plan
        if not any(operation.enabled for operation in plan.operations):
            raise TaskServiceError(
                "INVALID_PLAN",
                "处理计划至少需要一个已启用的操作。",
            )
        request_hash = _request_hash(self._plan_hash_payload(plan))
        provider_idempotency_key = self._provider_idempotency_key(
            "edit", task.original_asset_url.url if task.original_asset_url else "", plan
        )

        with self._lock:
            failure_generation: int | None = None
            try:
                existing = self.repository.get_idempotency(parsed_id, "generate", key)
                if existing is not None:
                    self._require_same_request(existing, request_hash)
                    failure_generation = existing.reservation_generation
                    if existing.result_status is TaskStatus.FAILED:
                        raise self._provider_failure(None)
                    if (
                        existing.provider_status == "stale_reservation"
                        and existing.provider_job_id is None
                    ):
                        existing = self.repository.reacquire_generation_slot(
                            parsed_id,
                            key,
                            request_hash,
                            provider_idempotency_key,
                        )
                        task = self.get_task(parsed_id)
                        failure_generation = existing.reservation_generation
                    if existing.result_status is TaskStatus.SUCCEEDED:
                        if existing.version_id is not None:
                            return self._finalize_prepared_generation(
                                task, existing, request_hash
                            )
                        return self.get_task(parsed_id)
                else:
                    # Let an expired reservation release its slot before the
                    # different key hits the state gate. Fresh reservations
                    # remain active and continue to block a concurrent run.
                    self.repository.reclaim_stale_generation_reservations(
                        parsed_id,
                        utc_now(),
                        keep_key=key,
                        max_age_seconds=300,
                    )
                    task = self.get_task(parsed_id)
                    self._require_status(
                        task,
                        {TaskStatus.AWAITING_CONFIRMATION, TaskStatus.FAILED},
                    )
                    if task.original_asset_url is None:
                        raise TaskServiceError(
                            "TASK_NOT_READY",
                            "原图尚未准备好生成。",
                            status_code=409,
                        )
                    self._advance(task, TaskStatus.GENERATING)
                    existing = (
                        self.repository.reserve_generation_and_mark_task_generating(
                            parsed_id,
                            key,
                            request_hash,
                            provider_idempotency_key,
                        )
                    )
                    failure_generation = existing.reservation_generation

                # A prior worker may have durably prepared the version UUID
                # before crashing. Complete that record without polling or
                # allocating a second candidate.
                if existing.version_id is not None:
                    return self._finalize_prepared_generation(
                        task, existing, request_hash
                    )

                if task.status is not TaskStatus.GENERATING:
                    if task.status is TaskStatus.VALIDATING:
                        # A legacy/interrupted worker may have persisted the
                        # validating state before the idempotency update.
                        pass
                    else:
                        self._advance(task, TaskStatus.GENERATING)
                        self._persist_task(task)

                if existing.provider_job_id is None:
                    # Claim the durable reservation before the potentially
                    # long provider call.  If a reclaimer won the race, the
                    # generation check makes this worker reacquire the slot
                    # instead of submitting against a released position.
                    existing = self.repository.begin_provider_submission(
                        parsed_id,
                        key,
                        request_hash,
                        existing.reservation_generation,
                    )
                    failure_generation = existing.reservation_generation
                    if (
                        existing.provider_job_id is None
                        and existing.provider_status == "stale_reservation"
                    ):
                        existing = self.repository.reacquire_generation_slot(
                            parsed_id,
                            key,
                            request_hash,
                            provider_idempotency_key,
                        )
                        task = self.get_task(parsed_id)
                        existing = self.repository.begin_provider_submission(
                            parsed_id,
                            key,
                            request_hash,
                            existing.reservation_generation,
                        )
                        failure_generation = existing.reservation_generation
                    if (
                        existing.provider_job_id is None
                        and existing.candidate_position is None
                    ):
                        return self.get_task(parsed_id)
                if existing.provider_job_id is None:
                    job = self.provider.submit_edit(task.original_asset_url.url, plan)
                    provider_job_id = self._provider_job_id(job)
                    existing = self.repository.record_provider_submission(
                        parsed_id,
                        key,
                        request_hash,
                        existing.reservation_generation,
                        provider_job_id=provider_job_id,
                        provider_status=self._provider_status(job),
                        provider_idempotency_key=(
                            existing.provider_idempotency_key
                            or provider_idempotency_key
                        ),
                    )
                return self._poll_generation(task, existing)
            except CandidateLimitError as exc:
                raise TaskServiceError(
                    "CANDIDATE_LIMIT",
                    "一个任务最多生成两个候选版本。",
                    status_code=409,
                ) from exc
            except IdempotencyConflictError as exc:
                raise TaskServiceError(
                    "IDEMPOTENCY_CONFLICT",
                    "幂等键已用于不同的请求。",
                    status_code=409,
                ) from exc
            except ProviderError as exc:
                self._fail_task(
                    task,
                    reservation_generation=failure_generation,
                    key=key,
                    request_hash=request_hash,
                )
                self._mark_provider_failed(
                    parsed_id,
                    "generate",
                    key,
                    request_hash,
                    reservation_generation=failure_generation,
                )
                raise self._provider_failure(exc) from exc
            except TaskServiceError:
                raise
            except Exception as exc:
                self._fail_task(
                    task,
                    reservation_generation=failure_generation,
                    key=key,
                    request_hash=request_hash,
                )
                self._mark_provider_failed(
                    parsed_id,
                    "generate",
                    key,
                    request_hash,
                    reservation_generation=failure_generation,
                )
                raise self._provider_failure(None) from exc

    def _poll_generation(
        self,
        task: TaskRecord,
        entry: IdempotencyEntry,
    ) -> TaskRecord:
        # Reconcile a legacy crash window where the version row was committed
        # before the idempotency record received its recovery fields.
        if entry.version_id is None and entry.candidate_position is not None:
            stored_version = self.repository.get_version(
                task.id, position=entry.candidate_position
            )
            if stored_version is not None:
                if task.status is TaskStatus.GENERATING:
                    self._advance(task, TaskStatus.VALIDATING)
                    self._persist_task(task)
                entry = self.repository.prepare_generation_result(
                    task.id,
                    entry.key,
                    entry.request_hash,
                    stored_version.id,
                    stored_version.asset_url,
                    provider_status="succeeded",
                )
                return self._finalize_prepared_generation(
                    task, entry, entry.request_hash
                )
        if entry.version_id is not None:
            return self._finalize_prepared_generation(task, entry, entry.request_hash)
        if entry.provider_job_id is None:
            return task
        for _attempt in range(self.MAX_POLL_ATTEMPTS):
            self._sleep_before_poll(_attempt)
            result = self.provider.poll(entry.provider_job_id)
            provider_status = self._result_status(result)
            entry = self.repository.update_idempotency(
                task.id,
                "generate",
                entry.key,
                result_status=TaskStatus.GENERATING,
                provider_status=provider_status,
            )
            if provider_status == "failed":
                self._fail_task(
                    task,
                    reservation_generation=entry.reservation_generation,
                    key=entry.key,
                    request_hash=entry.request_hash,
                )
                self.repository.update_idempotency(
                    task.id,
                    "generate",
                    entry.key,
                    result_status=TaskStatus.FAILED,
                    provider_status="failed",
                    candidate_position=None,
                )
                raise self._provider_failure(None)
            if provider_status != "succeeded":
                continue

            result_asset = getattr(result, "asset_url", None)
            if result_asset is None or getattr(result_asset, "kind", None) != "version":
                self._fail_task(
                    task,
                    reservation_generation=entry.reservation_generation,
                    key=entry.key,
                    request_hash=entry.request_hash,
                )
                self.repository.update_idempotency(
                    task.id,
                    "generate",
                    entry.key,
                    result_status=TaskStatus.FAILED,
                    provider_status="failed",
                    candidate_position=None,
                )
                raise self._provider_failure(None)

            try:
                if task.status is TaskStatus.GENERATING:
                    self._advance(task, TaskStatus.VALIDATING)
                    self._persist_task(task)
                elif task.status is not TaskStatus.VALIDATING:
                    # A task already marked succeeded is reconciled below;
                    # other states cannot safely accept a provider result.
                    if task.status is TaskStatus.SUCCEEDED:
                        return self.get_task(task.id)
                    self._require_status(task, {TaskStatus.VALIDATING})
                version_id = entry.version_id or uuid4()
                entry = self.repository.prepare_generation_result(
                    task.id,
                    entry.key,
                    entry.request_hash,
                    version_id,
                    result_asset,
                    provider_status="succeeded",
                )
            except CandidateLimitError:
                self.repository.update_idempotency(
                    task.id,
                    "generate",
                    entry.key,
                    result_status=TaskStatus.FAILED,
                    provider_status="failed",
                    candidate_position=None,
                )
                raise
            return self._finalize_prepared_generation(task, entry, entry.request_hash)
        return self.get_task(task.id)

    def _finalize_prepared_generation(
        self,
        task: TaskRecord,
        entry: IdempotencyEntry,
        request_hash: str,
    ) -> TaskRecord:
        """Reconcile a prepared result through the repository atomic method."""

        result_asset = entry.result_asset_url
        if result_asset is None and entry.version_id is not None:
            recovered = self.repository.get_version(
                task.id, version_id=entry.version_id
            )
            if recovered is not None:
                result_asset = recovered.asset_url
        if entry.version_id is None or result_asset is None:
            return self.get_task(task.id)
        version = VersionRecord(
            id=entry.version_id,
            asset_url=result_asset,
            validation=dict(_VALIDATION_RESULT),
        )
        try:
            self.repository.finalize_generation(
                task.id,
                entry.key,
                request_hash,
                version,
                position=entry.candidate_position,
            )
        except CandidateLimitError:
            # If an earlier worker already wrote this exact version, use that
            # durable result; a different occupied slot remains a real limit.
            existing = self.repository.get_version(task.id, version_id=version.id)
            if existing is None:
                raise
        object_key = self._object_key_for_asset(task.id, result_asset)
        if isinstance(object_key, str):
            self._version_keys[(task.id, version.id)] = object_key
        return self.get_task(task.id)

    def download(self, task_id: UUID | str) -> AssetURL:
        parsed_id = self._parse_task_id(task_id)
        task = self.get_task(parsed_id)
        if task.status is TaskStatus.EXPIRED:
            raise TaskServiceError(
                "TASK_EXPIRED",
                "任务已过期，请重新上传图片。",
                status_code=410,
            )
        if task.status is not TaskStatus.SUCCEEDED or not task.versions:
            raise TaskServiceError(
                "TASK_NOT_READY",
                "任务尚未生成可下载的结果。",
                status_code=409,
            )

        version = task.versions[-1]
        if version.asset_url.expires_at <= datetime.now(timezone.utc):
            self._advance(task, TaskStatus.EXPIRED)
            self._persist_task(task)
            raise TaskServiceError(
                "TASK_EXPIRED",
                "任务已过期，请重新上传图片。",
                status_code=410,
            )

        object_key = self._version_keys.get((parsed_id, version.id))
        if object_key is not None:
            try:
                url = self.storage.create_download_url(object_key)
            except StorageError as exc:
                raise TaskServiceError(
                    "PROVIDER_ERROR",
                    "结果暂时不可下载，请稍后重试。",
                    status_code=502,
                ) from exc
        else:
            url = version.asset_url.url
        self._require_safe_url(url)
        return AssetURL(
            kind="version",
            url=url,
            expires_at=version.asset_url.expires_at,
        )

    def _authorize(self, invite_token: Any) -> None:
        if not isinstance(invite_token, str) or not invite_token:
            raise TaskServiceError("UNAUTHORIZED", "邀请码无效。", status_code=401)
        if not any(
            secrets.compare_digest(invite_token, expected)
            for expected in self.settings.get_invite_tokens()
        ):
            raise TaskServiceError("UNAUTHORIZED", "邀请码无效。", status_code=401)

    @staticmethod
    def _validate_file(filename: Any, content_type: Any, byte_size: Any) -> None:
        if (
            not isinstance(filename, str)
            or not filename.strip()
            or "\x00" in filename
            or not isinstance(content_type, str)
            or content_type not in _ALLOWED_CONTENT_TYPES
            or not isinstance(byte_size, int)
            or isinstance(byte_size, bool)
            or byte_size <= 0
        ):
            raise TaskServiceError("INVALID_FILE", "文件类型、文件名或文件大小无效。")

    @staticmethod
    def _validate_idempotency_key(value: Any) -> str:
        if not isinstance(value, str):
            raise TaskServiceError(
                "INVALID_IDEMPOTENCY_KEY",
                "缺少有效的幂等键。",
            )
        key = value.strip()
        if not 1 <= len(key) <= 128:
            raise TaskServiceError(
                "INVALID_IDEMPOTENCY_KEY",
                "缺少有效的幂等键。",
            )
        return key

    @staticmethod
    def _parse_task_id(value: UUID | str) -> UUID:
        if isinstance(value, UUID):
            return value
        try:
            return UUID(str(value))
        except (ValueError, TypeError, AttributeError) as exc:
            raise TaskServiceError(
                "NOT_FOUND", "任务不存在。", status_code=404
            ) from exc

    @staticmethod
    def _plan_hash_payload(plan: EditPlan) -> dict[str, Any]:
        payload = plan.model_dump(mode="json")
        for operation in payload.get("operations", ()):
            operation.pop("id", None)
        return payload

    @staticmethod
    def _provider_job_id(job: Any) -> str:
        value = getattr(job, "job_id", getattr(job, "id", None))
        if not isinstance(value, str) or not value:
            raise ProviderError(
                "provider returned an invalid job",
                code="INVALID_PROVIDER_RESPONSE",
                retryable=True,
            )
        return value

    @staticmethod
    def _require_same_request(existing: IdempotencyEntry, request_hash: str) -> None:
        if existing.request_hash != request_hash:
            raise TaskServiceError(
                "IDEMPOTENCY_CONFLICT",
                "幂等键已用于不同的请求。",
                status_code=409,
            )

    @staticmethod
    def _provider_status(value: Any) -> str:
        status = getattr(value, "status", None)
        return (
            status
            if status in {"queued", "running", "succeeded", "failed"}
            else "queued"
        )

    @classmethod
    def _result_status(cls, value: Any) -> str:
        return cls._provider_status(value)

    def _sleep_before_poll(self, attempt: int) -> None:
        if attempt <= 0 or self.poll_delay_seconds <= 0:
            return
        delay = self.poll_delay_seconds * (self.poll_backoff_factor ** (attempt - 1))
        time.sleep(delay)

    @staticmethod
    def _provider_idempotency_key(
        operation: str,
        source_url: str,
        plan: EditPlan | None = None,
    ) -> str:
        """Match the provider adapter's stable canonical operation identity."""

        source = source_url.strip()
        parsed = urlsplit(source)
        if parsed.scheme and parsed.netloc:
            source = urlunsplit(
                (parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, "", "")
            )
        else:
            source = source.split("?", 1)[0].split("#", 1)[0]
        material: dict[str, Any] = {"operation": operation, "source": source}
        if plan is not None:
            plan_payload = plan.model_dump(mode="json")
            for operation_payload in plan_payload.get("operations", ()):
                operation_payload.pop("id", None)
            material["plan"] = plan_payload
        return _request_hash(material)

    def _mark_provider_failed(
        self,
        task_id: UUID,
        operation: str,
        key: str,
        request_hash: str,
        *,
        reservation_generation: int | None = None,
    ) -> None:
        """Best-effort durable failure marker that never leaks provider data."""

        try:
            if reservation_generation is not None and operation == "generate":
                self.repository.fail_generation_if_current(
                    task_id,
                    key,
                    request_hash,
                    reservation_generation,
                    TaskError(
                        code="PROVIDER_ERROR",
                        message="图像服务暂时不可用，请稍后重试。",
                        retryable=True,
                    ),
                )
                return
            entry = self.repository.get_idempotency(task_id, operation, key)
            if entry is None:
                return
            update_kwargs: dict[str, Any] = {
                "request_hash": request_hash,
                "result_status": TaskStatus.FAILED,
                "provider_status": "failed",
            }
            if operation == "generate":
                update_kwargs["candidate_position"] = None
            self.repository.update_idempotency(
                task_id,
                operation,
                key,
                **update_kwargs,
            )
        except Exception:
            # The public error remains the same safe provider error even if a
            # secondary persistence failure occurs while handling an outage.
            return

    @staticmethod
    def _require_status(task: TaskRecord, allowed: set[TaskStatus]) -> None:
        if task.status not in allowed:
            raise TaskServiceError(
                "TASK_NOT_READY",
                "任务当前状态不允许执行此操作。",
                status_code=409,
            )

    @staticmethod
    def _advance(task: TaskRecord, next_status: TaskStatus) -> None:
        try:
            task.advance(next_status)
        except InvalidTransition as exc:
            raise TaskServiceError(
                "TASK_NOT_READY",
                "任务当前状态不允许执行此操作。",
                status_code=409,
            ) from exc

    def _fail_task(
        self,
        task: TaskRecord,
        *,
        reservation_generation: int | None = None,
        key: str | None = None,
        request_hash: str | None = None,
    ) -> bool:
        if reservation_generation is not None:
            if key is None or request_hash is None:
                return False
            return self.repository.fail_generation_if_current(
                task.id,
                key,
                request_hash,
                reservation_generation,
                TaskError(
                    code="PROVIDER_ERROR",
                    message="图像服务暂时不可用，请稍后重试。",
                    retryable=True,
                ),
            )

        # A worker can hold a stale aggregate after another worker has
        # already succeeded. Refresh before mutating so a provider exception
        # cannot attach an error to that newer result.
        session = getattr(self.repository, "session", None)
        if session is not None:
            session.expire_all()
        current = self.repository.get_task(task.id)
        if current is None or current.status in {
            TaskStatus.SUCCEEDED,
            TaskStatus.EXPIRED,
        }:
            return False
        task = current
        if task.status is not TaskStatus.FAILED:
            try:
                task.advance(TaskStatus.FAILED)
            except InvalidTransition:
                return False
        task.error = TaskError(
            code="PROVIDER_ERROR",
            message="图像服务暂时不可用，请稍后重试。",
            retryable=True,
        )
        self._persist_task(task)
        return True

    @staticmethod
    def _provider_failure(cause: ProviderError | None) -> TaskServiceError:
        return TaskServiceError(
            "PROVIDER_ERROR",
            "图像服务暂时不可用，请稍后重试。",
            status_code=502,
        )

    @staticmethod
    def _require_safe_url(url: Any) -> None:
        if not isinstance(url, str):
            raise TaskServiceError(
                "PROVIDER_ERROR",
                "结果暂时不可下载，请稍后重试。",
                status_code=502,
            )
        try:
            parsed = urlsplit(url)
        except ValueError as exc:
            raise TaskServiceError(
                "PROVIDER_ERROR",
                "结果暂时不可下载，请稍后重试。",
                status_code=502,
            ) from exc
        if (
            parsed.scheme.lower() not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or any(character.isspace() for character in url)
        ):
            raise TaskServiceError(
                "PROVIDER_ERROR",
                "结果暂时不可下载，请稍后重试。",
                status_code=502,
            )

    @staticmethod
    def _object_key_for_asset(task_id: UUID, asset: Any) -> str | None:
        object_key = getattr(asset, "object_key", None)
        if isinstance(object_key, str) and object_key:
            return object_key
        url = getattr(asset, "url", None)
        if not isinstance(url, str):
            return None
        try:
            parts = urlsplit(url).path.lstrip("/").split("/")
        except ValueError:
            return None
        if (
            len(parts) == 4
            and parts[0] == "tasks"
            and parts[1] == str(task_id)
            and parts[2] == "versions"
            and parts[3].endswith(".png")
            and all(parts)
        ):
            return "/".join(parts)
        return None

    def _persist_task(self, task: TaskRecord) -> None:
        session = getattr(self.repository, "session", None)
        if session is not None:
            row = session.get(TaskRow, task.id)
            if row is None:
                raise TaskServiceError("NOT_FOUND", "任务不存在。", status_code=404)
            row.status = task.status.value
            row.updated_at = task.updated_at
            row.original_asset_url = (
                task.original_asset_url.model_dump(mode="json")
                if task.original_asset_url is not None
                else None
            )
            row.mask_asset_url = (
                task.mask_asset_url.model_dump(mode="json")
                if task.mask_asset_url is not None
                else None
            )
            row.error = task.error.model_dump(mode="json") if task.error else None
            try:
                session.commit()
            except Exception:
                session.rollback()
                raise
            return

        save_task = getattr(self.repository, "save_task", None)
        if callable(save_task):
            save_task(task)


__all__ = ["TaskService", "TaskServiceError"]
