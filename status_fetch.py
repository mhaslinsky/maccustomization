#!/usr/bin/env python3
"""Fetch status for the developer-tool feeds the Status widget aggregates.

- Claude: https://status.claude.com (statuspage.io summary.json)
- OpenAI: https://status.openai.com (statuspage.io summary.json)
- Gemini: https://status.cloud.google.com/incidents.json — filtered to
  ongoing incidents whose affected_products include "Gemini".
- GitHub: https://www.githubstatus.com (statuspage.io summary.json)
- Jira:   https://jira-software.status.atlassian.com (statuspage.io summary.json)
- OpenRouter: https://status.openrouter.ai — an OnlineOrNot page with no JSON
  API of any kind, so the overall banner is scraped out of the SSR'd HTML.
- Meta AI: https://api.meta.ai/v1/status — the public JSON feed behind the
  Model API console's status page. No API key required.
- Grok (xAI): LIVENESS PROBE ONLY — see below.

Output shape (consumed by src/Status.tsx):
{
  "updatedAt": "...",
  "providers": [
    { "key": "claude",  "label": "Claude",  "indicator": "none|minor|major|...", "description": "..." },
    { "key": "openai",  ... },
    ...
  ]
}

Indicators are normalized to the statuspage.io vocabulary
("none" / "minor" / "major" / "critical") so the widget's pill-class
mapping works uniformly across all providers, plus one extra value:

  "reachable" — the provider has NO usable status feed and all we know is
  that its API host answered. It renders green but keeps its own wording
  ("API reachable"), because collapsing it to "Operational" would be a lie:
  a liveness probe cannot see a declared incident or a degradation.

Why Grok is a probe rather than a feed:
  xAI publishes real per-region data at data.x.ai/status/*.json, but that host
  sits behind Cloudflare and 403s any non-browser client (it screens on TLS
  fingerprint, so a spoofed User-Agent does not help). urllib cannot reach it,
  so there is nothing to parse. Do not retry this — it has been tried.
"""
from __future__ import annotations
import concurrent.futures as cf
import json
import re
import urllib.error
from typing import Any

from widget_helpers import fetch_json, fetch_text, utc_timestamp, safe_main


CLAUDE_SUMMARY = 'https://status.claude.com/api/v2/summary.json'
OPENAI_SUMMARY = 'https://status.openai.com/api/v2/summary.json'
GOOGLE_INCIDENTS = 'https://status.cloud.google.com/incidents.json'
GITHUB_SUMMARY = 'https://www.githubstatus.com/api/v2/summary.json'
JIRA_SUMMARY = 'https://jira-software.status.atlassian.com/api/v2/summary.json'
OPENROUTER_PAGE = 'https://status.openrouter.ai/'

# xAI has no reachable status feed, so we settle for "did the host answer".
# 401 unauthenticated is a fine signal for that — see probe_liveness.
XAI_PROBE = 'https://api.x.ai/v1/models'

# The real feed behind the console's "Model API Status" page. Public — needs no
# API key (verified: identical payload with no key and with a bogus one), so the
# widget holds no Meta credential. NOT api.llama.com: that is the retired Llama
# API, a different product, and its 401 means "dead host", not "needs a key".
META_STATUS = 'https://api.meta.ai/v1/status'

# Moonshot (Kimi) and MiniMax publish real statuspage.io feeds — no special
# handling needed, statuspage_summary reads them as-is.
MOONSHOT_SUMMARY = 'https://status.moonshot.cn/api/v2/summary.json'
MINIMAX_SUMMARY = 'https://status.minimax.io/api/v2/summary.json'

# No reachable status feed — liveness probes only. Both return 401
# unauthenticated, which is the "host is answering" signal probe_liveness wants.
# A probe pill earns its place only when its click-through lands on a real
# status page a human can read; both of these do.
#   DeepSeek: status.deepseek.com resolves to statuspage.flashcat.cloud, a
#     Beijing Alibaba NLB. The TLS handshake never completes from outside China
#     (connection reset), so there is nothing to fetch — not a bot wall, just
#     unreachable. Do not retry.
#   Qwen: no Qwen-specific feed. Alibaba Cloud's page covers every cloud service
#     and is not a statuspage.io feed (302), but it is at least a page worth
#     opening when something looks wrong.
#
# GLM (Zhipu) was probed and REMOVED on 2026-07-14: it publishes no status page
# at all (status.bigmodel.cn 301s to the Zhipu homepage; zhipuai.statuspage.io
# is a statuspage.io marketing shell, not a real page). An unverifiable green
# pill whose link goes nowhere useful is worse than no pill. Don't re-add it
# without a real feed.
DEEPSEEK_PROBE = 'https://api.deepseek.com/v1/models'
QWEN_PROBE = 'https://dashscope.aliyuncs.com/compatible-mode/v1/models'

