#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build a character-review manifest without requiring a specific vision CLI.

An agent may inspect the images with its native vision capability and provide a
labels JSON file. This helper merges those labels and preserves unknown values
as null instead of guessing.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

from anitabi_common import eprint


def _load_points(points_file: str | os.PathLike[str]) -> list[dict[str, Any]]:
    data = json.loads(Path(points_file).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("points") or data.get("litePoints") or []
    return [point for point in data if isinstance(point, dict)]


def _load_labels(labels_file: str | os.PathLike[str] | None) -> dict[str, bool]:
    if not labels_file:
        return {}
    data = json.loads(Path(labels_file).read_text(encoding="utf-8"))
    labels: dict[str, bool] = {}
    if isinstance(data, dict):
        rows = data.get("labels") if isinstance(data.get("labels"), list) else None
        if rows is None:
            rows = [{"file": key, "has_char": value} for key, value in data.items()]
    else:
        rows = data
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
        path for path in image_dir.iterdir() if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    ) if image_dir.exists() else []
    by_name = {path.name: path for path in image_files}
    points = _load_points(points_file)
    rows: list[dict[str, Any]] = []
    for index, point in enumerate(points, 1):
        point_id = str(point.get("id") or "")
        candidates = [f"{index:02d}_{point_id}.jpg", f"{index:02d}_{point_id}.jpeg", f"{index:02d}_{point_id}.png"]
        image_name = next((candidate for candidate in candidates if candidate in by_name), None)
        if image_name is None and index <= len(image_files):
            image_name = image_files[index - 1].name
        row: dict[str, Any] = {
            "index": index,
            "name": point.get("cn") or point.get("name"),
            "file": image_name,
            "has_char": labels.get(image_name) if image_name and labels else None,
        }
        rows.append(row)
    return rows


def main() -> int:
    temp = Path(tempfile.gettempdir())
    parser = argparse.ArgumentParser(description="生成巡礼截图的角色视觉审核清单")
    parser.add_argument("--images-dir", default=str(temp / "anitabi_5cm"), help="截图目录")
    parser.add_argument("--points-file", default=str(temp / "anitabi_5cm.json"), help="点列表 JSON")
    parser.add_argument("--labels-file", help="agent 视觉审核后写入的 labels JSON")
    parser.add_argument("--output", default=str(temp / "anitabi_scan_result.json"), help="结果 JSON 路径")
    parser.add_argument("--json", action="store_true", help="只输出 JSON 数组")
    args = parser.parse_args()
    try:
        rows = build_manifest(args.images_dir, args.points_file, _load_labels(args.labels_file))
    except Exception as exc:
        eprint(f"清单生成失败: {exc}")
        return 1

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
