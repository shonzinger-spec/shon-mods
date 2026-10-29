#!/usr/bin/env python3
"""health-band data-flow checks: a forward job can exit 0 and still write nothing new.

check(cfg, now, issues, newest_bar_fn=None) appends {level, check: "data-flow", text} rows for each
cfg["data_flow"] item {name, kind, path, ...}:
  mtime_glob : newest mtime among files matching `path`
  parquet_ts : newest bar of the parquet column `ts` (health_check.newest_bar, or newest_bar_fn(path, col))
  json_field : the timestamp in JSON field `field` ("YYYY-MM-DD HH:MM:SS ET", or ISO)
  log_match  : red when a line matching `pattern` is stamped within `within_hours` (leading
               "YYYY-MM-DD HH:MM:SS" stamp, else the file's mtime). No lag limit.
Lag limit: max_lag_business_days (Mon-Fri days after the source date up to today; Sat/Sun never
count, exchange holidays are NOT modelled) or max_lag_days (calendar days, float).
red   : source older than its limit, or a log_match hit.
amber : path missing / unreadable / unparseable, unknown kind.
`now` is a naive local datetime; aware timestamps are converted to local naive.
"""
import datetime as dt, glob, importlib.util, json, os, re
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ET = ZoneInfo("America/New_York")
STAMP = re.compile(r"^\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})")


def expand(p):
    return os.path.expanduser(p)


def local_naive(t):
    if hasattr(t, "to_pydatetime"):  # pandas Timestamp
        t = t.to_pydatetime()
    return t.astimezone().replace(tzinfo=None) if t.tzinfo else t


def business_lag(src, now):
    """Mon-Fri days in (src date, now date]. A Friday source read on Sat/Sun is 0, on Monday 1."""
    d, n = src.date(), now.date()
    lag = 0
    while d < n:
        d += dt.timedelta(days=1)
        if d.weekday() < 5:
            lag += 1
    return lag


def parse_stamp(text):
    """'2026-10-28 08:00:05 ET' | ISO (Z ok) -> local naive datetime. Bare/ET stamps are New York time."""
    s = str(text).strip()
    tz = ET
    if s.endswith(" ET"):
        s = s[:-3]
    t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    if t.tzinfo is None:
        t = t.replace(tzinfo=tz)
    return local_naive(t)


def default_newest_bar(path, col):
    spec = importlib.util.spec_from_file_location("health_check", os.path.join(HERE, "health_check.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.newest_bar(path, col)


def source_time(item, now, newest_bar_fn):
    """-> naive local datetime of the item's newest data. Raises FileNotFoundError / ValueError."""
    kind, path = item["kind"], expand(item["path"])
    if kind == "mtime_glob":
        files = glob.glob(path)
        if not files:
            raise FileNotFoundError(path)
        return dt.datetime.fromtimestamp(max(os.path.getmtime(f) for f in files))
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    if kind == "parquet_ts":
        return local_naive((newest_bar_fn or default_newest_bar)(path, item.get("ts", "ts")))
    if kind == "json_field":
        with open(path, encoding="utf-8") as f:
            return parse_stamp(json.load(f)[item["field"]])
    raise ValueError(f"unknown kind {kind!r}")


def check_log_match(item, name, now, issues):
    path = expand(item["path"])
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    rx = re.compile(item["pattern"], re.I)
    window = dt.timedelta(hours=float(item.get("within_hours", 48)))
    mtime = dt.datetime.fromtimestamp(os.path.getmtime(path))
    with open(path, "rb") as f:
        f.seek(0, 2)
        f.seek(max(0, f.tell() - 200000))
        lines = f.read().decode("utf-8", "replace").splitlines()
    for ln in reversed(lines):
        if not rx.search(ln):
            continue
        m = STAMP.match(ln)
        when = parse_stamp(m.group(1)) if m else mtime
        if now - when <= window:
            issues.append({"level": "red", "check": "data-flow",
                           "text": f"{name}: '{item['pattern']}' logged {when:%Y-%m-%d %H:%M} ({int((now - when).total_seconds() // 3600)}h ago)"})
        return  # newest matching line decides


def check(cfg, now, issues, newest_bar_fn=None):
    for item in cfg.get("data_flow", []):
        name = item.get("name", item.get("path", "?"))
        try:
            if item.get("kind") == "log_match":
                check_log_match(item, name, now, issues)
                continue
            src = source_time(item, now, newest_bar_fn)
        except FileNotFoundError:
            issues.append({"level": "amber", "check": "data-flow", "text": f"{name}: source missing ({item.get('path')})"})
            continue
        except Exception as e:  # a broken item is a finding, not a crash
            issues.append({"level": "amber", "check": "data-flow", "text": f"{name}: unreadable ({str(e)[:80]})"})
            continue
        if "max_lag_business_days" in item:
            lag, limit, unit = business_lag(src, now), int(item["max_lag_business_days"]), "business days"
        else:
            lag, limit, unit = (now - src).total_seconds() / 86400, float(item.get("max_lag_days", 1)), "days"
            lag = int(lag)
            limit = int(limit) if limit == int(limit) else limit
        if lag > limit:
            issues.append({"level": "red", "check": "data-flow",
                           "text": f"{name} data stale: newest {src:%Y-%m-%d %H:%M}, {lag} {unit} behind (limit {limit}); the job may exit 0 without writing"})
