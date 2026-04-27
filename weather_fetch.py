#!/usr/bin/env python3
"""
Weather data for Übersicht widget.
Optional env file (~/.config/weather-widget.env or widgets/.weather-widget.env):

  LAT=40.7128
  LON=-74.0060
  LOCATION_LABEL=New York, NY

  # Or search by place name:
  LOCATION_QUERY=Buffalo, NY

Priority in the widget: LAT+LON > LOCATION_QUERY > Übersicht geolocation (Mac Location
Services). When nothing is configured in env, weather uses the default ZIP below (approx.
coordinates). Use --source to print env|geo for the JSX command.
"""
from __future__ import annotations

import json
import sys
import pathlib
import urllib.parse
from typing import Any

from widget_helpers import load_local_env, get_env, fetch_json, utc_timestamp, safe_main

CONFIG_PATHS = [
    pathlib.Path.home() / '.config' / 'weather-widget.env',
    pathlib.Path.home() / 'Library' / 'Application Support' / 'Übersicht' / 'widgets' / '.weather-widget.env',
]

# Default when env has no LAT/LON/LOCATION_QUERY (Open-Meteo matches "19444" to Spain; use coords for US 19444).
DEFAULT_ZIP_LABEL = 'Blue Bell, PA'
DEFAULT_ZIP_LAT = '40.1995'
DEFAULT_ZIP_LON = '-75.5838'

OPEN_METEO = 'https://api.open-meteo.com/v1/forecast'
OPEN_METEO_GEO = 'https://geocoding-api.open-meteo.com/v1/search'

# For LOCATION_QUERY="City, ST" — Open-Meteo rejects commas in `name`; map ST -> admin1.
US_STATES: dict[str, str] = {
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
    'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
    'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
    'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
    'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
    'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire',
    'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina',
    'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania',
    'RI': 'Rhode Island', 'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee',
    'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington',
    'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia',
}


def wmo_condition(code: int | float | None) -> str:
    c = int(code) if code is not None else -1
    if c == 0:
        return 'Clear sky'
    if c in (1, 2, 3):
        return ('Mainly clear', 'Partly cloudy', 'Overcast')[c - 1]
    if c in (45, 48):
        return 'Fog'
    if 51 <= c <= 55:
        return 'Drizzle'
    if 56 <= c <= 57:
        return 'Freezing drizzle'
    if 61 <= c <= 65:
        return 'Rain'
    if 66 <= c <= 67:
        return 'Freezing rain'
    if 71 <= c <= 75:
        return 'Snow'
    if c == 77:
        return 'Snow grains'
    if 80 <= c <= 82:
        return 'Rain showers'
    if 85 <= c <= 86:
        return 'Snow showers'
    if c == 95:
        return 'Thunderstorm'
    if c in (96, 99):
        return 'Thunderstorm with hail'
    return 'Unknown'


def fetch_location_fixed(lat_s: str, lon_s: str, label: str | None) -> dict[str, Any]:
    lat = float(lat_s)
    lon = float(lon_s)
    return {
        'source': 'fixed',
        'label': (label or '').strip() or f'{lat:.4f}, {lon:.4f}',
        'latitude': lat,
        'longitude': lon,
    }


def reverse_geocode(lat: float, lon: float) -> str:
    """Use Nominatim to find the nearest city/state for coordinates."""
    params = urllib.parse.urlencode({
        'lat': lat,
        'lon': lon,
        'format': 'json',
        'zoom': '10',
    })
    url = f'https://nominatim.openstreetmap.org/reverse?{params}'
    headers = {'User-Agent': 'UebersichtWeatherWidget/1.0'}
    try:
        data = fetch_json(url, headers=headers, timeout=10)
        addr = data.get('address', {})
        city = addr.get('city') or addr.get('town') or addr.get('village') or ''
        state = addr.get('state') or ''
        parts = [p.strip() for p in (city, state) if p.strip()]
        if parts:
            return ', '.join(parts)
    except Exception:
        pass
    return f'{lat:.4f}, {lon:.4f}'


def _norm(s: str) -> str:
    return ' '.join(s.lower().split())


