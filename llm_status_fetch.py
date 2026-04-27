#!/usr/bin/env python3
"""Fetch status for multiple LLM providers (Claude, OpenAI, Gemini).

- Claude: https://status.claude.com (statuspage.io summary.json)
- OpenAI: https://status.openai.com (statuspage.io summary.json)
- Gemini: https://status.cloud.google.com/incidents.json — filtered to
  ongoing incidents whose affected_products include "Gemini".

Output shape (consumed by src/LLMStatus.tsx):
{
  "updatedAt": "...",
  "providers": [
    { "key": "claude",  "label": "Claude",  "indicator": "none|minor|major|...", "description": "..." },
    { "key": "openai",  "label": "OpenAI",  "indicator": "...",                  "description": "..." },
    { "key": "gemini",  "label": "Gemini",  "indicator": "...",                  "description": "..." }
  ]
}

Indicators are normalized to the statuspage.io vocabulary
("none" / "minor" / "major" / "critical") so the widget's pill-class
mapping works uniformly across all three.
"""
from __future__ import annotations
import json
from typing import Any

from widget_helpers import fetch_json, utc_timestamp, safe_main


CLAUDE_SUMMARY = 'https://status.claude.com/api/v2/summary.json'
OPENAI_SUMMARY = 'https://status.openai.com/api/v2/summary.json'
GOOGLE_INCIDENTS = 'https://status.cloud.google.com/incidents.json'


def statuspage_summary(url: str, fallback_label: str) -> dict[str, Any]:
    """Fetch a statuspage.io /api/v2/summary.json endpoint and return a
    normalized provider block."""
    data = fetch_json(url)
    status = data.get('status') or {}
    return {
        'indicator': status.get('indicator') or 'none',
        'description': status.get('description') or fallback_label,
    }


def gemini_status() -> dict[str, Any]:
    """Synthesize a Gemini status pill from Google Cloud's incidents feed.

    Google does not publish a statuspage.io-style /summary.json, so we
    walk the incidents feed and look for ongoing (no `end` timestamp)
    incidents whose affected_products include Gemini. If any are found,
    the highest severity wins; otherwise we report operational."""
    incidents = fetch_json(GOOGLE_INCIDENTS)
    if not isinstance(incidents, list):
        raise RuntimeError('Unexpected incidents.json shape (not a list)')

    ongoing: list[dict[str, Any]] = []
    for inc in incidents:
        if not isinstance(inc, dict):
            continue
        # `end` is the resolution timestamp — missing / null = still active.
        if inc.get('end'):
            continue
        products = inc.get('affected_products') or []
        titles = [
            str(p.get('title', '')).lower()
            for p in products
            if isinstance(p, dict)
        ]
        if any('gemini' in t for t in titles):
            ongoing.append(inc)

    if not ongoing:
        return {'indicator': 'none', 'description': 'All Systems Operational'}

    # status_impact values from Google's feed:
    #   SERVICE_OUTAGE       → critical
    #   SERVICE_DISRUPTION   → major
    #   SERVICE_INFORMATION  → minor
    severity_rank = {
        'SERVICE_OUTAGE': ('critical', 3),
        'SERVICE_DISRUPTION': ('major', 2),
        'SERVICE_INFORMATION': ('minor', 1),
    }
    worst_indicator = 'minor'
    worst_rank = 0
    for inc in ongoing:
        impact = str(inc.get('status_impact') or '').upper()
        indicator, rank = severity_rank.get(impact, ('minor', 1))
        if rank > worst_rank:
            worst_indicator = indicator
            worst_rank = rank

    count = len(ongoing)
    description = f'{count} ongoing incident' + ('' if count == 1 else 's')
    return {'indicator': worst_indicator, 'description': description}


def safe_provider(fn, label: str, *args) -> dict[str, Any]:
    try:
        block = fn(*args)
    except Exception as exc:
        return {
            'label': label,
            'indicator': 'unknown',
            'description': f'Unavailable: {exc}',
        }
    block['label'] = label
    return block


def main() -> None:
    providers = [
        {
            'key': 'claude',
            **safe_provider(statuspage_summary, 'Claude', CLAUDE_SUMMARY, 'Claude'),
        },
        {
            'key': 'openai',
            **safe_provider(statuspage_summary, 'OpenAI', OPENAI_SUMMARY, 'OpenAI'),
        },
        {
            'key': 'gemini',
            **safe_provider(gemini_status, 'Gemini'),
        },
    ]
    print(json.dumps({
        'updatedAt': utc_timestamp(),
        'providers': providers,
    }))


if __name__ == '__main__':
    safe_main(main)
