#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Reverse lookup: find all library works with landmarks near a coordinate."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from anitabi_common import distance_meters, eprint, fetch_json, google_maps_link


ANITABI_API = os.environ.get("ANITABI_API_BASE", "https://api.anitabi.cn").rstrip("/")
SKILL_DIR = Path(__file__).resolve().parent.parent
DEFAULT_LIBRARY = SKILL_DIR / "works_library.json"

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


def load_library(path: str | os.PathLike[str] | None = None) -> list[dict[str, Any]]:
    library_path = Path(path or DEFAULT_LIBRARY)
    data = json.loads(library_path.read_text(encoding="utf-8"))
    works = data.get("works", []) if isinstance(data, dict) else []
    return [work for work in works if isinstance(work, dict) and work.get("id") is not None]


def get_points(subject_id: int) -> tuple[list[dict[str, Any]] | None, str | None]:
    try:
        data = http_get(f"{ANITABI_API}/bangumi/{subject_id}/points/detail?haveImage=true")
        return (data if isinstance(data, list) else []), None
    except Exception as exc:
        return None, str(exc)[:160]


def meters_to_deg(lat: float, meters: float) -> float:
    del lat  # Latitude is retained for API compatibility; filtering uses meters below.
    return meters / 111_320.0


def _lookup_result(distance: float, work: dict[str, Any], point: dict[str, Any]) -> dict[str, Any]:
    geo = point.get("geo") or []
    result = {
        "dist_m": round(distance, 1),
        "work": work.get("name_cn") or work.get("name") or str(work["id"]),
        "work_id": work["id"],
        "point": point.get("cn") or point.get("name"),
        "geo": geo,
    }
    if point.get("image"):
        result["image"] = point["image"]
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Anitabi 地址反查巡礼点")
    parser.add_argument("--address", help="内置地名")
    parser.add_argument("--lat", type=float, help="纬度")
    parser.add_argument("--lng", type=float, help="经度")
    parser.add_argument("--radius", type=float, default=500, help="半径（米，默认500）")
    parser.add_argument("--top", type=int, default=10, help="最多返回几个点")
    parser.add_argument("--library", help="自定义作品库 JSON 路径")
    parser.add_argument("--sleep", type=float, default=0.15, help="请求间隔秒数，测试时可设为0")
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    args = parser.parse_args()

    if args.lat is not None or args.lng is not None:
        if args.lat is None or args.lng is None:
            eprint("--lat 和 --lng 必须同时提供")
            return 2
        center = (args.lat, args.lng)
        center_name = f"{args.lat:.4f},{args.lng:.4f}"
    elif args.address:
        if args.address not in AREA_COORDS:
            eprint(f"未知地址「{args.address}」；请用 --lat/--lng 指定坐标")
            return 2
        center = AREA_COORDS[args.address]
        center_name = args.address
    else:
        eprint("请提供 --address 或 --lat/--lng")
        return 2

    if args.radius < 0 or args.top < 0 or args.sleep < 0:
        eprint("--radius、--top 和 --sleep 不能为负数")
        return 2
    try:
        works = load_library(args.library)
    except Exception as exc:
        eprint(f"作品库读取失败: {exc}")
        return 1
    if not works:
        eprint("作品库为空")
        return 1

    found: list[tuple[float, dict[str, Any], dict[str, Any]]] = []
    api_errors: list[dict[str, Any]] = []
    for work in works:
        points, error = get_points(int(work["id"]))
        if error:
            api_errors.append({"work_id": work["id"], "error": error})
            continue
        for point in points or []:
            geo = point.get("geo") or []
            if len(geo) < 2:
                continue
            distance = distance_meters(center[0], center[1], float(geo[0]), float(geo[1]))
            if distance <= args.radius:
                found.append((distance, work, point))
        if args.sleep:
            time.sleep(args.sleep)

    found.sort(key=lambda item: item[0])
    result_rows = [_lookup_result(distance, work, point) for distance, work, point in found[: args.top]]
    payload = {
        "center": list(center),
        "center_name": center_name,
        "radius": args.radius,
        "library_size": len(works),
        "queried": len(works),
        "api_errors": api_errors,
        "found": result_rows,
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    print(f"🔍 反查「{center_name}」附近 {args.radius}m 的巡礼点...")
    if api_errors:
        print(f"⚠️ {len(api_errors)}/{len(works)} 部作品查询失败，结果可能不完整")
    if not result_rows:
        print(f"📍 「{center_name}」附近没有找到巡礼点")
        return 0
    print(f"📍 找到 {len(found)} 个点，显示最近 {len(result_rows)} 个\n")
    for index, row in enumerate(result_rows, 1):
        print(f"{index}. [{row['work']}] {row['point']} | {row['dist_m']:.0f}m")
        if len(row.get("geo") or []) >= 2:
            print(f"   🗺️ {google_maps_link(float(row['geo'][0]), float(row['geo'][1]))}")
        if row.get("image"):
            print(f"   📷 {row['image']}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
