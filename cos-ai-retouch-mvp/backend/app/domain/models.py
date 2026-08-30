"""Pydantic domain models for the COS AI retouch workflow."""

from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Any, Literal
from uuid import UUID, uuid4

from pydantic import (
    AfterValidator,
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _require_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("datetime must be timezone-aware UTC")
    if value.utcoffset().total_seconds() != 0:
        raise ValueError("datetime must be timezone-aware UTC")
    return value


UTCDateTime = Annotated[datetime, AfterValidator(_require_utc)]


class TaskStatus(str, Enum):
    CREATED = "created"
    UPLOADING = "uploading"
    ANALYZING = "analyzing"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    GENERATING = "generating"
    VALIDATING = "validating"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    EXPIRED = "expired"


class Goal(str, Enum):
    NATURAL_RETOUCH = "natural_retouch"
    STRUCTURE_REPAIR = "structure_repair"


class AssetURL(BaseModel):
    """A short-lived URL for an original, mask, or generated asset."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["original", "mask", "version"]
    url: str = Field(min_length=1)
    expires_at: UTCDateTime


class TaskError(BaseModel):
    """A safe, user-facing task error without provider internals."""

    model_config = ConfigDict(extra="forbid")

    code: str = Field(
        min_length=1,
        max_length=64,
        pattern=r"^[A-Z][A-Z0-9_]*$",
    )
    message: str = Field(min_length=1, max_length=500)
    retryable: bool


class IdempotencyRecord(BaseModel):
    """A retry record scoped to one task operation."""

    model_config = ConfigDict(extra="forbid")

    task_id: UUID
    operation: Literal["analyze", "generate"]
    key: str = Field(min_length=1, max_length=128)
    request_hash: str = Field(min_length=1)
    result_status: TaskStatus
    created_at: UTCDateTime = Field(default_factory=_utc_now)


class Region(BaseModel):
    """A normalized rectangular region selected for analysis or editing."""

    model_config = ConfigDict(validate_assignment=True)

    id: str
    label: str
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    width: float = Field(ge=0.0, le=1.0)
    height: float = Field(ge=0.0, le=1.0)
    source: str = "analysis"
    mask_asset_url: str | None = None


class AnalysisCard(BaseModel):
    """A user-facing analysis suggestion with optional normalized regions."""

    model_config = ConfigDict(validate_assignment=True)

    id: str
    category: str
    title: str
    summary: str = ""
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    risk: str = ""
    enabled: bool = False
    regions: list[Region] = Field(default_factory=list)


class Operation(BaseModel):
    """One bounded operation in an edit plan."""

    model_config = ConfigDict(validate_assignment=True)

    id: UUID = Field(default_factory=uuid4)
    kind: str
    goal: Goal
    region_ids: list[str] = Field(default_factory=list)
    intensity: int = Field(default=55, ge=0, le=100)
    enabled: bool = True
    instructions: str | None = Field(default=None, max_length=500)


_DEFAULT_PRESERVE = (
    "face identity",
    "composition",
    "main pose",
    "costume design",
    "background structure",
    "original light direction",
    "perspective",
    "depth of field",
    "noise consistency",
)


class EditPlan(BaseModel):
    """The structured, confirmed inputs passed to an image provider."""

    model_config = ConfigDict(validate_assignment=True)

    goals: list[Goal] = Field(default_factory=list)
    preserve: tuple[str, ...] = Field(default_factory=lambda: tuple(_DEFAULT_PRESERVE))
    regions: list[Region] = Field(default_factory=list)
    operations: list[Operation] = Field(default_factory=list)
    intensity: int = Field(default=55, ge=0, le=100)
    integration: list[str] = Field(
        default_factory=lambda: [
            "original light direction",
            "perspective",
            "depth of field",
            "noise consistency",
        ]
    )
    validation: list[str] = Field(
        default_factory=lambda: [
            "face identity",
            "pose and composition",
            "hands and costume",
            "background geometry",
            "lighting and noise",
        ]
    )
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("preserve")
    @classmethod
    def require_mandatory_preserve(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        missing = set(_DEFAULT_PRESERVE).difference(value)
        if missing:
            missing_items = ", ".join(sorted(missing))
            raise ValueError(f"preserve is missing mandatory concepts: {missing_items}")
        return value


class VersionRecord(BaseModel):
    """A generated candidate and the checks recorded for that candidate."""

    model_config = ConfigDict(validate_assignment=True)

    id: UUID = Field(default_factory=uuid4)
    asset_url: AssetURL
    created_at: UTCDateTime = Field(default_factory=_utc_now)
    validation: dict[str, Any] = Field(default_factory=dict)
    selected: bool = False


class TaskRecord(BaseModel):
    """Mutable domain record whose status changes only through ``advance``."""

    model_config = ConfigDict(validate_assignment=True)

    id: UUID = Field(
        default_factory=uuid4,
        validation_alias=AliasChoices("id", "task_id"),
        serialization_alias="task_id",
    )
    status: TaskStatus = Field(default=TaskStatus.CREATED, frozen=True)
    created_at: UTCDateTime = Field(default_factory=_utc_now)
    updated_at: UTCDateTime = Field(default_factory=_utc_now)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)
    original_asset_url: AssetURL | None = None
    mask_asset_url: AssetURL | None = None
    analysis: list[AnalysisCard] = Field(default_factory=list)
    plan: EditPlan | None = None
    versions: list[VersionRecord] = Field(default_factory=list)
    error: TaskError | None = None

    @classmethod
    def new(cls, *, idempotency_key: str | None = None) -> "TaskRecord":
        now = _utc_now()
        return cls(
            id=uuid4(),
            status=TaskStatus.CREATED,
            created_at=now,
            updated_at=now,
            idempotency_key=idempotency_key,
        )

    def advance(self, next_status: TaskStatus | str) -> None:
        """Move to a valid next status and refresh the record timestamp."""

        from .state import advance

        next_value = advance(self.status, next_status)
        object.__setattr__(self, "status", next_value)
        self.updated_at = _utc_now()
