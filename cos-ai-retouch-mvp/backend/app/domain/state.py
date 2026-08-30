"""State transition rules for a COS AI retouch task."""

from types import MappingProxyType
from typing import Final, Mapping

from .models import TaskStatus


class InvalidTransition(ValueError):
    """Raised when a task requests a status transition outside the contract."""


transition_table: Final[Mapping[TaskStatus, frozenset[TaskStatus]]] = MappingProxyType(
    {
        TaskStatus.CREATED: frozenset({TaskStatus.UPLOADING}),
        TaskStatus.UPLOADING: frozenset({TaskStatus.ANALYZING, TaskStatus.FAILED}),
        TaskStatus.ANALYZING: frozenset(
            {TaskStatus.AWAITING_CONFIRMATION, TaskStatus.FAILED}
        ),
        TaskStatus.AWAITING_CONFIRMATION: frozenset(
            {TaskStatus.GENERATING, TaskStatus.FAILED}
        ),
        TaskStatus.GENERATING: frozenset({TaskStatus.VALIDATING, TaskStatus.FAILED}),
        TaskStatus.VALIDATING: frozenset({TaskStatus.SUCCEEDED, TaskStatus.FAILED}),
        TaskStatus.FAILED: frozenset(
            {TaskStatus.ANALYZING, TaskStatus.GENERATING, TaskStatus.EXPIRED}
        ),
        TaskStatus.SUCCEEDED: frozenset({TaskStatus.EXPIRED}),
        TaskStatus.EXPIRED: frozenset(),
    }
)

# The uppercase alias is convenient for callers that treat the table as a constant.
TRANSITIONS = transition_table


def _display_status(value: TaskStatus | str) -> str:
    return value.value if isinstance(value, TaskStatus) else str(value)


def advance(current: TaskStatus | str, next_status: TaskStatus | str) -> TaskStatus:
    """Validate and return ``next_status`` for a task at ``current``."""

    current_text = _display_status(current)
    requested_text = _display_status(next_status)

    try:
        current_value = TaskStatus(current_text)
        requested_value = TaskStatus(requested_text)
    except (TypeError, ValueError) as exc:
        raise InvalidTransition(
            f"Invalid task status transition: {current_text} -> {requested_text}"
        ) from exc

    if requested_value not in transition_table[current_value]:
        raise InvalidTransition(
            f"Invalid task status transition: {current_value.value} -> "
            f"{requested_value.value}"
        )

    return requested_value
