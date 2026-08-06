#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Review pilgrimage screenshots with native vision or an mmx fallback.

The calling agent must select ``--vision-mode native`` when it can inspect
images itself. Non-multimodal agents must select ``--vision-mode mmx``; the
startup preflight then blocks the run when mmx is unavailable.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from anitabi_common import eprint
from vision_preflight import check_mode


PROMPT = (
    "这张图片里有没有动漫/动画人物角色出现在画面中？"
    "只有真正的动漫人物才算；现实街景、建筑、风景、路人背影且无法确认是动漫人物时回答没有。"
    "只回答：有 或 没有。"
)


def _load_points(points_file: str | os.PathLike[str]) -> list[dict[str, Any]]:
    data = json.loads(Path(points_file).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("points") or data.get("litePoints") or []
    return [point for point in data if isinstance(point, dict)]


def _load_labels(labels_file: str | os.PathLike[str] | None) -> dict[str, bool]:
    if not labels_file:
        return {}
    data = json.loads(Path(labels_file).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        rows = data.get("labels") if isinstance(data.get("labels"), list) else [
            {"file": key, "has_char": value} for key, value in data.items()
        ]
    else:
        rows = data
    labels: dict[str, bool] = {}
    for row in rows or []:
        if not isinstance(row, dict) or not isinstance(row.get("file"), str):
            continue
        if isinstance(row.get("has_char"), bool):
            labels[row["file"]] = row["has_char"]
    return labels


def build_manifest(
    images_dir: str | os.PathLike[str],
    points_file: str | os.PathLike[str],
    labels: dict[str, bool] | None = None,
) -> list[dict[str, Any]]:
    image_dir = Path(images_dir)
    image_files = sorted(
        path for path in image_dir.iterdir()
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    ) if image_dir.exists() else []
    by_name = {path.name: path for path in image_files}
    points = _load_points(points_file)
    rows: list[dict[str, Any]] = []
    for index, point in enumerate(points, 1):
        point_id = str(point.get("id") or "")
        candidates = [
            f"{index:02d}_{point_id}.jpg",
            f"{index:02d}_{point_id}.jpeg",
            f"{index:02d}_{point_id}.png",
        ]
        image_name = next((candidate for candidate in candidates if candidate in by_name), None)
        if image_name is None and index <= len(image_files):
            image_name = image_files[index - 1].name
        rows.append({
            "index": index,
            "name": point.get("cn") or point.get("name"),
            "file": image_name,
            "has_char": labels.get(image_name) if image_name and labels else None,
        })
    return rows


def _parse_mmx_output(output: str) -> bool | None:
    output = output.strip()
    if output.startswith("{"):
        try:
            data = json.loads(output)
            output = str(data.get("content") or data.get("text") or "")
        except json.JSONDecodeError:
            pass
    text = output.strip().lower()
    if not text:
        return None
    if "没有" in text or "无" in text or "no" in text:
        return False
    if "有" in text or "yes" in text:
        return True
    return None


def classify_image_with_mmx(image_path: str | os.PathLike[str], command: str) -> bool | None:
    try:
        result = subprocess.run(
            [command, "vision", "describe", "--image", str(image_path), "--prompt", PROMPT, "--quiet"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return _parse_mmx_output(result.stdout)


def main() -> int:
    temp = Path(tempfile.gettempdir())
    parser = argparse.ArgumentParser(description="生成巡礼截图的角色视觉审核清单")
    parser.add_argument("--vision-mode", required=True, choices=("native", "mmx"), help="native=当前模型可识图；mmx=当前模型不可识图")
    parser.add_argument("--images-dir", default=str(temp / "anitabi_5cm"), help="截图目录")
    parser.add_argument("--points-file", default=str(temp / "anitabi_5cm.json"), help="点列表 JSON")
    parser.add_argument("--labels-file", help="native 视觉审核后写入的 labels JSON")
    parser.add_argument("--output", default=str(temp / "anitabi_scan_result.json"), help="结果 JSON 路径")
    parser.add_argument("--json", action="store_true", help="只输出 JSON 数组")
    args = parser.parse_args()

    preflight = check_mode(args.vision_mode)
    if not preflight["ready"]:
        eprint(f"视觉启动检测失败: {preflight['message']}")
        return 1
    try:
        rows = build_manifest(args.images_dir, args.points_file, _load_labels(args.labels_file))
    except Exception as exc:
        eprint(f"清单生成失败: {exc}")
        return 1

    if args.vision_mode == "mmx":
        command = preflight["command"]
        for row in rows:
            if not row.get("file"):
                continue
            result = classify_image_with_mmx(Path(args.images_dir) / row["file"], command)
            if result is not None:
                row["has_char"] = result

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        for row in rows:
            status = {True: "有", False: "无", None: "待审核"}[row["has_char"]]
            print(f"{row['index']:02d} [{status}] {row['name'] or '-'} | {row['file'] or 'file missing'}")
        print(f"\n清单完成: {len(rows)}张，结果: {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
