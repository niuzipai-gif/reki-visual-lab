"""Safe workflow planning for the browser COS retouch editor.

The planner owns orchestration decisions only. It never submits an image
generation job, so a small deployment can use it without spending a limited
image quota. A future MiniMax text planner can implement the same response
contract behind this boundary.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


WorkflowPreset = Literal[
    "natural-studio",
    "clear-japanese",
    "retro-film",
    "dark-cinema",
]
WorkflowModule = Literal[
    "light",
    "skin",
    "hair",
    "costume",
    "body",
    "background",
    "style",
]

PRESERVE = (
    "face identity",
    "main pose",
    "costume design",
    "composition",
    "background structure",
    "original light direction",
    "perspective",
    "depth of field",
    "noise consistency",
)

MODULE_LABELS: dict[str, str] = {
    "light": "光影重塑",
    "skin": "面部精修",
    "hair": "发丝整理",
    "costume": "服装修复",
    "body": "身形边缘",
    "background": "背景清理",
    "style": "风格质感",
}

PRESET_STEPS: dict[str, tuple[tuple[str, str, str, str, int], ...]] = {
    "natural-studio": (
        ("light", "自然提亮", "adjustment", "global", 55),
        ("skin", "保留纹理的肤色整理", "adjustment", "local", 42),
        ("style", "柔和高光", "adjustment", "global", 35),
    ),
    "clear-japanese": (
        ("light", "清透亮肤", "adjustment", "global", 52),
        ("style", "低饱和空气感", "adjustment", "global", 38),
        ("hair", "发丝边缘整理", "ai", "local", 45),
    ),
    "retro-film": (
        ("light", "复古柔光", "adjustment", "global", 48),
        ("style", "胶片褪色与颗粒", "adjustment", "global", 44),
    ),
    "dark-cinema": (
        ("light", "暗调光影", "adjustment", "global", 50),
        ("style", "冷暖电影色", "adjustment", "global", 40),
        ("background", "背景杂物清理", "ai", "local", 45),
    ),
}


class WorkflowPlanRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    filename: str = Field(default="cos-photo", min_length=1, max_length=255)
    preset: WorkflowPreset | None = None
    modules: list[str] = Field(default_factory=list, max_length=12)
    intent: str = Field(default="", max_length=500)
    has_mask: bool = False
    image_width: int | None = Field(default=None, ge=1, le=30000)
    image_height: int | None = Field(default=None, ge=1, le=30000)


class WorkflowOperation(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    module: WorkflowModule
    label: str
    kind: Literal["adjustment", "ai"]
    scope: Literal["global", "local"]
    intensity: int = Field(ge=0, le=100)
    requires_remote_ai: bool = False
    preserve: tuple[str, ...] = PRESERVE


class WorkflowPlan(BaseModel):
    model_config = ConfigDict(frozen=True)

    filename: str
    provider: Literal["rules", "minimax-planner"] = "rules"
    image_generation_calls: int = Field(default=0, ge=0)
    operations: tuple[WorkflowOperation, ...]
    preserve: tuple[str, ...] = PRESERVE
    validation: tuple[str, ...] = (
        "face identity",
        "pose and composition",
        "hands and costume",
        "background geometry",
        "lighting and noise",
    )
    notes: tuple[str, ...] = ()


class WorkflowPlanner:
    """Deterministic planner used as the quota-safe default."""

    def plan(self, request: WorkflowPlanRequest) -> WorkflowPlan:
        candidates: list[tuple[str, str, str, str, int]] = []
        if request.preset:
            candidates.extend(PRESET_STEPS[request.preset])

        for raw_module in request.modules:
            module = raw_module.strip().lower()
            if module not in MODULE_LABELS:
                continue
            kind = "adjustment" if module in {"light", "style"} else "ai"
            scope = "global" if kind == "adjustment" else "local"
            candidates.append((module, MODULE_LABELS[module], kind, scope, 45))

        if not candidates:
            candidates.append(("light", "自然提亮", "adjustment", "global", 35))

        operations: list[WorkflowOperation] = []
        seen: set[str] = set()
        for module, label, kind, scope, intensity in candidates:
            if module in seen:
                continue
            seen.add(module)
            requires_remote_ai = kind == "ai"
            operations.append(
                WorkflowOperation(
                    id=f"workflow-{module}-{len(operations) + 1}",
                    module=module,  # type: ignore[arg-type]
                    label=label,
                    kind=kind,  # type: ignore[arg-type]
                    scope=scope,  # type: ignore[arg-type]
                    intensity=intensity,
                    requires_remote_ai=requires_remote_ai,
                )
            )

        notes = [
            "当前规划器只负责拆解后期任务，不调用生图模型。",
            "局部 AI 步骤需要用户确认蒙版后，才允许接入云端编辑模型。",
        ]
        if request.intent.strip():
            notes.append(f"已记录用户意图：{request.intent.strip()}")
        if any(operation.scope == "local" for operation in operations) and not request.has_mask:
            notes.append("检测到局部任务但尚未提供蒙版，建议先在画布上圈选处理区域。")

        return WorkflowPlan(
            filename=request.filename,
            operations=tuple(operations),
            notes=tuple(notes),
        )


__all__ = [
    "WorkflowPlan",
    "WorkflowPlanRequest",
    "WorkflowPlanner",
    "WorkflowOperation",
]
