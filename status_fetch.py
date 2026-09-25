#!/usr/bin/env python3
"""Fetch status for the developer-tool feeds the Status widget aggregates.

- Claude: https://status.claude.com (statuspage.io summary.json)
- OpenAI: https://status.openai.com (statuspage.io summary.json)
- Gemini: https://status.cloud.google.com/incidents.json — filtered to
  ongoing incidents whose affected_products include "Gemini".
- GitHub: https://www.githubstatus.com (statuspage.io summary.json)
- Linear: https://linearstatus.com (statuspage.io summary.json)
- OpenRouter: https://status.openrouter.ai — an OnlineOrNot page with no JSON
  API of any kind, so the overall banner is scraped out of the SSR'd HTML.
- Meta AI: https://api.meta.ai/v1/status — the public JSON feed behind the
  Model API console's status page. No API key required.
- DeepSeek: https://status.deepseek.com, a Flashcat page whose JSON API lists
  open incidents.
- Grok (xAI): https://status.x.ai/feed.xml, the site's RSS incident feed.

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
mapping works uniformly across all providers.

Why Grok reads RSS rather than JSON:
  xAI's per-region JSON at data.x.ai/status/*.json, and every status.x.ai page
  (including /grok-build), sit behind Cloudflare and 403 any non-browser client.
  Cloudflare screens TLS fingerprints, so a spoofed User-Agent does not help.
  The RSS feed at status.x.ai/feed.xml is the only path it lets through
  (verified 2026-09-25).
"""
from __future__ import annotations
import concurrent.futures as cf
import json
import re
import xml.etree.ElementTree as ET
from typing import Any

from widget_helpers import fetch_json, fetch_text, utc_timestamp, safe_main


CLAUDE_SUMMARY = 'https://status.claude.com/api/v2/summary.json'
OPENAI_SUMMARY = 'https://status.openai.com/api/v2/summary.json'
GOOGLE_INCIDENTS = 'https://status.cloud.google.com/incidents.json'
GITHUB_SUMMARY = 'https://www.githubstatus.com/api/v2/summary.json'
LINEAR_SUMMARY = 'https://linearstatus.com/api/v2/summary.json'
OPENROUTER_PAGE = 'https://status.openrouter.ai/'

# Full incident history for every xAI service (API regions, grok.com, the apps,
# Grok Build), newest first; resolved incidents stay in it.
XAI_FEED = 'https://status.x.ai/feed.xml'

# The real feed behind the console's "Model API Status" page. Public — needs no
# API key (verified: identical payload with no key and with a bogus one), so the
# widget holds no Meta credential. NOT api.llama.com: that is the retired Llama
# API, a different product, and its 401 means "dead host", not "needs a key".
META_STATUS = 'https://api.meta.ai/v1/status'

# Moonshot (Kimi) and MiniMax publish real statuspage.io feeds — no special
# handling needed, statuspage_summary reads them as-is.
MOONSHOT_SUMMARY = 'https://status.moonshot.cn/api/v2/summary.json'
MINIMAX_SUMMARY = 'https://status.minimax.io/api/v2/summary.json'

# DeepSeek's status page runs on Flashcat, and its front end reads this endpoint
# for open incidents. The number is DeepSeek's Flashcat page ID, taken
# from the page's own payload (the url_name "deepseek" is rejected with HTTP 400).
# Unreachable from outside China until at least 2026-07-14; reachable 2026-09-25.
DEEPSEEK_ACTIVE = 'https://status.deepseek.com/api/status-page/6410630422455/summary/active'

# Providers with no status feed get no pill. Removed for that reason:
#   GLM (Zhipu), 2026-07-14: no status page at all (status.bigmodel.cn 301s to
#     the Zhipu homepage; zhipuai.statuspage.io is a marketing shell).
#   Qwen, 2026-09-25: no Qwen-specific status host (status.qwen.ai does not
#     resolve), only Alibaba Cloud's page covering every cloud service.
# Don't re-add either without a real feed.

# Public dashboards for click-through when a provider reports an issue.
CLAUDE_DASHBOARD = 'https://status.claude.com'
OPENAI_DASHBOARD = 'https://status.openai.com'
GEMINI_DASHBOARD = 'https://status.cloud.google.com'
GITHUB_DASHBOARD = 'https://www.githubstatus.com'
LINEAR_DASHBOARD = 'https://linearstatus.com'
OPENROUTER_DASHBOARD = 'https://status.openrouter.ai'
XAI_DASHBOARD = 'https://status.x.ai'
META_DASHBOARD = 'https://ai.developer.meta.com/status/'
MOONSHOT_DASHBOARD = 'https://status.moonshot.cn'
MINIMAX_DASHBOARD = 'https://status.minimax.io'
DEEPSEEK_DASHBOARD = 'https://status.deepseek.com'


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
    up.

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


# Flashcat's per-component vocabulary, mapped onto statuspage.io's, with a rank
# so the worst affected component wins. These four are the values DeepSeek's
# incident history has used.
FLASHCAT_COMPONENT_STATUS = {
    'operational': ('none', 0),
    'degraded': ('minor', 1),
    'partial_outage': ('major', 2),
    'full_outage': ('critical', 3),
}


