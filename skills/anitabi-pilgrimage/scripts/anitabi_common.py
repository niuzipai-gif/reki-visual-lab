#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared, dependency-free helpers for the Anitabi command-line tools."""

from __future__ import annotations

import json
import math
import os
import re
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


USER_AGENT = os.environ.get(
    "ANITABI_USER_AGENT",
    "anitabi-pilgrimage-skill/2.0",
)


def configure_utf8_output() -> None:
    """Keep Chinese and emoji output usable on Windows and redirected streams."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


configure_utf8_output()


def eprint(*args: Any, **kwargs: Any) -> None:
    kwargs.setdefault("file", sys.stderr)
    print(*args, **kwargs)


def _resolve_real_ip(host: str) -> str | None:
    """Resolve a public IPv4 address, skipping common fake-IP ranges."""
    try:
        for item in socket.getaddrinfo(host, 443, socket.AF_INET, socket.SOCK_STREAM):
            address = item[4][0]
            if not address.startswith("198.18."):
                return address
    except OSError:
        pass

    doh_url = os.environ.get("ANITABI_DOH_URL", "https://dns.alidns.com/resolve")
    try:
        query = urllib.parse.urlencode({"name": host, "type": "A"})
        request = urllib.request.Request(
            f"{doh_url}?{query}", headers={"User-Agent": USER_AGENT}
        )
        with urllib.request.urlopen(request, timeout=8) as response:
            data = json.loads(response.read().decode("utf-8"))
        for answer in data.get("Answer", []):
            if answer.get("type") == 1 and answer.get("data"):
                return str(answer["data"])
    except Exception:
        return None
    return None


def _decode_chunked(body: bytes) -> bytes:
    if not body:
        return body
    chunks: list[bytes] = []
    rest = body
    while rest:
        line, separator, rest = rest.partition(b"\r\n")
        if not separator:
            return body
        try:
            size = int(line.split(b";", 1)[0], 16)
        except ValueError:
            return body
        if size == 0:
            return b"".join(chunks)
        if len(rest) < size + 2:
            return body
        chunks.append(rest[:size])
        rest = rest[size + 2 :]
    return b"".join(chunks)


def _direct_get(url: str, timeout: float) -> tuple[int, bytes]:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("direct transport only supports HTTPS URLs with a hostname")
    host = parsed.hostname
    port = parsed.port or 443
    ip = _resolve_real_ip(host)
    if not ip:
        raise RuntimeError(f"unable to resolve {host}")

    raw_socket = socket.create_connection((ip, port), timeout=timeout)
    tls_socket = None
    try:
        context = ssl.create_default_context()
        tls_socket = context.wrap_socket(raw_socket, server_hostname=host)
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}\r\n"
            f"User-Agent: {USER_AGENT}\r\n"
            "Accept: */*\r\n"
            "Accept-Encoding: identity\r\n"
            "Connection: close\r\n\r\n"
        ).encode("ascii", "strict")
        tls_socket.sendall(request)
        chunks: list[bytes] = []
        while True:
            chunk = tls_socket.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
        response = b"".join(chunks)
    finally:
        if tls_socket is not None:
            tls_socket.close()
        else:
            raw_socket.close()

    header, separator, body = response.partition(b"\r\n\r\n")
    if not separator:
        raise RuntimeError("malformed HTTP response")
    match = re.search(rb"HTTP/\d(?:\.\d)?\s+(\d+)", header)
    if not match:
        raise RuntimeError("missing HTTP status")
    status = int(match.group(1))
    if b"transfer-encoding: chunked" in header.lower():
        body = _decode_chunked(body)
    return status, body


def fetch_bytes(url: str, timeout: float = 15) -> bytes:
    """Fetch bytes with direct-HTTPS first and standard urllib as fallback."""
    errors: list[str] = []
    try:
        status, body = _direct_get(url, timeout)
        if 200 <= status < 300 and body:
            return body
        errors.append(f"direct HTTP {status}")
    except Exception as exc:
        errors.append(f"direct {type(exc).__name__}: {exc}")

    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
        if body:
            return body
        errors.append("urllib returned an empty response")
    except Exception as exc:
        errors.append(f"urllib {type(exc).__name__}: {exc}")
    detail = "; ".join(errors[-2:])
    raise RuntimeError(f"GET {url} failed ({detail})")


def fetch_json(url: str, timeout: float = 15) -> Any:
    try:
        return json.loads(fetch_bytes(url, timeout=timeout).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid JSON from {url}: {exc}") from exc


def safe_filename(name: str, fallback: str = "image.jpg") -> str:
    name = os.path.basename(name.split("?", 1)[0]) or fallback
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    return name[:120] or fallback


def fmt_geo(geo: Any) -> str:
    if not isinstance(geo, (list, tuple)) or len(geo) < 2:
        return "未知"
    return f"{float(geo[0]):.4f},{float(geo[1]):.4f}"


def fmt_time(seconds: Any) -> str:
    if seconds is None:
        return "-"
    minutes, secs = divmod(int(seconds), 60)
    return f"{minutes}:{secs:02d}"


def google_maps_link(lat: float, lng: float) -> str:
    return f"https://www.google.com/maps/search/?api=1&query={lat:.6f},{lng:.6f}"


def distance_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance for nearby/reverse filtering."""
    radius = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(min(1.0, a)))