# Public dashboards for click-through when a provider reports an issue.
CLAUDE_DASHBOARD = 'https://status.claude.com'
OPENAI_DASHBOARD = 'https://status.openai.com'
GEMINI_DASHBOARD = 'https://status.cloud.google.com'
GITHUB_DASHBOARD = 'https://www.githubstatus.com'
JIRA_DASHBOARD = 'https://jira-software.status.atlassian.com'
OPENROUTER_DASHBOARD = 'https://status.openrouter.ai'
XAI_DASHBOARD = 'https://status.x.ai'
META_DASHBOARD = 'https://ai.developer.meta.com/status/'
MOONSHOT_DASHBOARD = 'https://status.moonshot.cn'
MINIMAX_DASHBOARD = 'https://status.minimax.io'
DEEPSEEK_DASHBOARD = 'https://status.deepseek.com'
QWEN_DASHBOARD = 'https://status.alibabacloud.com'


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


# OnlineOrNot renders exactly one of these phrases as the overall banner.
# Ordered worst-first so a page showing several never reports the mildest.
OPENROUTER_BANNERS = [
    ('Major Outage', 'critical'),
    ('Partial Outage', 'major'),
    ('Degraded Performance', 'minor'),
    ('Under Maintenance', 'minor'),
    ('All Systems Operational', 'none'),
]


def openrouter_status() -> dict[str, Any]:
    """Scrape OpenRouter's overall status banner out of its SSR'd HTML.

    status.openrouter.ai is an OnlineOrNot page: no /api/v2/summary.json, no
    /summary.json, and the embedded react-router payload is an index-encoded
    turbo-stream that is far more brittle to parse than the banner text. The
    page is server-rendered and not bot-walled, so the phrase is right there.

    Matching on the phrase rather than the element's Tailwind classes keeps
    this alive across a restyle; a class-list match would not survive one.
    """
    html = fetch_text(OPENROUTER_PAGE)
    for phrase, indicator in OPENROUTER_BANNERS:
        if re.search(r'>\s*' + re.escape(phrase), html):
            description = 'All Systems Operational' if indicator == 'none' else phrase
            return {'indicator': indicator, 'description': description}

    # No known banner matched. The page format changed, or we got served
    # something other than the status page. That is NOT an all-clear — an
    # unparseable page must never render as operational.
    raise RuntimeError('No known status banner found (page format changed?)')


def probe_liveness(url: str) -> dict[str, Any]:
    """Report whether a provider's API host is answering at all.

    This is the fallback for providers with no machine-readable status feed.
    It is deliberately weak, and the wording it returns says so.

    An HTTP response — including 401/403/404 — means the host is up and
    serving; we have no credentials and do not need them, since the question
    is only "is anyone home". A 5xx means the host is up but broken. A
    transport failure (DNS, refused, timeout) means it is unreachable.

    What this CANNOT see: declared incidents, elevated latency, a partial
    region outage, or a model-tier degradation. The host answers 401 through
    all of them. Hence indicator 'reachable' rather than 'none' — the widget
    renders it green but keeps the honest label instead of the word
    "Operational".
    """
    try:
        fetch_text(url, timeout=10)
    except urllib.error.HTTPError as exc:
        if exc.code >= 500:
            return {'indicator': 'major', 'description': f'API error (HTTP {exc.code})'}
        # 4xx: the host answered. That is the signal we came for.
        return {'indicator': 'reachable', 'description': 'API reachable'}
    except Exception as exc:
        return {'indicator': 'critical', 'description': f'Unreachable: {exc}'}
    return {'indicator': 'reachable', 'description': 'API reachable'}


# Meta's service_status vocabulary, mapped onto the statuspage.io one.
META_SERVICE_STATUS = {
    'operational': 'none',
    'degraded': 'minor',
    'partial_outage': 'major',
    'major_outage': 'critical',
    'maintenance': 'minor',
}


