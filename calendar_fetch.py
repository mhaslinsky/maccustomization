#!/usr/bin/env python3
"""
Calendar events for Übersicht.

Reads calendars via EventKit (fast). Falls back to AppleScript only if the helper
is missing — AppleScript often hits 60–90s+ timeouts on large Calendar databases
even when Automation permissions are correct.

Setup (once, in the widgets folder):
  swiftc calendar_eventkit.swift -o calendar_eventkit -framework EventKit

Übersicht also needs Calendar access: System Settings → Privacy & Security → Calendars
(enable Übersicht). Automation → Calendar may still be used by the slow fallback.

Optional env: ~/.config/calendar-widget.env or widgets/.calendar-widget.env

  CALENDAR_EVENING_HOUR=20
  CALENDAR_FILTER=creditgenie
  CALENDAR_MAX_EVENTS=20
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import shutil
import subprocess
from typing import Any

from widget_helpers import load_local_env, get_env, utc_timestamp, safe_main

WIDGET_DIR = pathlib.Path(__file__).resolve().parent

CONFIG_PATHS = [
    pathlib.Path.home() / '.config' / 'calendar-widget.env',
    pathlib.Path.home() / 'Library' / 'Application Support' / 'Übersicht' / 'widgets' / '.calendar-widget.env',
]

# Slow fallback only (often times out on big libraries).
APPLESCRIPT = r'''
on stripDelims(t)
    if t is missing value then return ""
    set s to t as string
    set AppleScript's text item delimiters to {tab, return, linefeed}
    set parts to text items of s
    set AppleScript's text item delimiters to " "
    return parts as string
end stripDelims

on run argv
    set dayOff to (item 1 of argv) as integer
    tell application "Calendar"
        set base to current date
        set hours of base to 0
        set minutes of base to 0
        set seconds of base to 0
        set ws to base + (dayOff * days)
        set we to ws + (1 * days)
        set linesOut to ""
        repeat with acal in calendars
            try
                try
                    set calName to title of acal
                on error
                    try
                        set calName to name of acal
                    on error
                        set calName to "Calendar"
                    end try
                end try
                set evs to (every event of acal whose start date is greater than or equal to ws and start date is less than we)
                repeat with ev in evs
                    set ad to allday event of ev
                    set sdate to start date of ev
                    set edate to end date of ev
                    set sy to year of sdate
                    set sm to (month of sdate) as integer
                    set sda to day of sdate
                    set sh to hours of sdate
                    set smin to minutes of sdate
                    set ey to year of edate
                    set em to (month of edate) as integer
                    set eda to day of edate
                    set eh to hours of edate
                    set emin to minutes of edate
                    set evTitle to summary of ev
                    if evTitle is missing value then set evTitle to ""
                    set evTitle to stripDelims(evTitle)
                    set calName to stripDelims(calName)
                    set linesOut to linesOut & ad & tab & sy & tab & sm & tab & sda & tab & sh & tab & smin & tab & ey & tab & em & tab & eda & tab & eh & tab & emin & tab & calName & tab & evTitle & return
                end repeat
            end try
        end repeat
        return linesOut
    end tell
end run
'''


def window_datetimes(day_offset: int) -> tuple[dt.datetime, dt.datetime]:
    base = dt.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    start = base + dt.timedelta(days=day_offset)
    end = start + dt.timedelta(days=1)
    return start, end


def run_eventkit(start: dt.datetime, end: dt.datetime, filt: str, timeout: int = 45) -> str:
    ts1 = str(int(start.timestamp()))
    ts2 = str(int(end.timestamp()))
    f = filt or ''

    bin_path = WIDGET_DIR / 'calendar_eventkit'
    swift_src = WIDGET_DIR / 'calendar_eventkit.swift'

    attempts: list[list[str]] = []
    if bin_path.is_file() and os.access(bin_path, os.X_OK):
        attempts.append([str(bin_path), ts1, ts2, f])
    swift_exe = shutil.which('swift')
    if swift_src.is_file() and swift_exe:
        attempts.append([swift_exe, str(swift_src), ts1, ts2, f])

    last_err = 'EventKit helper not found (compile calendar_eventkit.swift; see script header).'
    for cmd in attempts:
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                encoding='utf-8',
                cwd=str(WIDGET_DIR),
            )
        except subprocess.TimeoutExpired:
            last_err = f'EventKit helper timed out after {timeout}s'
            continue
        if proc.returncode == 0:
            return proc.stdout or ''
        err = (proc.stderr or '').strip()
        if 'CALENDAR_ACCESS_DENIED' in err:
            raise RuntimeError(
                'Calendar access denied. System Settings → Privacy & Security → Calendars → enable Übersicht.'
            )
        last_err = err or proc.stdout or f'exit {proc.returncode}'

    raise RuntimeError(last_err)


def run_applescript_fallback(day_offset: int, timeout: int = 25) -> str:
    proc = subprocess.run(
        ['osascript', '-', str(day_offset)],
        input=APPLESCRIPT,
        capture_output=True,
        text=True,
        timeout=timeout,
        encoding='utf-8',
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or 'osascript failed').strip()
        raise RuntimeError(err or 'Calendar script failed')
    return proc.stdout or ''


def fetch_calendar_raw(day_offset: int, filt: str) -> str:
    start, end = window_datetimes(day_offset)
    bin_path = WIDGET_DIR / 'calendar_eventkit'
    swift_src = WIDGET_DIR / 'calendar_eventkit.swift'
    swift_exe = shutil.which('swift')
    can_eventkit = (bin_path.is_file() and os.access(bin_path, os.X_OK)) or (
        swift_src.is_file() and bool(swift_exe)
    )
    # AppleScript often hangs 60s+ on large libraries; only use it if EventKit helper is missing.
    if can_eventkit:
        return run_eventkit(start, end, filt)
    return run_applescript_fallback(day_offset, timeout=25)


def parse_line(line: str) -> dict[str, Any] | None:
    parts = line.split('\t', 12)
    if len(parts) < 13:
        return None
    (
        ad,
        sy,
        sm,
        sda,
        sh,
        smin,
        ey,
        em,
        eda,
        eh,
        emin,
        cal,
        title,
    ) = parts
    try:
        all_day = str(ad).strip().lower() in ('true', 'yes', '1')
        start = dt.datetime(
            int(sy), int(sm), int(sda), int(sh), int(smin), 0
        )
        end = dt.datetime(int(ey), int(em), int(eda), int(eh), int(emin), 0)
    except (TypeError, ValueError):
        return None
    return {
        'allDay': all_day,
        'start': start,
        'end': end,
        'calendar': cal.strip(),
        'title': title.strip() or '(No title)',
    }


def fmt_time(d: dt.datetime) -> str:
    return d.strftime('%I:%M %p').lstrip('0').replace(' 0', ' ')


def event_to_display(ev: dict[str, Any]) -> dict[str, Any]:
    if ev['allDay']:
        time_s = 'All day'
    else:
        time_s = f"{fmt_time(ev['start'])} – {fmt_time(ev['end'])}"
    return {
        'title': ev['title'],
        'calendar': ev['calendar'],
        'time': time_s,
        'start': ev['start'].isoformat(),
        'allDay': ev['allDay'],
    }


def main() -> None:
    local_env = load_local_env(CONFIG_PATHS)
    evening_s = get_env('CALENDAR_EVENING_HOUR', local_env) or '20'
    try:
        evening_h = max(0, min(23, int(evening_s)))
    except ValueError:
        evening_h = 20

    filt = (get_env('CALENDAR_FILTER', local_env) or '').strip().lower()
    max_n_s = get_env('CALENDAR_MAX_EVENTS', local_env) or '20'
    try:
        max_n = max(1, min(50, int(max_n_s)))
    except ValueError:
        max_n = 20

    def day_heading(d: dt.date) -> str:
        return f"{d.strftime('%A')}, {d.strftime('%b')} {d.day}"

    now = dt.datetime.now()
    if now.hour < evening_h:
        day_offset = 0
        focus = 'today'
        focus_label = day_heading(now.date())
    else:
        day_offset = 1
        tomorrow = now.date() + dt.timedelta(days=1)
        focus = 'tomorrow'
        focus_label = day_heading(tomorrow)

    result: dict[str, Any] = {
        'updatedAt': utc_timestamp(),
        'focus': focus,
        'focusLabel': focus_label,
        'eveningHour': evening_h,
        'events': [],
        'error': None,
        'hint': None,
    }

    try:
        raw = fetch_calendar_raw(day_offset, filt)
    except Exception as exc:
        msg = str(exc)
        result['error'] = msg
        low = msg.lower()
        if 'access denied' in low:
            result['hint'] = 'Open System Settings → Privacy & Security → Calendars and enable Übersicht.'
        elif 'timed out' in low or 'eventkit helper not found' in low:
            result['hint'] = (
                'Compile the fast reader: swiftc calendar_eventkit.swift -o calendar_eventkit -framework EventKit'
            )
        else:
            result['hint'] = (
                'Prefer EventKit (see calendar_fetch.py header). AppleScript often times out on large calendars.'
            )
        print(json.dumps(result))
        return

    events: list[dict[str, Any]] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        ev = parse_line(line)
        if ev is None:
            continue
        if filt and filt not in ev['calendar'].lower():
            continue
        if day_offset == 0 and not ev['allDay'] and ev['start'] < now:
            continue
        events.append(ev)

    events.sort(key=lambda e: (0 if e['allDay'] else 1, e['start'], e['title']))

    # Same holiday often appears on multiple subscribed calendars (e.g. two “US Holidays”).
    seen_keys: set[tuple[Any, ...]] = set()
    deduped: list[dict[str, Any]] = []
    for e in events:
        day_or_start = e['start'].date() if e['allDay'] else e['start']
        key = (day_or_start, e['allDay'], e['title'].strip().lower())
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(e)

    result['events'] = [event_to_display(e) for e in deduped[:max_n]]
    print(json.dumps(result))


if __name__ == '__main__':
    safe_main(main)