def deepseek_status() -> dict[str, Any]:
    """DeepSeek status from the open incidents on its Flashcat page.

    An empty active_changes list means nothing is open; otherwise the worst
    affected component wins. An open incident never reports better than
    'minor', even with an unrecognized status value or no component marked down
    yet: it is still a declared incident and must not render as operational.
    """
    data = fetch_json(DEEPSEEK_ACTIVE, timeout=10)
    payload = data.get('data') if isinstance(data, dict) else None
    active = payload.get('active_changes') if isinstance(payload, dict) else None
    if not isinstance(active, list):
        raise RuntimeError(f'Unexpected summary/active shape: {str(data)[:200]}')

    if not active:
        return {'indicator': 'none', 'description': 'All Systems Operational'}

    worst_indicator, worst_rank = 'minor', 1
    for change in active:
        components = change.get('affected_components') if isinstance(change, dict) else None
        for component in components or []:
            if not isinstance(component, dict):
                continue
            status = str(component.get('status') or '').lower()
            indicator, rank = FLASHCAT_COMPONENT_STATUS.get(status, ('minor', 1))
            if rank > worst_rank:
                worst_indicator, worst_rank = indicator, rank

    count = len(active)
    description = f'{count} ongoing incident' + ('' if count == 1 else 's')
    return {'indicator': worst_indicator, 'description': description}


# xAI's per-incident severity. Only 'available' has been observed (every item in
# the feed on 2026-09-25 was resolved), so the other values are matched by
# keyword, first match wins ('partial' precedes 'outage' so partial_outage is
# major); anything unrecognized falls back to 'minor'.
XAI_SEVERITY_KEYWORDS = [
    ('partial', 'major', 2),
    ('unavailable', 'critical', 3),
    ('outage', 'critical', 3),
    ('down', 'critical', 3),
    ('degrad', 'minor', 1),
]
XAI_STATUS_LINE = re.compile(r'Status:\s*([A-Za-z_ ]+?)\s*<')
XAI_SEVERITY_LINE = re.compile(r'Severity:\s*([A-Za-z_ ]+?)\s*<')


def grok_status() -> dict[str, Any]:
    """Grok status from the status.x.ai RSS incidents not yet RESOLVED.

    Each item's HTML description opens with "Status: RESOLVED" (or another
    state) and "Severity: <value>". An item without a Status line, or a feed
    with no items, means the format changed: that raises rather than reading as
    an all-clear. As with DeepSeek, an open incident never reports better than
    'minor'.
    """
    channel = ET.fromstring(fetch_text(XAI_FEED, timeout=10)).find('channel')
    items = channel.findall('item') if channel is not None else []
    if not items:
        raise RuntimeError('No items in feed.xml (format changed?)')

    open_severities: list[str] = []
    for item in items:
        description = item.findtext('description') or ''
        status = XAI_STATUS_LINE.search(description)
        if status is None:
            raise RuntimeError(f'No Status line in feed item {item.findtext("guid")!r}')
        if status.group(1).strip().upper() != 'RESOLVED':
            severity = XAI_SEVERITY_LINE.search(description)
            open_severities.append(severity.group(1).strip().lower() if severity else '')

    if not open_severities:
        return {'indicator': 'none', 'description': 'All Systems Operational'}

    worst_indicator, worst_rank = 'minor', 1
    for severity in open_severities:
        for keyword, indicator, rank in XAI_SEVERITY_KEYWORDS:
            if keyword in severity:
                if rank > worst_rank:
                    worst_indicator, worst_rank = indicator, rank
                break

    count = len(open_severities)
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


# The panel, in render order. Each entry: (key, group, label, dashboard URL,
# fetch fn, *fn args). Kept as a table rather than hand-written dict literals
# so adding a provider is one line and the parallel fetch below stays generic.
PROVIDERS = [
    # Moonshot and MiniMax
    # publish genuine statuspage.io feeds (with "Kimi" and "Large Language
    # Models (LLM)" components respectively), so they need no special handling.
    ('claude', 'ai', 'Claude', CLAUDE_DASHBOARD, statuspage_summary, CLAUDE_SUMMARY, 'Claude'),
    ('openai', 'ai', 'OpenAI', OPENAI_DASHBOARD, statuspage_summary, OPENAI_SUMMARY, 'OpenAI'),
    ('gemini', 'ai', 'Gemini', GEMINI_DASHBOARD, gemini_status),
    ('meta', 'ai', 'Meta AI', META_DASHBOARD, meta_status),
    ('openrouter', 'ai', 'OpenRouter', OPENROUTER_DASHBOARD, openrouter_status),
    ('kimi', 'ai', 'Kimi', MOONSHOT_DASHBOARD, statuspage_summary, MOONSHOT_SUMMARY, 'Kimi'),
    ('minimax', 'ai', 'MiniMax', MINIMAX_DASHBOARD, statuspage_summary, MINIMAX_SUMMARY, 'MiniMax'),
    ('deepseek', 'ai', 'DeepSeek', DEEPSEEK_DASHBOARD, deepseek_status),
    ('grok', 'ai', 'Grok', XAI_DASHBOARD, grok_status),

    ('github', 'dev', 'GitHub', GITHUB_DASHBOARD, statuspage_summary, GITHUB_SUMMARY, 'GitHub'),
    ('linear', 'dev', 'Linear', LINEAR_DASHBOARD, statuspage_summary, LINEAR_SUMMARY, 'Linear'),
]


def main() -> None:
    # Fetch in parallel. Sequentially, eleven providers, some on Chinese
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
