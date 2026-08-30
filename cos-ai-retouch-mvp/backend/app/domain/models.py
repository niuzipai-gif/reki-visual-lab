"""Pydantic domain models for the COS AI retouch workflow."""

from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


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


_DEFAULT_PRESERVE = [
    "face identity",
    "composition",
    "main pose",
    "costume design",
    "background structure",
    "original light direction",
    "perspective",
    "depth of field",
    "noise consistency",
]


class EditPlan(BaseModel):
    """The structured, confirmed inputs passed to an image provider."""

    model_config = ConfigDict(validate_assignment=True)

    goals: list[Goal] = Field(default_factory=list)
    preserve: list[str] = Field(default_factory=lambda: list(_DEFAULT_PRESERVE))
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


class VersionRecord(BaseModel):
    """A generated candidate and the checks recorded for that candidate."""

    model_config = ConfigDict(validate_assignment=True)

    id: UUID = Field(default_factory=uuid4)
    asset_url: str
    created_at: datetime = Field(default_factory=_utc_now)
    validation: dict[str, Any] = Field(default_factory=dict)
    selected: bool = False


class TaskRecord(BaseModel):
    """Mutable domain record whose status changes only through ``advance``."""

    model_config = ConfigDict(validate_assignment=True)

    id: UUID = Field(default_factory=uuid4)
    status: TaskStatus = TaskStatus.CREATED
    created_at: datetime = Field(default_factory=_utc_now)
    updated_at: datetime = Field(default_factory=_utc_now)
    idempotency_key: str | None = None
    original_asset_url: str | None = None
    mask_asset_url: str | None = None
    analysis: list[AnalysisCard] = Field(default_factory=list)
    plan: EditPlan | None = None
    versions: list[VersionRecord] = Field(default_factory=list)
    error: dict[str, Any] | None = None

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

        self.status = advance(self.status, next_status)
        self.updated_at = _utc_now()
