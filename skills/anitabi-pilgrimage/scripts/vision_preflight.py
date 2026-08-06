#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Preflight the image-review backend selected by the calling agent.

The script cannot infer a model's multimodal capability from the model name.
The agent must choose ``native`` when it can inspect images itself, or ``mmx``
when it cannot. The selected backend is then checked before any image work.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any


def find_mmx() -> str | None:
    """Find an mmx executable without invoking it."""
    configured = os.environ.get("ANITABI_MMX_COMMAND")
    if configured:
        configured_path = Path(configured).expanduser()
        if configured_path.exists():
            return str(configured_path)
        if configured_path.parent != Path("."):
            return None
        command = shutil.which(configured)
        return command

    for name in ("mmx", "mmx.cmd", "mmx.exe"):
        command = shutil.which(name)
        if command:
            return command

    if os.name == "nt":
        npm_dir = Path.home() / "AppData" / "Roaming" / "npm"
        for name in ("mmx.cmd", "mmx.exe"):
            candidate = npm_dir / name
            if candidate.exists():
                return str(candidate)
    return None


def check_mode(mode: str) -> dict[str, Any]:
    """Return a machine-readable readiness result for ``native`` or ``mmx``."""
    if mode == "native":
        return {
            "ready": True,
            "mode": "native",
            "requires_mmx": False,
            "command": None,
            "message": "native multimodal vision selected; mmx is skipped",
        }
    if mode != "mmx":
        return {
            "ready": False,
            "mode": mode,
            "requires_mmx": True,
            "command": None,
            "message": "select native for a multimodal model or mmx for a non-multimodal model",
        }

    command = find_mmx()
    if command:
        return {
            "ready": True,
            "mode": "mmx",
            "requires_mmx": True,
            "command": command,
            "message": "mmx vision backend is available",
        }
    return {
        "ready": False,
        "mode": "mmx",
        "requires_mmx": True,
        "command": None,
        "message": "this agent cannot inspect images natively and no mmx executable was found; install mmx or use a multimodal model",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Anitabi 图片识别后端启动前检测")
    parser.add_argument("--mode", required=True, choices=("native", "mmx"), help="native=当前模型可识图；mmx=当前模型不可识图")
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    args = parser.parse_args()
    result = check_mode(args.mode)
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        status = "READY" if result["ready"] else "BLOCKED"
        print(f"{status}: {result['message']}")
        if result.get("command"):
            print(f"MMX_COMMAND:{result['command']}")
    return 0 if result["ready"] else 1


if __name__ == "__main__":
    sys.exit(main())
