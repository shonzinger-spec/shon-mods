"""Latest fire time of a 5-field cron expression (local naive datetimes)."""
import datetime as dt

_FIELDS = (
    ("minute", 0, 59),
    ("hour", 0, 23),
    ("dom", 1, 31),
    ("month", 1, 12),
    ("dow", 0, 7),
)


def _parse_field(field, lo, hi):
    if field == "*":
        return set(range(lo, hi + 1)), False
    values = set()
    for part in field.split(","):
        if not part:
            raise ValueError("empty list item")
        step = 1
        if "/" in part:
            base, step_text = part.split("/", 1)
            if not step_text.isdigit() or "/" in step_text:
                raise ValueError("bad step")
            step = int(step_text)
            if step == 0:
                raise ValueError("step zero")
        else:
            base = part
        if base == "*":
            start, end = lo, hi
        elif "-" in base:
            first, second = base.split("-", 1)
            if not first.isdigit() or not second.isdigit():
                raise ValueError("bad range")
            start, end = int(first), int(second)
            if start > end:
                raise ValueError("reversed range")
        else:
            if not base.isdigit():
                raise ValueError("bad value")
            start = end = int(base)
        if not (lo <= start <= hi and lo <= end <= hi):
            raise ValueError("out of range")
        values.update(range(start, end + 1, step))
    return values, True


def last_fire(expr, now):
    """Latest scheduled minute <= now for a 5-field cron expression `expr`
    (minute hour day-of-month month day-of-week), searching back at most 8 days.
    Supports *, N, a-b, a,b, */n, a-b/n; day-of-week 0 and 7 are Sunday; when both
    day-of-month and day-of-week are restricted a day matches if either does.
    Seconds are dropped. Returns a naive datetime, or None for an invalid expression
    or when nothing fires within the window."""
    if not isinstance(expr, str):
        return None
    parts = expr.split()
    if len(parts) != 5:
        return None
    try:
        parsed = [_parse_field(part, lo, hi) for part, (_, lo, hi) in zip(parts, _FIELDS)]
    except (ValueError, TypeError):
        return None

    minutes, _ = parsed[0]
    hours, _ = parsed[1]
    doms, dom_restricted = parsed[2]
    months, _ = parsed[3]
    dows, dow_restricted = parsed[4]
    dows = {d % 7 for d in dows}

    candidate = now.replace(second=0, microsecond=0)
    for back in range(8 * 24 * 60 + 1):
        current = candidate - dt.timedelta(minutes=back)
        dow = current.isoweekday() % 7
        if current.month not in months:
            continue
        if dom_restricted and dow_restricted:
            day_ok = current.day in doms or dow in dows
        else:
            day_ok = current.day in doms and dow in dows
        if not day_ok:
            continue
        if current.hour in hours and current.minute in minutes:
            return current
    return None
