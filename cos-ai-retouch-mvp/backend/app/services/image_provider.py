"""Server-side image-provider adapters and normalized provider results."""

from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from threading import RLock
from typing import Any, Literal, Protocol
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import Request, urlopen

try:
    import httpx
except ImportError:  # pragma: no cover - exercised only in minimal production installs
    httpx = None

from pydantic import BaseModel, ConfigDict, Field

from app.config import Settings, get_settings
from app.domain.models import AnalysisCard, AssetURL, EditPlan, Region


ProviderStatus = Literal["queued", "running", "succeeded", "failed"]
ProviderOperation = Literal["analysis", "edit"]


class ProviderError(RuntimeError):
    """A typed, safe provider error that never contains upstream response data."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "PROVIDER_ERROR",
        retryable: bool = True,
        status_code: int | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.status_code = status_code


class ProviderJob(BaseModel):
    """Normalized provider job metadata returned from a submission."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    job_id: str = Field(min_length=1)
    operation: ProviderOperation
    status: ProviderStatus = "queued"

    @property
    def id(self) -> str:
        return self.job_id


class ProviderResult(BaseModel):
    """Normalized provider output for polling and task-service persistence."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    job_id: str = Field(min_length=1)
    status: ProviderStatus
    analysis: tuple[AnalysisCard, ...] = Field(default_factory=tuple)
    asset_url: AssetURL | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @property
    def analysis_cards(self) -> tuple[AnalysisCard, ...]:
        return self.analysis

    @property
    def asset(self) -> AssetURL | None:
        return self.asset_url


class ImageModelProvider(Protocol):
    """Provider boundary consumed by the task service."""

    def submit_analysis(self, source_url: str) -> ProviderJob: ...

    def submit_edit(self, source_url: str, plan: EditPlan) -> ProviderJob: ...

    def poll(self, job_id: str) -> ProviderResult: ...

    def download_result(self, asset_url: AssetURL) -> tuple[bytes, str]: ...


_MOCK_ANALYSIS_FIXTURE = (
    AnalysisCard(
        id="card-face-1",
        category="face",
        title="Face detail",
        summary="Minor skin detail near the cheek.",
        confidence=0.92,
        risk="Keep face identity unchanged.",
        enabled=False,
        regions=(
            Region(
                id="face-1",
                label="face",
                x=0.25,
                y=0.20,
                width=0.30,
                height=0.40,
            ),
        ),
    ),
)


def _source_identity(source_url: str) -> str:
    if not isinstance(source_url, str) or not source_url.strip():
        raise ProviderError(
            "source URL is required",
            code="INVALID_SOURCE",
            retryable=False,
        )
    source_url = source_url.strip()
    parsed = urlsplit(source_url)
    if parsed.scheme and parsed.netloc:
        return urlunsplit(
            (
                parsed.scheme.lower(),
                parsed.netloc.lower(),
                parsed.path,
                "",
                "",
            )
        )
    return source_url.split("?", 1)[0].split("#", 1)[0]


def _operation_key(
    operation: ProviderOperation,
    source_url: str,
    plan: EditPlan | None = None,
) -> str:
    material: dict[str, Any] = {
        "operation": operation,
        "source": _source_identity(source_url),
    }
    if plan is not None:
        plan_payload = plan.model_dump(mode="json")
        for operation_payload in plan_payload.get("operations", ()):
            operation_payload.pop("id", None)
        material["plan"] = plan_payload
    canonical = json.dumps(
        material, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return sha256(canonical.encode("utf-8")).hexdigest()


def _expires_at(settings: Settings) -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=settings.asset_ttl_hours)


def _normalize_status(value: Any) -> ProviderStatus:
    normalized = str(value or "queued").lower()
    aliases: dict[str, ProviderStatus] = {
        "pending": "queued",
        "processing": "running",
        "complete": "succeeded",
        "completed": "succeeded",
        "success": "succeeded",
        "error": "failed",
        "failure": "failed",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized not in {"queued", "running", "succeeded", "failed"}:
        return "queued"
    return normalized  # type: ignore[return-value]


def _safe_metadata(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    allowed_keys = {
        "provider",
        "model",
        "label",
        "demo",
        "provider_request_id",
        "request_id",
    }
    safe: dict[str, Any] = {}
    for key, item in value.items():
        if key in allowed_keys and isinstance(item, (bool, int, float, str)):
            safe[key] = item
    return safe


class MockImageModelProvider:
    """Deterministic provider used by local development and browser tests."""

    analysis_fixture = _MOCK_ANALYSIS_FIXTURE
    result_fixture = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000d49444154789c6360000000020001e221bc330000000049454e44ae426082"
    )

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self.jobs: dict[str, ProviderJob] = {}
        self._results: dict[str, ProviderResult] = {}
        self._operation_jobs: dict[str, str] = {}
        self._submission_lock = RLock()

    def _submit(
        self,
        operation: ProviderOperation,
        source_url: str,
        plan: EditPlan | None = None,
    ) -> ProviderJob:
        with self._submission_lock:
            operation_key = _operation_key(operation, source_url, plan)
            existing_job_id = self._operation_jobs.get(operation_key)
            if existing_job_id is not None:
                return self.jobs[existing_job_id]

            job_id = f"mock-{operation}-{operation_key[:16]}"
            job = ProviderJob(job_id=job_id, operation=operation, status="queued")
            if operation == "analysis":
                result = ProviderResult(
                    job_id=job_id,
                    status="succeeded",
                    analysis=self.analysis_fixture,
                    metadata={
                        "provider": "mock",
                        "model": "demo",
                        "demo": True,
                    },
                )
            else:
                marker = quote("演示模型结果", safe="")
                result_url = (
                    f"https://mock.image-provider.local/results/{job_id}.png"
                    f"?provider=mock&demo=true&label={marker}"
                )
                result = ProviderResult(
                    job_id=job_id,
                    status="succeeded",
                    asset_url=AssetURL(
                        kind="version",
                        url=result_url,
                        expires_at=_expires_at(self.settings),
                    ),
                    metadata={
                        "provider": "mock",
                        "model": "demo",
                        "demo": True,
                        "label": "演示模型结果",
                    },
                )
            self.jobs[job_id] = job
            self._results[job_id] = result
            self._operation_jobs[operation_key] = job_id
            return job

    def submit_analysis(self, source_url: str) -> ProviderJob:
        return self._submit("analysis", source_url)

    def submit_edit(self, source_url: str, plan: EditPlan) -> ProviderJob:
        if not isinstance(plan, EditPlan):
            raise ProviderError(
                "edit plan must be structured",
                code="INVALID_EDIT_PLAN",
                retryable=False,
            )
        return self._submit("edit", source_url, plan)

    def poll(self, job_id: str) -> ProviderResult:
        result = self._results.get(job_id)
        if result is None:
            raise ProviderError(
                "provider job was not found",
                code="JOB_NOT_FOUND",
                retryable=False,
            )
        return result

    def download_result(self, asset_url: AssetURL) -> tuple[bytes, str]:
        """Return deterministic local bytes; no mock URL is exposed to clients."""

        if asset_url.kind != "version":
            raise ProviderError(
                "provider result is not a version asset",
                code="INVALID_PROVIDER_RESPONSE",
                retryable=True,
            )
        return self.result_fixture, "image/png"


class _UrllibResponse:
    def __init__(self, status_code: int, body: bytes | None):
        self.status_code = status_code
        self._body = body

    def json(self) -> Any:
        if self._body is None:
            raise ValueError("response body is empty")
        return json.loads(self._body.decode("utf-8"))


class ExternalImageModelProvider:
    """HTTP adapter for a server-side image provider."""

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        http_client: Any = None,
        transport: Any = None,
    ):
        self.settings = settings or get_settings()
        self.http_client = http_client
        self._owns_http_client = False
        if self.http_client is None and transport is not None:
            if httpx is None:
                raise ProviderError(
                    "HTTP transport is unavailable",
                    code="PROVIDER_CONFIGURATION_ERROR",
                    retryable=False,
                )
            self.http_client = httpx.Client(transport=transport)
            self._owns_http_client = True
        self._jobs: dict[str, ProviderJob] = {}
        self._operation_jobs: dict[str, str] = {}
        self._submission_lock = RLock()

    def close(self) -> None:
        if self.http_client is not None:
            close = getattr(self.http_client, "close", None)
            if close is not None:
                close()
            self.http_client = None

    def __enter__(self) -> "ExternalImageModelProvider":
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> bool:
        self.close()
        return False

    def _configuration(self) -> tuple[str, str]:
        base_url = (self.settings.image_provider_base_url or "").strip().rstrip("/")
        api_key = self.settings.get_image_provider_api_key()
        if not base_url or not api_key:
            raise ProviderError(
                "external image provider is not configured",
                code="PROVIDER_CONFIGURATION_ERROR",
                retryable=False,
            )
        return base_url, api_key

    def _request(
        self,
        method: str,
        endpoint: str,
        *,
        api_key: str,
        payload: dict[str, Any] | None = None,
        operation_key: str | None = None,
        unwrap_data: bool = True,
    ) -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {api_key}",
        }
        if operation_key is not None:
            headers["Idempotency-Key"] = f"cos-retouch-{operation_key}"
        try:
            if self.http_client is not None:
                response = self.http_client.request(
                    method,
                    endpoint,
                    headers=headers,
                    json=payload,
                )
            else:
                response = self._urllib_request(
                    method,
                    endpoint,
                    headers=headers,
                    payload=payload,
                )
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(
                "image provider is unavailable",
                code="UPSTREAM_UNAVAILABLE",
                retryable=True,
            ) from exc

        status_code = getattr(response, "status_code", None)
        if not isinstance(status_code, int):
            raise ProviderError(
                "image provider returned an invalid response",
                code="INVALID_PROVIDER_RESPONSE",
                retryable=True,
            )
        if not 200 <= status_code < 300:
            raise ProviderError(
                "image provider request failed",
                code="UPSTREAM_ERROR",
                retryable=status_code == 429 or status_code >= 500,
                status_code=status_code,
            )
        try:
            data = response.json()
        except Exception as exc:
            raise ProviderError(
                "image provider returned invalid JSON",
                code="INVALID_PROVIDER_RESPONSE",
                retryable=True,
            ) from exc
        if not isinstance(data, dict):
            raise ProviderError(
                "image provider returned an invalid response",
                code="INVALID_PROVIDER_RESPONSE",
                retryable=True,
            )
        nested = data.get("data")
        if unwrap_data and isinstance(nested, dict):
            return nested
        return data

    @staticmethod
    def _urllib_request(
        method: str,
        endpoint: str,
        *,
        headers: dict[str, str],
        payload: dict[str, Any] | None,
    ) -> _UrllibResponse:
        body = None
        request_headers = dict(headers)
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        request = Request(
            endpoint,
            data=body,
            headers=request_headers,
            method=method,
        )
        try:
            with urlopen(request, timeout=30) as response:  # noqa: S310 - configured server URL
                raw = response.read()
                return _UrllibResponse(response.status, raw)
        except HTTPError as exc:
            return _UrllibResponse(exc.code, None)

    def _submit(
        self,
        operation: ProviderOperation,
        source_url: str,
        plan: EditPlan | None = None,
    ) -> ProviderJob:
        with self._submission_lock:
            base_url, api_key = self._configuration()
            operation_key = _operation_key(operation, source_url, plan)
            existing_job_id = self._operation_jobs.get(operation_key)
            if existing_job_id is not None:
                return self._jobs[existing_job_id]

            payload: dict[str, Any] = {
                "model": self.settings.image_provider_model,
                "source_url": source_url,
            }
            if plan is not None:
                payload["plan"] = plan.model_dump(mode="json")
            endpoint = f"{base_url}/{operation}"
            data = self._request(
                "POST",
                endpoint,
                api_key=api_key,
                payload=payload,
                operation_key=operation_key,
            )
            raw_job_id = data.get("job_id", data.get("id"))
            if not isinstance(raw_job_id, str) or not raw_job_id.strip():
                raise ProviderError(
                    "image provider returned an invalid job",
                    code="INVALID_PROVIDER_RESPONSE",
                    retryable=True,
                )
            job = ProviderJob(
                job_id=raw_job_id,
                operation=operation,
                status=_normalize_status(data.get("status")),
            )
            self._jobs[raw_job_id] = job
            self._operation_jobs[operation_key] = raw_job_id
            return job

    def submit_analysis(self, source_url: str) -> ProviderJob:
        return self._submit("analysis", source_url)

    def submit_edit(self, source_url: str, plan: EditPlan) -> ProviderJob:
        if not isinstance(plan, EditPlan):
            raise ProviderError(
                "edit plan must be structured",
                code="INVALID_EDIT_PLAN",
                retryable=False,
            )
        return self._submit("edit", source_url, plan)

    def _asset_from_payload(self, value: Any) -> AssetURL | None:
        if value is None:
            return None
        if isinstance(value, str):
            asset_url = value
            kind = "version"
        elif isinstance(value, dict):
            asset = dict(value)
            asset_url = asset.get("url")
            kind = asset.get("kind", "version")
        else:
            raise ValueError("invalid asset payload")
        if not isinstance(asset_url, str) or not asset_url:
            raise ValueError("empty asset URL")
        try:
            parsed = urlsplit(asset_url)
            hostname = parsed.hostname
        except ValueError as exc:
            raise ValueError("invalid asset URL") from exc
        if (
            parsed.scheme.lower() not in {"http", "https"}
            or not hostname
            or parsed.username is not None
            or parsed.password is not None
            or any(character.isspace() for character in asset_url)
        ):
            raise ValueError("asset URL must be a credential-free HTTP URL")
        return AssetURL(
            kind=kind,
            url=asset_url,
            expires_at=_expires_at(self.settings),
        )

    def poll(self, job_id: str) -> ProviderResult:
        if not isinstance(job_id, str) or not job_id:
            raise ProviderError(
                "provider job was not found",
                code="JOB_NOT_FOUND",
                retryable=False,
            )
        base_url, api_key = self._configuration()
        endpoint = f"{base_url}/jobs/{quote(job_id, safe='')}"
        data = self._request("GET", endpoint, api_key=api_key)
        try:
            raw_analysis = data.get("analysis", data.get("analysis_cards", ()))
            if raw_analysis is None:
                raw_analysis = ()
            if not isinstance(raw_analysis, (list, tuple)):
                raise ValueError("invalid analysis payload")
            analysis = tuple(AnalysisCard.model_validate(card) for card in raw_analysis)
            asset_url = self._asset_from_payload(
                data.get("asset_url", data.get("asset"))
            )
        except Exception as exc:
            raise ProviderError(
                "image provider returned an invalid result",
                code="INVALID_PROVIDER_RESPONSE",
                retryable=True,
            ) from exc
        return ProviderResult(
            job_id=job_id,
            status=_normalize_status(data.get("status")),
            analysis=analysis,
            asset_url=asset_url,
            metadata=_safe_metadata(
                data.get("metadata", data.get("provider_metadata"))
            ),
        )

    def download_result(self, asset_url: AssetURL) -> tuple[bytes, str]:
        """Fetch provider bytes server-side so the provider URL stays private."""

        if asset_url.kind != "version":
            raise ProviderError(
                "provider result is not a version asset",
                code="INVALID_PROVIDER_RESPONSE",
                retryable=True,
            )
        try:
            parsed = urlsplit(asset_url.url)
            hostname = parsed.hostname
        except ValueError as exc:
            raise ProviderError(
                "image provider returned an invalid result URL",
                code="INVALID_PROVIDER_RESPONSE",
                retryable=True,
            ) from exc
        if (
            parsed.scheme.lower() not in {"http", "https"}
            or not hostname
            or parsed.username is not None
            or parsed.password is not None
            or any(character.isspace() for character in asset_url.url)
        ):
            raise ProviderError(
                "image provider returned an invalid result URL",
                code="INVALID_PROVIDER_RESPONSE",
                retryable=True,
            )

        try:
            if self.http_client is not None:
                response = self.http_client.request(
                    "GET",
                    asset_url.url,
                    headers={"Accept": "image/png,image/*"},
                )
                status_code = getattr(response, "status_code", None)
                body = getattr(response, "content", None)
                headers = getattr(response, "headers", {})
                content_type = headers.get("content-type", "image/png")
            else:
                request = Request(
                    asset_url.url,
                    headers={"Accept": "image/png,image/*"},
                    method="GET",
                )
                with urlopen(request, timeout=30) as response:  # noqa: S310 - provider URL
                    status_code = response.status
                    body = response.read(self.settings.max_upload_bytes + 1)
                    content_type = response.headers.get_content_type() or "image/png"
        except Exception as exc:
            raise ProviderError(
                "image provider result is unavailable",
                code="UPSTREAM_UNAVAILABLE",
                retryable=True,
            ) from exc

        if not isinstance(status_code, int) or not 200 <= status_code < 300:
            raise ProviderError(
                "image provider result is unavailable",
                code="UPSTREAM_ERROR",
                retryable=isinstance(status_code, int) and status_code >= 500,
                status_code=status_code if isinstance(status_code, int) else None,
            )
        if (
            not isinstance(body, bytes)
            or not body
            or len(body) > self.settings.max_upload_bytes
        ):
            raise ProviderError(
                "image provider returned an invalid result body",
                code="INVALID_PROVIDER_RESPONSE",
                retryable=True,
            )
        normalized_content_type = (
            content_type.split(";", 1)[0].strip().lower()
            if isinstance(content_type, str)
            else ""
        )
        if normalized_content_type not in {"image/png", "image/jpeg"}:
            raise ProviderError(
                "image provider returned an unsupported image",
                code="INVALID_PROVIDER_RESPONSE",
                retryable=True,
            )
        return body, normalized_content_type


_MINIMAX_OPERATION_LABELS = {
    "skin_retouch": "refine small skin blemishes and uneven texture while preserving real pores and makeup",
    "hair_detail": "clean stray hairs and wig edges while preserving the hairstyle and hairline",
    "clothing_repair": "repair small costume wrinkles, threads, and material inconsistencies while preserving costume design",
    "body_pose_repair": "make only subtle local proportion or connection corrections without changing the main pose",
    "background_cleanup": "remove small distracting objects or cosplay-shooting artifacts while preserving background geometry",
    "light_balance": "make a gentle local light and color balance while preserving the original light direction and atmosphere",
}


def _minimax_prompt(plan: EditPlan) -> str:
    """Translate the confirmed structured plan into a bounded edit prompt."""

    requested: list[str] = []
    for operation in plan.operations:
        if not operation.enabled:
            continue
        instruction = (operation.instructions or "").strip()
        label = _MINIMAX_OPERATION_LABELS.get(
            operation.kind,
            "make a restrained local retouch based on the selected area",
        )
        if instruction:
            label = f"{label}; user note: {instruction}"
        requested.append(f"- {label} (intensity {operation.intensity}/100)")
    if not requested:
        requested.append("- make a restrained natural retouch only")

    preserve = ", ".join(plan.preserve)
    notes = f" Additional user notes: {plan.notes.strip()}" if plan.notes else ""
    prompt = (
        "Edit this original COS cosplay photograph as a professional retouching assistant. "
        "Use the original image as the composition and identity reference. Apply only the selected, "
        "localized improvements below; do not redesign the character or create a new scene.\n"
        "Requested improvements:\n"
        f"{chr(10).join(requested)}\n"
        f"Preserve exactly: {preserve}."
        " Keep the same person, face identity, costume design, pose, framing, perspective, background structure, "
        "light direction, depth of field, and natural photographic noise. No face swap, no beauty-filter plastic skin, "
        "no extra fingers, no changed accessories, no watermark, no text, no global recolor, no global relighting."
        f"{notes}"
    )
    return prompt[:1500]


def _image_content_type(body: bytes) -> str:
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    raise ProviderError(
        "image provider returned an unsupported image",
        code="INVALID_PROVIDER_RESPONSE",
        retryable=True,
    )


class MiniMaxImageModelProvider(ExternalImageModelProvider):
    """MiniMax image-to-image adapter using one server-side reference image.

    MiniMax returns generated images in the create response.  The adapter keeps
    base64 bytes in memory and exposes only a short-lived internal asset handle
    to the task service, so the API key and provider response never reach the
    browser.
    """

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        http_client: Any = None,
        transport: Any = None,
    ):
        super().__init__(settings, http_client=http_client, transport=transport)
        self._results: dict[str, ProviderResult] = {}
        self._image_bodies: dict[str, tuple[bytes, str]] = {}

    def submit_analysis(self, source_url: str) -> ProviderJob:
        """Return the safe retouch menu until a vision endpoint is available.

        MiniMax's public image API is generation/reference-image based; it does
        not expose image understanding in this endpoint.  The UI therefore gets
        a conservative menu and the actual confirmed edit goes through MiniMax.
        """

        with self._submission_lock:
            operation_key = _operation_key("analysis", source_url)
            existing_job_id = self._operation_jobs.get(operation_key)
            if existing_job_id is not None:
                return self._jobs[existing_job_id]
            job_id = f"minimax-analysis-{operation_key[:16]}"
            job = ProviderJob(job_id=job_id, operation="analysis", status="succeeded")
            self._jobs[job_id] = job
            self._results[job_id] = ProviderResult(
                job_id=job_id,
                status="succeeded",
                analysis=_MOCK_ANALYSIS_FIXTURE,
                metadata={
                    "provider": "local",
                    "model": "cos-retouch-menu-v1",
                    "demo": False,
                },
            )
            self._operation_jobs[operation_key] = job_id
            return job

    def submit_edit(self, source_url: str, plan: EditPlan) -> ProviderJob:
        if not isinstance(plan, EditPlan):
            raise ProviderError(
                "edit plan must be structured",
                code="INVALID_EDIT_PLAN",
                retryable=False,
            )
        with self._submission_lock:
            base_url, api_key = self._configuration()
            operation_key = _operation_key("edit", source_url, plan)
            existing_job_id = self._operation_jobs.get(operation_key)
            if existing_job_id is not None:
                return self._jobs[existing_job_id]

            # Keep the request to the documented, broadly compatible core
            # fields.  Optional switches differ between MiniMax image model
            # revisions; the API defaults to URL output, which we download
            # server-side below and then store in the task asset bridge.
            payload: dict[str, Any] = {
                "model": self.settings.image_provider_model,
                "prompt": _minimax_prompt(plan),
                "subject_reference": [
                    {"type": "character", "image_file": source_url}
                ],
                "n": 1,
            }
            aspect_ratio = getattr(self.settings, "image_provider_aspect_ratio", None)
            if aspect_ratio:
                payload["aspect_ratio"] = aspect_ratio
            data = self._request(
                "POST",
                f"{base_url}/image_generation",
                api_key=api_key,
                payload=payload,
                operation_key=operation_key,
                unwrap_data=False,
            )
            base_response = data.get("base_resp")
            if isinstance(base_response, dict) and str(
                base_response.get("status_code", "0")
            ) not in {"0", "None"}:
                raise ProviderError(
                    "image provider rejected the generation request",
                    code="UPSTREAM_ERROR",
                    retryable=False,
                )
            raw_job_id = data.get("id")
            if not isinstance(raw_job_id, str) or not raw_job_id.strip():
                raise ProviderError(
                    "image provider returned an invalid job",
                    code="INVALID_PROVIDER_RESPONSE",
                    retryable=True,
                )
            response_data = data.get("data")
            if not isinstance(response_data, dict):
                raise ProviderError(
                    "image provider returned an invalid result",
                    code="INVALID_PROVIDER_RESPONSE",
                    retryable=True,
                )

            asset_url: AssetURL | None = None
            encoded_images = response_data.get("image_base64")
            if isinstance(encoded_images, list) and encoded_images:
                encoded = encoded_images[0]
                if not isinstance(encoded, str) or not encoded:
                    raise ProviderError(
                        "image provider returned an invalid image",
                        code="INVALID_PROVIDER_RESPONSE",
                        retryable=True,
                    )
                try:
                    body = base64.b64decode(encoded, validate=True)
                    content_type = _image_content_type(body)
                except ProviderError:
                    raise
                except Exception as exc:
                    raise ProviderError(
                        "image provider returned an invalid image",
                        code="INVALID_PROVIDER_RESPONSE",
                        retryable=True,
                    ) from exc
                if not body or len(body) > self.settings.max_upload_bytes:
                    raise ProviderError(
                        "image provider returned an invalid image",
                        code="INVALID_PROVIDER_RESPONSE",
                        retryable=True,
                    )
                asset_url = AssetURL(
                    kind="version",
                    url=f"https://minimax.local/results/{quote(raw_job_id, safe='')}.img",
                    expires_at=_expires_at(self.settings),
                )
                self._image_bodies[asset_url.url] = (body, content_type)
            else:
                image_urls = response_data.get("image_urls")
                if isinstance(image_urls, list) and image_urls:
                    asset_url = self._asset_from_payload(image_urls[0])

            if asset_url is None:
                raise ProviderError(
                    "image provider returned no generated image",
                    code="INVALID_PROVIDER_RESPONSE",
                    retryable=True,
                )
            job = ProviderJob(
                job_id=raw_job_id,
                operation="edit",
                status="succeeded",
            )
            result = ProviderResult(
                job_id=raw_job_id,
                status="succeeded",
                asset_url=asset_url,
                metadata={
                    "provider": "minimax",
                    "model": self.settings.image_provider_model,
                    "demo": False,
                    "provider_request_id": raw_job_id,
                },
            )
            self._jobs[raw_job_id] = job
            self._results[raw_job_id] = result
            self._operation_jobs[operation_key] = raw_job_id
            return job

    def poll(self, job_id: str) -> ProviderResult:
        result = self._results.get(job_id)
        if result is None:
            raise ProviderError(
                "provider job was not found",
                code="JOB_NOT_FOUND",
                retryable=False,
            )
        return result

    def download_result(self, asset_url: AssetURL) -> tuple[bytes, str]:
        local_result = self._image_bodies.get(asset_url.url)
        if local_result is not None:
            return local_result
        return super().download_result(asset_url)


ImageProvider = ImageModelProvider


def create_image_provider(
    settings: Settings | None = None,
    *,
    http_client: Any = None,
    transport: Any = None,
) -> ImageModelProvider:
    """Build the configured provider without exposing credentials to callers."""

    resolved = settings or get_settings()
    if resolved.image_provider_mode == "mock":
        return MockImageModelProvider(resolved)
    if resolved.image_provider_mode == "minimax":
        return MiniMaxImageModelProvider(
            resolved,
            http_client=http_client,
            transport=transport,
        )
    return ExternalImageModelProvider(
        resolved,
        http_client=http_client,
        transport=transport,
    )


__all__ = [
    "ExternalImageModelProvider",
    "ImageModelProvider",
    "ImageProvider",
    "MiniMaxImageModelProvider",
    "MockImageModelProvider",
    "ProviderError",
    "ProviderJob",
    "ProviderResult",
    "create_image_provider",
]
