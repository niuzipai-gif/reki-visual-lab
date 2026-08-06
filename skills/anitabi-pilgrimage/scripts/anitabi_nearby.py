#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Find one anime work's Anitabi landmarks near an area or coordinate."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.parse
from typing import Any

from anitabi_common import eprint, fetch_json, fmt_time, google_maps_link


ANITABI_API = os.environ.get("ANITABI_API_BASE", "https://api.anitabi.cn").rstrip("/")
BGM_SEARCH = os.environ.get(
    "BGM_SEARCH_BASE", "https://api.bgm.tv/search/subject"
).rstrip("/")

AREA_COORDS = {
    "东京新宿": (35.6938, 139.7034), "新宿": (35.6938, 139.7034),
    "东京涩谷": (35.6580, 139.7016), "涩谷": (35.6580, 139.7016),
    "东京": (35.6762, 139.6503), "秋叶原": (35.6984, 139.7731),
    "池袋": (35.7295, 139.7109), "上野": (35.7076, 139.7772),
    "浅草": (35.7148, 139.7967), "京都": (35.0116, 135.7681),
    "大阪": (34.6937, 135.5023), "名古屋": (35.1815, 136.9066),
    "奈良": (34.6851, 135.8048), "镰仓": (35.3192, 139.5467),
    "广岛": (34.3853, 132.4553), "长野": (36.2380, 138.1880),
    "北海道": (43.0642, 141.3469), "札幌": (43.0618, 141.3545),
    "冲绳": (26.3344, 127.8056), "那霸": (26.2124, 127.6809),
    "宇治": (34.9077, 135.8060), "宇治市": (34.9077, 135.8060),
    "湘南": (35.3192, 139.5467), "江之岛": (35.3116, 139.4878),
}


def http_get(url: str, timeout: float = 15) -> Any:
    return fetch_json(url, timeout=timeout)


def search_bangumi(keyword: str) -> list[tuple[int, str, str]]:
    try:
        data = http_get(f"{BGM_SEARCH}/{urllib.parse.quote(keyword)}")
    except Exception:
        return []
    return [
        (int(item["id"]), item.get("name_cn") or "", item.get("name") or "")
        for item in data.get("list", [])
        if item.get("type") == 2 and item.get("id") is not None
    ]


def get_all_points(subject_id: int) -> list[dict[str, Any]]:
    try:
        data = http_get(f"{ANITABI_API}/bangumi/{subject_id}/points/detail?haveImage=true")
        return data if isinstance(data, list) else []
    except Exception:
        return []


def make_gmaps_link(lat: float, lng: float) -> str:
    return google_maps_link(lat, lng)


def _select_subject(keyword: str, subject_id: int | None) -> tuple[int | None, str, str, list[dict[str, Any]]]:
    if subject_id is not None:
        return subject_id, str(subject_id), str(subject_id), get_all_points(subject_id)
    results = search_bangumi(keyword)
    if not results:
        return None, "", "", []
    exact = [item for item in results if keyword in (item[1] + item[2])] or results
    for candidate_id, name_cn, name in exact:
        points = get_all_points(candidate_id)
        if points:
            return candidate_id, name_cn, name, points
    return None, "", "", []


def main() -> int:
    parser = argparse.ArgumentParser(description="Anitabi 地区附近巡礼点查询")
    parser.add_argument("keyword", nargs="?", help="作品名称；使用 --id 时可省略")
    parser.add_argument("--id", type=int, help="直接按 Bangumi subjectID 查询")
    parser.add_argument("--area", help="内置地区名")
    parser.add_argument("--lat", type=float, help="中心纬度（与 --lng 一起使用）")
    parser.add_argument("--lng", type=float, help="中心经度（与 --lat 一起使用）")
    parser.add_argument("--radius", type=float, default=0.08, help="搜索半径（近似度数，默认0.08）")
    parser.add_argument("--top", type=int, default=5, help="最多返回几个点")
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    args = parser.parse_args()

    if args.lat is not None or args.lng is not None:
        if args.lat is None or args.lng is None:
            eprint("--lat 和 --lng 必须同时提供")
            return 2
        center = (args.lat, args.lng)
        area_name = f"{args.lat:.3f},{args.lng:.3f}"
    elif args.area:
        if args.area not in AREA_COORDS:
            eprint(f"未知地区「{args.area}」；请改用 --lat/--lng")
            return 2
        center = AREA_COORDS[args.area]
        area_name = args.area
    else:
        eprint("请提供 --area 或 --lat/--lng")
        return 2

    if args.id is None and not args.keyword:
        eprint("请提供作品名称，或使用 --id")
        return 2
    if args.radius < 0 or args.top < 0:
        eprint("--radius 和 --top 不能为负数")
        return 2

    subject_id, name_cn, name, points = _select_subject(args.keyword or "", args.id)
    if subject_id is None:
        payload = {"error": "no_work_or_pilgrimage_data", "keyword": args.keyword}
        if args.json:
            print(json.dumps(payload, ensure_ascii=False))
        else:
            eprint(f"未找到作品「{args.keyword}」或其没有巡礼数据")
        return 1

    def degree_distance(point: dict[str, Any]) -> float:
        geo = point.get("geo") or []
        if len(geo) < 2:
            return math.inf
        return math.hypot(float(geo[0]) - center[0], float(geo[1]) - center[1])

    nearby = sorted((point for point in points if degree_distance(point) <= args.radius), key=degree_distance)
    nearby = nearby[: args.top]
    payload = {
        "subject": {"id": subject_id, "name": name, "name_cn": name_cn},
        "area": area_name,
        "center": list(center),
        "radius": args.radius,
        "total_points": len(points),
        "nearby": nearby,
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    display_name = name_cn or name or str(subject_id)
    if not nearby:
        print(f"📍 「{display_name}」在「{area_name}」附近没有找到巡礼点")
        print(f"该作品共 {len(points)} 个巡礼点；可扩大 --radius 或换地区")
        return 0
    print(f"📍 「{display_name}」在「{area_name}」附近的巡礼点 ({len(nearby)}个)\n")
    for index, point in enumerate(nearby, 1):
        geo = point.get("geo") or []
        ep = f"EP{point['ep']}" if point.get("ep") else "—"
        print(f"{index}. {point.get('cn') or point.get('name')} | {ep} @ {fmt_time(point.get('s'))}")
        if len(geo) >= 2:
            print(f"   🗺️ {make_gmaps_link(float(geo[0]), float(geo[1]))}")
        if point.get("image"):
            print(f"   📷 {point['image']}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
