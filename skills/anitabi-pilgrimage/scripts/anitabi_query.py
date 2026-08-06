#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Query an anime work and its Anitabi pilgrimage landmarks."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any
import urllib.parse

from anitabi_common import (
    eprint,
    fetch_bytes,
    fetch_json,
    fmt_geo,
    fmt_time,
    safe_filename,
)


ANITABI_API = os.environ.get("ANITABI_API_BASE", "https://api.anitabi.cn").rstrip("/")
BGM_SEARCH = os.environ.get(
    "BGM_SEARCH_BASE", "https://api.bgm.tv/search/subject"
).rstrip("/")


def http_get(url: str, timeout: float = 15) -> Any:
    return fetch_json(url, timeout=timeout)


def search_bangumi(keyword: str) -> list[dict[str, Any]]:
    try:
        data = http_get(f"{BGM_SEARCH}/{urllib.parse.quote(keyword)}")
    except Exception:
        return []
    results = []
    for item in data.get("list", []) if isinstance(data, dict) else []:
        if item.get("type") == 2:
            results.append(
                {
                    "id": item.get("id"),
                    "name": item.get("name") or "",
                    "name_cn": item.get("name_cn") or "",
                }
            )
    return results


def get_lite(subject_id: int) -> dict[str, Any]:
    data = http_get(f"{ANITABI_API}/bangumi/{subject_id}/lite")
    if not isinstance(data, dict):
        raise RuntimeError("Anitabi returned a non-object response")
    return data


def get_points(subject_id: int) -> list[dict[str, Any]]:
    data = http_get(f"{ANITABI_API}/bangumi/{subject_id}/points/detail?haveImage=true")
    return data if isinstance(data, list) else []


def download_image(url: str, out_dir: str | os.PathLike[str] | None = None) -> str | None:
    if not url:
        return None
    try:
        data = fetch_bytes(url, timeout=20)
        target_dir = Path(out_dir or tempfile.gettempdir())
        target_dir.mkdir(parents=True, exist_ok=True)
        name = safe_filename(url.rsplit("/", 1)[-1], "anitabi.jpg")
        path = target_dir / f"anitabi_{int(time.time() * 1000)}_{name}"
        path.write_bytes(data)
        return str(path)
    except Exception as exc:
        eprint(f"image download failed: {exc}")
        return None


def _choose_subject(keyword: str) -> tuple[int | None, str | None]:
    results = search_bangumi(keyword)
    if not results:
        return None, None
    chosen = results[0]
    for result in results:
        if keyword in (result["name"] + result["name_cn"]):
            chosen = result
            break
    return int(chosen["id"]), chosen.get("name_cn") or chosen.get("name")


def _summary(lite: dict[str, Any], subject_id: int, subject_name: str | None) -> None:
    name = lite.get("cn") or lite.get("title") or subject_name or str(subject_id)
    print(f"\n📍 {name} — 圣地巡礼")
    if lite.get("city"):
        print(f"🏙️ 主要城市: {lite['city']}")
    if lite.get("geo"):
        print(f"🗺️ 坐标: {fmt_geo(lite['geo'])} (zoom {lite.get('zoom')})")
    print(f"📌 地标总数: {lite.get('pointsLength', 0)} 个 | 含截图: {lite.get('imagesLength', 0)} 个")
    print(f"🔗 地图: https://anitabi.cn/map?bangumiId={subject_id}")
    points = lite.get("litePoints") or []
    if points:
        print(f"\n📌 代表性取景地（前 {len(points)} 个）:")
        for index, point in enumerate(points, 1):
            ep = f"EP{point['ep']}" if point.get("ep") else "—"
            print(
                f"  {index}. {point.get('cn') or point.get('name')} | "
                f"{ep} @ {fmt_time(point.get('s'))} | {fmt_geo(point.get('geo'))}"
            )


def main() -> int:
    parser = argparse.ArgumentParser(description="Anitabi 圣地巡礼查询")
    parser.add_argument("keyword", nargs="?", help="动画名称")
    parser.add_argument("--id", type=int, help="直接按 Bangumi subjectID 查询")
    parser.add_argument("--detail", action="store_true", help="显示前10个地标详情")
    parser.add_argument("--img", type=int, help="下载第N个代表性地标截图")
    parser.add_argument("--output-dir", help="图片保存目录，默认系统临时目录")
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    args = parser.parse_args()

    subject_id = args.id
    subject_name = None
    if subject_id is None:
        if not args.keyword:
            parser.print_help(file=sys.stderr)
            return 2
        subject_id, subject_name = _choose_subject(args.keyword)
        if subject_id is None:
            eprint(f"未找到动画「{args.keyword}」，请尝试日文原名或更精确的名称")
            return 1

    try:
        lite = get_lite(subject_id)
    except Exception as exc:
        if args.json:
            print(json.dumps({"error": str(exc), "subject_id": subject_id}, ensure_ascii=False))
        else:
            eprint(f"查询失败: {exc}")
        return 1

    if lite.get("id") is None:
        payload = {"subject_id": subject_id, "status": "no_pilgrimage_data"}
        if args.json:
            print(json.dumps(payload, ensure_ascii=False))
        else:
            print(f"该作品(id={subject_id})暂无巡礼数据")
        return 0

    details: list[dict[str, Any]] | None = None
    if args.detail:
        try:
            details = get_points(subject_id)[:10]
        except Exception as exc:
            eprint(f"详情加载失败: {exc}")
            details = []

    points = lite.get("litePoints") or []
    image_path = None
    image_point = None
    if args.img is not None:
        index = args.img - 1
        if not 0 <= index < len(points):
            eprint(f"地标序号无效（1-{len(points)}）")
            return 1
        image_point = points[index]
        image_path = download_image(image_point.get("image"), args.output_dir)
        if image_path is None:
            return 1

    if args.json:
        payload: dict[str, Any] = dict(lite)
        if details is not None:
            payload["details"] = details
        if image_path:
            payload["image_path"] = image_path
            payload["image_point"] = image_point.get("name") or image_point.get("cn")
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    _summary(lite, subject_id, subject_name)
    if image_path:
        print(f"IMAGE_PATH:{image_path}")
    if details is not None:
        print("\n📋 全部地标详情（前10个）:")
        for index, point in enumerate(details, 1):
            ep = f"EP{point['ep']}" if point.get("ep") else "—"
            print(
                f"  {index}. {point.get('name') or point.get('cn')} | "
                f"{ep} @ {fmt_time(point.get('s'))} | {fmt_geo(point.get('geo'))} | "
                f"来源:{point.get('origin') or ''}"
            )
    print("\n数据来源: anitabi.cn；截图按来源页面所示 CC BY-NC-SA 4.0 条款使用")
    return 0


if __name__ == "__main__":
    sys.exit(main())
