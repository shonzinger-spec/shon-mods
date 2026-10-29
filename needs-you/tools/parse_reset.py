import datetime as _dt
import re
from zoneinfo import ZoneInfo

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

_TIME = r"(\d{1,2})(?::(\d{2}))?\s*([ap]m)"
_RESET_DATE_RE = re.compile(
    r"resets\s+([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s+at\s+" + _TIME,
    re.IGNORECASE,
)
_RESET_TIME_RE = re.compile(r"resets\s+" + _TIME, re.IGNORECASE)
_ZONE_RE = re.compile(r"\(([^)]+)\)")


def _kind(text):
    lowered = text.lower()
    if "rate limit" in lowered:
        return "rate"
    if "session limit" in lowered:
        return "session"
    if "weekly limit" in lowered:
        return "weekly"
    return None


def _to_hour(hour_text, minute_text, meridiem):
    hour = int(hour_text)
    if not 1 <= hour <= 12:
        return None
    minute = int(minute_text) if minute_text else 0
    if not 0 <= minute <= 59:
        return None
    if meridiem.lower() == "am":
        hour = 0 if hour == 12 else hour
    else:
        hour = 12 if hour == 12 else hour + 12
    return hour, minute


def _zone(text):
    match = _ZONE_RE.search(text)
    if not match:
        return _dt.datetime.now().astimezone().tzinfo
    try:
        return ZoneInfo(match.group(1).strip())
    except Exception:
        return None


def _parse_reset_ms(text, error_at_ms, tz):
    date_match = _RESET_DATE_RE.search(text)
    if date_match:
        month_name, day_text, hour_text, minute_text, meridiem = date_match.groups()
        month = _MONTHS.get(month_name[:3].lower())
        if month is None:
            return None
        try:
            day = int(day_text)
        except ValueError:
            return None
        hm = _to_hour(hour_text, minute_text, meridiem)
        if hm is None:
            return None
        hour, minute = hm
        error_dt = _dt.datetime.fromtimestamp(error_at_ms / 1000, tz)
        year = error_dt.year
        try:
            candidate = _dt.datetime(year, month, day, hour, minute, tzinfo=tz)
        except ValueError:
            return None
        if candidate <= error_dt:
            try:
                candidate = _dt.datetime(year + 1, month, day, hour, minute, tzinfo=tz)
            except ValueError:
                return None
        return int(round(candidate.timestamp() * 1000))

    time_match = _RESET_TIME_RE.search(text)
    if not time_match:
        return None
    hour_text, minute_text, meridiem = time_match.groups()
    hm = _to_hour(hour_text, minute_text, meridiem)
    if hm is None:
        return None
    hour, minute = hm
    error_dt = _dt.datetime.fromtimestamp(error_at_ms / 1000, tz)
    day = error_dt.date()
    candidate = _dt.datetime(day.year, day.month, day.day, hour, minute, tzinfo=tz)
    if candidate <= error_dt:
        day = day + _dt.timedelta(days=1)
        candidate = _dt.datetime(day.year, day.month, day.day, hour, minute, tzinfo=tz)
    return int(round(candidate.timestamp() * 1000))


def parse_reset(error_text, error_at_ms):
    if not isinstance(error_text, str):
        return None
    kind = _kind(error_text)
    if kind is None:
        return None
    if kind == "rate":
        return {"kind": "rate", "reset_at_ms": None}
    tz = _zone(error_text)
    reset_at_ms = None if tz is None else _parse_reset_ms(error_text, error_at_ms, tz)
    return {"kind": kind, "reset_at_ms": reset_at_ms}