def meta_status() -> dict[str, Any]:
    """Meta AI status from api.meta.ai/v1/status — the feed behind the console.

    Shape: {"is_alive": bool, "service_status": "operational", "service_message":
    "", "updated_at": "", "model_statuses": []}

    This is a real status feed, not a liveness ping: it can report a degradation
    and can flag an individual model (e.g. muse-spark-1.1) while the host stays
    up. So it gets a normal indicator rather than the 'reachable' fallback used
    for Grok.

    Only the non-operational vocabulary beyond "operational" is inferred — Meta
    documents no enum, and the live feed has only ever returned "operational".
    An unrecognized value therefore reports 'unknown' (a red pill naming the
    value) rather than being assumed benign.
    """
    data = fetch_json(META_STATUS, timeout=10)
    if not isinstance(data, dict):
        raise RuntimeError(f'Unexpected /v1/status shape: {data!r}')

    if data.get('is_alive') is False:
        return {'indicator': 'critical', 'description': 'API reports not alive'}

    service_status = str(data.get('service_status') or '').lower()
    if service_status not in META_SERVICE_STATUS:
        raise RuntimeError(f'Unrecognized service_status: {service_status!r}')
    indicator = META_SERVICE_STATUS[service_status]

    # model_statuses carries per-model health. It is empty while everything is
    # fine, so treat any entry that is not explicitly operational as a problem
    # worth surfacing — a healthy service with a dead model is still a dead
    # model, and the overall service_status does not necessarily reflect it.
    degraded_models = [
        str(entry.get('model') or entry.get('id') or 'model')
        for entry in (data.get('model_statuses') or [])
        if isinstance(entry, dict)
        and str(entry.get('status') or '').lower() not in ('operational', '')
    ]

    message = str(data.get('service_message') or '').strip()

    if degraded_models:
        if indicator == 'none':
            indicator = 'minor'
        return {'indicator': indicator, 'description': message or f'Degraded: {", ".join(degraded_models)}'}

    if indicator == 'none':
        return {'indicator': 'none', 'description': message or 'All Systems Operational'}
    return {'indicator': indicator, 'description': message or service_status.replace('_', ' ').title()}


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


# The panel, in render order. Each entry: (key, group, label, dashboard URL,
# fetch fn, *fn args). Kept as a table rather than 13 hand-written dict literals
# so adding a provider is one line and the parallel fetch below stays generic.
PROVIDERS = [
    # Real status feeds first — these pills mean something. Moonshot and MiniMax
    # publish genuine statuspage.io feeds (with "Kimi" and "Large Language
    # Models (LLM)" components respectively), so they need no special handling.
    ('claude', 'ai', 'Claude', CLAUDE_DASHBOARD, statuspage_summary, CLAUDE_SUMMARY, 'Claude'),
    ('openai', 'ai', 'OpenAI', OPENAI_DASHBOARD, statuspage_summary, OPENAI_SUMMARY, 'OpenAI'),
    ('gemini', 'ai', 'Gemini', GEMINI_DASHBOARD, gemini_status),
    ('meta', 'ai', 'Meta AI', META_DASHBOARD, meta_status),
    ('openrouter', 'ai', 'OpenRouter', OPENROUTER_DASHBOARD, openrouter_status),
    ('kimi', 'ai', 'Kimi', MOONSHOT_DASHBOARD, statuspage_summary, MOONSHOT_SUMMARY, 'Kimi'),
    ('minimax', 'ai', 'MiniMax', MINIMAX_DASHBOARD, statuspage_summary, MINIMAX_SUMMARY, 'MiniMax'),

    # Then the liveness probes, kept together so the weaker "API reachable"
    # signal reads as one block rather than salting the verified rows. These
    # have no feed we can reach (see the probe constants above); the pill is
    # honest about that, and each links to a status page worth opening.
    ('grok', 'ai', 'Grok', XAI_DASHBOARD, probe_liveness, XAI_PROBE),
    ('deepseek', 'ai', 'DeepSeek', DEEPSEEK_DASHBOARD, probe_liveness, DEEPSEEK_PROBE),
    ('qwen', 'ai', 'Qwen', QWEN_DASHBOARD, probe_liveness, QWEN_PROBE),

    ('github', 'dev', 'GitHub', GITHUB_DASHBOARD, statuspage_summary, GITHUB_SUMMARY, 'GitHub'),
    ('jira', 'dev', 'Jira', JIRA_DASHBOARD, statuspage_summary, JIRA_SUMMARY, 'Jira'),
]


def main() -> None:
    # Fetch in parallel. Sequentially, 13 providers — three of them on Chinese
    # hosts that can hang until the timeout — could take longer than the widget's
    # 120s refresh interval and stack up processes. Fan out instead: the run now
    # costs roughly the slowest single provider, not the sum of all of them.
    # I/O-bound, so threads are the right tool despite the GIL.
    with cf.ThreadPoolExecutor(max_workers=len(PROVIDERS)) as pool:
        futures = {
            key: pool.submit(safe_provider, fn, label, *args)
            for key, _group, label, _url, fn, *args in PROVIDERS
        }
        # safe_provider swallows per-provider failures into an 'unknown' block,
        # so one dead feed cannot take out the panel.
        blocks = {key: future.result() for key, future in futures.items()}

    providers = [
        {'key': key, 'group': group, 'url': url, **blocks[key]}
        for key, group, _label, url, _fn, *_args in PROVIDERS
    ]
    print(json.dumps({
        'updatedAt': utc_timestamp(),
        'providers': providers,
    }))


if __name__ == '__main__':
    safe_main(main)
