---
name: anitabi-pilgrimage
description: Use when a user asks for anime pilgrimage locations, real-world filming spots, nearby Anitabi landmarks, map links, episode timestamps, screenshots, or reverse lookup from an address or coordinate.
---

# Anitabi 圣地巡礼

Use the bundled Python scripts to query live public data from Bangumi and Anitabi. Keep live results, missing data, and network failures separate; never invent a landmark, coordinate, episode, or image.

## Choose the operation

| User intent | Tool | Required input |
| --- | --- | --- |
| “这部动画有哪些取景地？” | `scripts/anitabi_query.py` | title or Bangumi subject ID |
| “这部动画在新宿/京都附近有哪些点？” | `scripts/anitabi_nearby.py` | title or ID plus area/coordinates |
| “这个地址附近有哪些动画巡礼点？” | `scripts/anitabi_reverse.py` | address from the built-in table, or latitude/longitude |
| “哪些截图里有动画人物？” | `scripts/scan_characters.py` | local image directory plus point JSON |

Resolve the directory containing this `SKILL.md` and use paths relative to it. Do not assume a host-specific or repository-specific path.

## Run the scripts

```bash
python "<skill-dir>/scripts/anitabi_query.py" "你的名字"
python "<skill-dir>/scripts/anitabi_query.py" --id 160209 --detail
python "<skill-dir>/scripts/anitabi_query.py" --id 160209 --img 1 --output-dir "<output-dir>"
python "<skill-dir>/scripts/anitabi_nearby.py" "你的名字" --area "东京新宿" --top 5
python "<skill-dir>/scripts/anitabi_nearby.py" --id 160209 --lat 35.6938 --lng 139.7034 --json
python "<skill-dir>/scripts/anitabi_reverse.py" --address "宇治市" --radius 500 --top 10
python "<skill-dir>/scripts/anitabi_reverse.py" --lat 34.9077 --lng 135.8060 --radius 500 --json
python "<skill-dir>/scripts/vision_preflight.py" --mode native --json
python "<skill-dir>/scripts/vision_preflight.py" --mode mmx --json
```

Use `--json` when another tool or agent will consume the result. JSON mode is designed to be stdout-only; diagnostics go to stderr. Use `--help` for the current flags. The scripts require only Python 3.9+ standard-library modules.

## Query and deliver responsibly

1. Briefly tell the user that title search, area lookup, coordinate reverse lookup, and optional screenshot retrieval are available. Do not force a fixed welcome message.
2. Prefer `--id` when the user provides a Bangumi ID. For a title, check the selected Bangumi name before reporting results; ask for the Japanese title when matching is ambiguous.
3. Report the work name, landmark name, coordinates, episode/time when present, source link, and Google Maps link when coordinates exist. Say when Anitabi has no data or when the API response is incomplete.
4. For a screenshot, use `--img N`. Deliver the resulting local file through the host agent’s supported image/file channel; do not call a hard-coded messenger command.
5. Keep attribution with screenshots: Anitabi data and images are subject to the source page’s license, commonly CC BY-NC-SA 4.0. Do not imply that a screenshot is safe to redistribute commercially.

## Area and reverse lookup boundaries

- `anitabi_nearby.py --radius` is an approximate latitude/longitude radius. For a precise distance from an address, use `anitabi_reverse.py --radius` in meters.
- The built-in area table is only a convenience center point, not geocoding. For an unsupported address, request coordinates or use a host geocoder if one is available.
- Reverse lookup iterates `works_library.json`. It is a bounded discovery list, not a complete catalog. Report `api_errors` in JSON mode and treat results as potentially incomplete when requests fail.
- Extend the library with `{ "id": <Bangumi subject ID>, "name": <original title>, "name_cn": <localized title> }`. Keep IDs unique.

## Vision startup preflight

Run this check before any character/image classification. The agent, not the script, determines whether the current model can inspect image inputs; do not infer that capability from a model name.

- If the current model is multimodal and can see images, run `vision_preflight.py --mode native --json`. It must return `ready: true` and `requires_mmx: false`; do not resolve or call mmx. Inspect the images with native vision, write boolean labels, then run the scanner with `--vision-mode native`.
- If the current model cannot see images, run `vision_preflight.py --mode mmx --json`. It must find an executable mmx command before scanning. If it returns `ready: false`, stop and report that mmx must be installed or a multimodal model must be used; do not guess labels.
- Never silently switch modes. Keep uncertain or missing results as `has_char: null`.

Native-model path:

```bash
python "<skill-dir>/scripts/vision_preflight.py" --mode native --json
python "<skill-dir>/scripts/scan_characters.py" \
  --vision-mode native \
  --images-dir "<images-dir>" \
  --points-file "<points.json>" \
  --labels-file "<labels.json>" \
  --json
```

Non-multimodal fallback path:

```bash
python "<skill-dir>/scripts/vision_preflight.py" --mode mmx --json
python "<skill-dir>/scripts/scan_characters.py" \
  --vision-mode mmx \
  --images-dir "<images-dir>" \
  --points-file "<points.json>" \
  --output "<output.json>" \
  --json
```

Accepted labels are booleans only. Native mode never invokes mmx. Mmx mode invokes its local `vision describe` command for each available image and leaves failed/uncertain classifications as `null`.

## Network and failure handling

The scripts use `https://api.anitabi.cn` for Anitabi data and the Bangumi subject-search endpoint for title lookup. They try a direct HTTPS request and fall back to standard Python networking. This is a compatibility fallback, not a guarantee against WAFs, rate limits, or proxy restrictions. On failure, retry once only when appropriate, then report the failure and verification scope.

Environment overrides are available for testing or a compatible mirror: `ANITABI_API_BASE`, `BGM_SEARCH_BASE`, `ANITABI_DOH_URL`, and `ANITABI_USER_AGENT`. Do not place tokens or personal credentials in the skill or its output.