def fetch_location_geocode(query: str) -> dict[str, Any]:
    q = query.strip()
    if not q:
        raise RuntimeError('LOCATION_QUERY is empty')

    city_part = q
    admin1_target: str | None = None
    country_code: str | None = None

    if ',' in q:
        parts = [p.strip() for p in q.split(',')]
        if len(parts) >= 2 and parts[0]:
            city_part = parts[0]
            region = parts[1]
            if len(region) == 2 and region.upper() in US_STATES:
                admin1_target = US_STATES[region.upper()]
                country_code = 'US'
            elif _norm(region) in {_norm(v) for v in US_STATES.values()}:
                admin1_target = next(
                    v for v in US_STATES.values() if _norm(v) == _norm(region)
                )
                country_code = 'US'

    geo_params: dict[str, str] = {
        'name': city_part,
        'count': '20',
        'language': 'en',
        'format': 'json',
    }
    if country_code:
        geo_params['countryCode'] = country_code

    params = urllib.parse.urlencode(geo_params)
    url = f'{OPEN_METEO_GEO}?{params}'
    data = fetch_json(url, timeout=25)
    results = data.get('results') or []
    if not results:
        raise RuntimeError(f'No place found for "{q}"')

    hit: dict[str, Any] | None = None
    if admin1_target:
        want = _norm(admin1_target)
        for row in results:
            a1 = (row.get('admin1') or '').strip()
            if a1 and _norm(a1) == want:
                hit = row
                break
    if hit is None:
        hit = results[0]

    lat = hit.get('latitude')
    lon = hit.get('longitude')
    if lat is None or lon is None:
        raise RuntimeError('Geocoder returned no coordinates')
    name = (hit.get('name') or '').strip()
    admin1 = (hit.get('admin1') or '').strip()
    country = (hit.get('country') or '').strip()
    parts = [p for p in (name, admin1, country) if p]
    label = ', '.join(parts) if parts else q
    return {
        'source': 'geocode',
        'label': label,
        'latitude': float(lat),
        'longitude': float(lon),
        'query': q,
    }


def fetch_weather(lat: float, lon: float) -> dict[str, Any]:
    params = (
        f'latitude={lat}&longitude={lon}'
        '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,'
        'wind_speed_10m,is_day'
        '&timezone=auto'
        '&temperature_unit=fahrenheit'
        '&wind_speed_unit=mph'
    )
    url = f'{OPEN_METEO}?{params}'
    data = fetch_json(url, timeout=25)
    current = data.get('current') or {}
    code = current.get('weather_code')
    return {
        'temperatureF': current.get('temperature_2m'),
        'apparentTemperatureF': current.get('apparent_temperature'),
        'relativeHumidity': current.get('relative_humidity_2m'),
        'weatherCode': code,
        'condition': wmo_condition(code),
        'windSpeedMph': current.get('wind_speed_10m'),
        'isDay': current.get('is_day'),
        'time': current.get('time'),
    }


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == '--source':
        local_env = load_local_env(CONFIG_PATHS)
        if (get_env('LAT', local_env) and get_env('LON', local_env)) or get_env(
            'LOCATION_QUERY', local_env
        ):
            print('env')
        else:
            print('geo')
        return

    # --geo LAT LON [LABEL] — called by the widget with device geolocation coords
    if len(sys.argv) >= 4 and sys.argv[1] == '--geo':
        geo_lat = sys.argv[2]
        geo_lon = sys.argv[3]
        geo_label = sys.argv[4] if len(sys.argv) > 4 else None
        result: dict[str, Any] = {'updatedAt': utc_timestamp()}
        lat_f, lon_f = float(geo_lat), float(geo_lon)
        label = geo_label or reverse_geocode(lat_f, lon_f)
        result['location'] = {
            'source': 'geolocation',
            'label': label,
            'latitude': lat_f,
            'longitude': lon_f,
        }
        try:
            result['current'] = fetch_weather(float(geo_lat), float(geo_lon))
        except Exception as exc:
            result['weatherError'] = str(exc)
            result['error'] = str(exc)
        print(json.dumps(result))
        return

    local_env = load_local_env(CONFIG_PATHS)
    lat_s = get_env('LAT', local_env)
    lon_s = get_env('LON', local_env)
    label_opt = get_env('LOCATION_LABEL', local_env)
    location_query = get_env('LOCATION_QUERY', local_env)

    result2: dict[str, Any] = {
        'updatedAt': utc_timestamp(),
    }

    try:
        if lat_s and lon_s:
            result2['location'] = fetch_location_fixed(lat_s, lon_s, label_opt)
        elif location_query:
            result2['location'] = fetch_location_geocode(location_query)
        else:
            result2['location'] = fetch_location_fixed(
                DEFAULT_ZIP_LAT, DEFAULT_ZIP_LON, DEFAULT_ZIP_LABEL
            )
    except Exception as exc:
        result2['location'] = {'source': 'none', 'label': '', 'error': str(exc)}
        result2['error'] = str(exc)
        print(json.dumps(result2))
        return

    loc = result2['location']
    try:
        result2['current'] = fetch_weather(loc['latitude'], loc['longitude'])
    except Exception as exc:
        result2['weatherError'] = str(exc)
        result2['error'] = str(exc)

    print(json.dumps(result2))


if __name__ == '__main__':
    safe_main(main)
