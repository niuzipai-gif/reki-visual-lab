"""Safe workflow planning for the browser COS retouch editor.

The planner owns orchestration decisions only. It never submits an image
generation job, so a small deployment can use it without spending a limited
image quota. A future MiniMax text planner can implement the same response
contract behind this boundary.
"""

from __future__ import annotations

import json
from typing import Any, Literal
from urllib.request import Request, urlopen

from pydantic import BaseModel, ConfigDict, Field

from app.config import Settings, get_settings


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
    """Plan COS work locally, optionally using MiniMax text orchestration.

    The image-generation endpoint is deliberately not called here. When the
    text planner is unavailable or returns an unsafe shape, the deterministic
    plan remains usable and no provider response is exposed to the browser.
    """

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def plan(self, request: WorkflowPlanRequest) -> WorkflowPlan:
        rules_plan = self._rules_plan(request)
        if self.settings.planner_provider_mode != "minimax":
            return rules_plan
        api_key = self.settings.get_planner_api_key()
        if not api_key:
            return rules_plan
        try:
            return self._minimax_plan(request, api_key)
        except Exception:
            # A provider outage must not make the editor unusable. Do not
            # preserve upstream error text because it may contain secrets.
            return rules_plan

    def _rules_plan(self, request: WorkflowPlanRequest) -> WorkflowPlan:
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

    def _minimax_plan(
        self, request: WorkflowPlanRequest, api_key: str
    ) -> WorkflowPlan:
        base_url = self.settings.planner_provider_base_url.strip().rstrip("/")
        if not base_url:
            raise ValueError("planner base URL is empty")
        system_prompt = (
            "你是 COS 人像后期编排助手。只输出 JSON，不输出 markdown。"
            "把用户的照片后期需求拆成最多 7 个步骤。只允许 module 为 "
            "light, skin, hair, costume, body, background, style。"
            "light/style 必须是 adjustment/global；其他模块必须是 ai/local。"
            "不要生成图片，不要改变人物身份、姿势、服装设计、构图或原始光线。"
            'JSON 格式：{"operations":[{"module":"skin","label":"面部精修",'
            '"intensity":45}],"notes":["..."]}'
        )
        user_prompt = json.dumps(
            request.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":")
        )
        payload = {
            "model": self.settings.planner_provider_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.15,
            "max_tokens": 900,
            "stream": False,
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        http_request = Request(
            f"{base_url}/chat/completions",
            data=body,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )
        with urlopen(http_request, timeout=20) as response:  # noqa: S310 - configured URL
            if not 200 <= response.status < 300:
                raise ValueError("planner request failed")
            response_payload = json.loads(response.read().decode("utf-8"))
        generated = self._extract_json(response_payload)
        return self._normalize_minimax_plan(request, generated)

    @staticmethod
    def _extract_json(payload: Any) -> dict[str, Any]:
        content: Any = None
        if isinstance(payload, dict):
            choices = payload.get("choices")
            if isinstance(choices, list) and choices and isinstance(choices[0], dict):
                message = choices[0].get("message")
                if isinstance(message, dict):
                    content = message.get("content")
            if content is None:
                content = payload.get("reply")
        if isinstance(content, list):
            content = "".join(
                str(item.get("text", "")) for item in content if isinstance(item, dict)
            )
        if not isinstance(content, str):
            raise ValueError("planner content is missing")
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        decoded = json.loads(cleaned)
        if not isinstance(decoded, dict):
            raise ValueError("planner JSON is not an object")
        return decoded

    def _normalize_minimax_plan(
        self, request: WorkflowPlanRequest, payload: dict[str, Any]
    ) -> WorkflowPlan:
        raw_operations = payload.get("operations")
        if not isinstance(raw_operations, list):
            raise ValueError("planner operations are missing")
        operations: list[WorkflowOperation] = []
        seen: set[str] = set()
        for raw in raw_operations[:7]:
            if not isinstance(raw, dict):
                continue
            module = str(raw.get("module", "")).strip().lower()
            if module not in MODULE_LABELS or module in seen:
                continue
            seen.add(module)
            is_adjustment = module in {"light", "style"}
            raw_label = raw.get("label")
            label = (
                str(raw_label).strip()[:80]
                if isinstance(raw_label, str) and raw_label.strip()
                else MODULE_LABELS[module]
            )
            raw_intensity = raw.get("intensity", 45)
            intensity = (
                int(raw_intensity)
                if isinstance(raw_intensity, (int, float)) and not isinstance(raw_intensity, bool)
                else 45
            )
            operations.append(
                WorkflowOperation(
                    id=f"workflow-{module}-{len(operations) + 1}",
                    module=module,  # type: ignore[arg-type]
                    label=label,
                    kind="adjustment" if is_adjustment else "ai",
                    scope="global" if is_adjustment else "local",
                    intensity=max(0, min(100, intensity)),
                    requires_remote_ai=not is_adjustment,
                )
            )
        if not operations:
            raise ValueError("planner returned no safe operations")
        raw_notes = payload.get("notes")
        notes = [
            "MiniMax 文本智能体已完成后期任务拆解；本次未调用生图。"
        ]
        if isinstance(raw_notes, list):
            notes.extend(str(note).strip()[:160] for note in raw_notes if str(note).strip())
        if any(operation.scope == "local" for operation in operations) and not request.has_mask:
            notes.append("检测到局部任务但尚未提供蒙版，建议先在画布上圈选处理区域。")
        return WorkflowPlan(
            filename=request.filename,
            provider="minimax-planner",
            image_generation_calls=0,
            operations=tuple(operations),
            notes=tuple(notes[:6]),
        )


__all__ = [
    "WorkflowPlan",
    "WorkflowPlanRequest",
    "WorkflowPlanner",
    "WorkflowOperation",
]
