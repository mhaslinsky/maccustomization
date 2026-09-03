"""Shared utilities for Übersicht widget Python backends."""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import ssl
import traceback
import urllib.request
from typing import Any

ADGUARD_CA = pathlib.Path.home() / 'Library/Application Support/adguard-cli/SSL/AdGuard CLI CA.cer'


def load_local_env(config_paths: list[pathlib.Path]) -> dict[str, str]:
    """Read dotenv-style config files, returning merged key-value pairs."""
    values: dict[str, str] = {}
    for path in config_paths:
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def get_env(name: str, local_env: dict[str, str]) -> str | None:
    """Get env var from process environment or local_env, stripping control chars."""
    value = os.environ.get(name) or local_env.get(name)
    if value is None:
        return None
    return ''.join(ch for ch in value if ch.isprintable() and ch not in '\r\n\t')


def tls_context() -> ssl.SSLContext:
    """Return the system trust store, plus the local AdGuard CA when installed.

    urllib picks up the macOS system proxy, so an AdGuard HTTPS-filtering proxy
    re-signs every host outside its exclusion list. OpenSSL does not read the
    login keychain that already trusts that CA, so verification fails and the
    widget renders the SSL error as a provider outage. load_verify_locations is
    additive, so a machine without AdGuard still gets the default roots.
    """
    context = ssl.create_default_context()
    if ADGUARD_CA.exists():
        context.load_verify_locations(cadata=ADGUARD_CA.read_bytes())
    return context


def fetch_text(url: str, headers: dict[str, str] | None = None, timeout: int = 20) -> str:
    """Fetch URL and return decoded text."""
    req = urllib.request.Request(url, headers=headers or {'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=timeout, context=tls_context()) as response:
        return response.read().decode('utf-8', errors='ignore')


def fetch_json(url: str, headers: dict[str, str] | None = None, timeout: int = 20) -> Any:
    """Fetch URL and return parsed JSON."""
    return json.loads(fetch_text(url, headers=headers, timeout=timeout))


def utc_timestamp() -> str:
    """Return current UTC time as ISO 8601 string with Z suffix."""
    return dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def safe_main(main_func: Any) -> None:
    """Wrapper ensuring JSON output even on unexpected crashes."""
    try:
        main_func()
    except Exception:
        print(json.dumps({
            'error': traceback.format_exc(),
        }))
