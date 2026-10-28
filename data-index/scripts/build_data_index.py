#!/usr/bin/env python3
"""Build ~/Trading/_data/index.json: one row per bar file (.parquet/.csv).

Reads footers/metadata where it can; gap analysis reads only the timestamp
column. Cached by realpath + mtime + size (the previous index.json is the
cache), so a refresh only opens new or changed files. Never crashes: any
fatal error prints {"error": ...} and exits 0.
"""
import argparse
import csv
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

try:
    import pyarrow as pa
    import pyarrow.compute as pc
    import pyarrow.parquet as pq
except Exception:  # pragma: no cover - reported in the index header
    pa = pc = pq = None

HERE = os.path.dirname(os.path.abspath(__file__))
ET = ZoneInfo("America/New_York")
EXTS = (".parquet", ".csv")
MIN_BYTES = 1024
MAX_GAP_ROWS = 50_000_000
CSV_GAP_CAP = 2_000_000
VERSION = 1

ASSUMPTIONS = [
    "tz-naive timestamps are UTC unless the path names ET (et/est/edt/eastern/new_york); exclusions are computed in America/New_York",
    "a gap is a step whose open-market time exceeds 3x tf; closed time = Fri 17:00-Sun 18:00 ET and the daily 17:00-18:00 ET halt; exchange holidays and RTH-only files DO count as gaps",
    "symbol/tf come from the filename; tf falls back to the median timestamp step",
    "start/end for parquet come from row-group statistics of the first datetime column; gaps read that column only and are skipped (null) above 50M rows or with no datetime column",
    "CSV gap stats use the first 2M rows (gaps_sampled: true beyond); rows counts every line",
    "roll is a filename pattern map (kaggle=forward-adjusted, _primary=unadjusted, LSE .F=undisclosed, topstep=front contract), not a measurement",
    "bad flags come from ~/.claude/mods-src/bad-data/bad-data.json (match = case-insensitive substring of the path, or regex: ...)",
]

SYMBOLS = ["MNQ", "MES", "MGC", "MYM", "M2K", "MCL", "SIL", "RTY", "NQ", "ES", "GC", "SI", "CL", "YM",
           "ZN", "ZB", "ZF", "ZT", "6E", "6J", "6B", "HG", "NG", "VX", "QQQ", "SPY", "VIXY"]
SYM_RE = re.compile(r"(?<![A-Za-z0-9])(" + "|".join(SYMBOLS) + r")(?![A-Za-z])", re.I)
TF_RE = re.compile(r"(?<![A-Za-z0-9])(\d+)(s|sec|m|min|h|hr|d)(?![A-Za-z])|(?<![A-Za-z])(tick|ticks|daily)(?![A-Za-z])", re.I)
TF_UNIT = {"s": 1, "sec": 1, "m": 60, "min": 60, "h": 3600, "hr": 3600, "d": 86400}
ET_PATH_RE = re.compile(r"(?<![A-Za-z])(et|est|edt|eastern|new_york)(?![A-Za-z])", re.I)
TS_NAMES = ["timestamp", "ts_event", "ts", "datetime", "date_time", "time", "date", "dt", "bar_time", "open_time"]
ROLL_MAP = [
    (re.compile(r"kaggle", re.I), "forward-adjusted"),
    (re.compile(r"_primary", re.I), "unadjusted"),
    (re.compile(r"(?<![A-Za-z])lse(?![A-Za-z])|\.F(?=[_.\-]|$)", re.I), "undisclosed (LSE .F)"),
    (re.compile(r"topstep", re.I), "front contract"),
]


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def tf_label(sec):
    if sec is None:
        return None
    for unit, n in (("d", 86400), ("h", 3600), ("m", 60)):
        if sec >= n and sec % n == 0:
            return f"{sec // n}{unit}"
    return f"{sec}s"


def tf_from_name(name):
    """(label, seconds) from a filename, or (None, None)."""
    m = TF_RE.search(name)
    if not m:
        return None, None
    if m.group(3):
        word = m.group(3).lower()
        return ("tick", None) if word.startswith("tick") else ("1d", 86400)
    sec = int(m.group(1)) * TF_UNIT[m.group(2).lower()]
    return tf_label(sec), sec


def symbol_from_name(name):
    m = SYM_RE.search(name)
    return m.group(1).upper() if m else None


def roll_for(path):
    for rx, label in ROLL_MAP:
        if rx.search(path):
            return label
    return None


# ---------- market-hours gap logic ----------

def _closed(wd):
    """Closed wall-clock windows (hours) for an ET weekday, Mon=0."""
    if wd <= 3:
        return [(17, 18)]
    if wd == 4:
        return [(17, 24)]
    if wd == 5:
        return [(0, 24)]
    return [(0, 18)]


def open_seconds(t0, t1):
    """Seconds of open market between two aware datetimes."""
    a, b = t0.astimezone(ET).replace(tzinfo=None), t1.astimezone(ET).replace(tzinfo=None)
    if b <= a:
        return 0.0
    total = 0.0
    day = datetime(a.year, a.month, a.day)
    while day < b:
        nxt = day + timedelta(days=1)
        lo, hi = max(a, day), min(b, nxt)
        if hi > lo:
            span = (hi - lo).total_seconds()
            for h0, h1 in _closed(day.weekday()):
                c0, c1 = day + timedelta(hours=h0), day + timedelta(hours=h1)
                ov = (min(hi, c1) - max(lo, c0)).total_seconds()
                if ov > 0:
                    span -= ov
            total += span
        day = nxt
    return total


def gap_stats(ns_values, tf_sec, tz):
    """ns_values: sorted int64 epoch-ns list/array (wall clock in `tz` if naive).

    Returns (median_step_sec, gaps, largest) where largest is a dict or None.
    """
    n = len(ns_values)
    if n < 2:
        return None, 0, None
    if pc is not None and isinstance(ns_values, pa.Array):
        arr = ns_values
        diffs = pc.subtract(arr.slice(1), arr.slice(0, n - 1))
        med = pc.approximate_median(diffs).as_py()
        step = tf_sec or (int(round(med / 1e9)) if med else None)
        if not step:
            return None, 0, None
        mask = pc.greater(diffs, 3 * step * 1_000_000_000)
        idx = pc.indices_nonzero(mask).to_pylist()
        cand = [(arr[i].as_py(), arr[i + 1].as_py()) for i in idx]
    else:
        diffs = [ns_values[i + 1] - ns_values[i] for i in range(n - 1)]
        s = sorted(diffs)
        med = s[len(s) // 2]
        step = tf_sec or (int(round(med / 1e9)) if med else None)
        if not step:
            return None, 0, None
        lim = 3 * step * 1_000_000_000
        cand = [(ns_values[i], ns_values[i + 1]) for i, d in enumerate(diffs) if d > lim]
    gaps, largest = 0, None
    for a, b in cand:
        t0 = datetime.fromtimestamp(a / 1e9, tz=timezone.utc)
        t1 = datetime.fromtimestamp(b / 1e9, tz=timezone.utc)
        if tz is not None:  # naive values are wall clock in tz
            t0 = t0.replace(tzinfo=None).replace(tzinfo=tz)
            t1 = t1.replace(tzinfo=None).replace(tzinfo=tz)
        open_s = open_seconds(t0, t1)
        if open_s > 3 * step:
            gaps += 1
            if largest is None or open_s > largest["open_hours"] * 3600:
                largest = {"start": t0.astimezone(timezone.utc).isoformat(), "end": t1.astimezone(timezone.utc).isoformat(),
                           "open_hours": round(open_s / 3600, 2)}
    return (int(round(med / 1e9)) if med else None), gaps, largest


# ---------- readers ----------

def _iso(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc).isoformat()
    return str(v)


def _pick_ts_field(schema):
    cands = [f for f in schema if pa.types.is_timestamp(f.type) or pa.types.is_date(f.type)]
    if not cands:
        return None
    for name in TS_NAMES:
        for f in cands:
            if f.name.lower() == name:
                return f
    return cands[0]


def read_parquet(path, et_path):
    out = {"rows": None, "start": None, "end": None, "ts_col": None, "gaps": None, "largest_gap": None, "step_sec": None}
    if pq is None:
        out["note"] = "pyarrow missing"
        return out
    pf = pq.ParquetFile(path)
    md = pf.metadata
    out["rows"] = md.num_rows
    f = _pick_ts_field(pf.schema_arrow)
    if f is None:
        out["note"] = "no datetime column"
        return out
    out["ts_col"] = f.name
    tz_name = getattr(f.type, "tz", None)
    naive_tz = None if tz_name else (ET if et_path else timezone.utc)
    ci = pf.schema_arrow.get_field_index(f.name)
    leaf = None
    for j in range(md.num_columns):
        if md.schema.column(j).path.split(".")[0] == f.name:
            leaf = j
            break
    lo = hi = None
    if leaf is not None:
        for g in range(md.num_row_groups):
            st = md.row_group(g).column(leaf).statistics
            if st is None or not st.has_min_max:
                lo = hi = None
                break
            lo = st.min if lo is None or st.min < lo else lo
            hi = st.max if hi is None or st.max > hi else hi
    need_col = md.num_rows <= MAX_GAP_ROWS
    col = None
    if need_col or lo is None:
        col = pf.read(columns=[f.name]).column(0).combine_chunks()
        if pa.types.is_date(col.type):
            col = col.cast(pa.timestamp("s"))
        col = col.cast(pa.timestamp("ns", tz=tz_name) if tz_name else pa.timestamp("ns")).cast(pa.int64())
        col = col.drop_null()
        if len(col) and lo is None:
            lo_ns, hi_ns = pc.min(col).as_py(), pc.max(col).as_py()
            lo, hi = _ns_to_dt(lo_ns, naive_tz), _ns_to_dt(hi_ns, naive_tz)
    if isinstance(lo, datetime) and lo.tzinfo is None:
        lo, hi = lo.replace(tzinfo=naive_tz), hi.replace(tzinfo=naive_tz)
    out["start"], out["end"] = _iso(lo), _iso(hi)
    if need_col and col is not None:
        col = pc.take(col, pc.sort_indices(col))
        out["_ns"] = col
        out["_tz"] = naive_tz
    return out


def _ns_to_dt(ns, tz):
    if ns is None:
        return None
    d = datetime.fromtimestamp(ns / 1e9, tz=timezone.utc)
    return d.replace(tzinfo=None).replace(tzinfo=tz) if tz is not None else d


def _parse_ts(s, tz):
    s = s.strip()
    if not s:
        return None
    if re.fullmatch(r"-?\d+(\.\d+)?", s):
        v = float(s)
        if v > 1e17:
            return int(v)
        if v > 1e14:
            return int(v * 1e3)
        if v > 1e11:
            return int(v * 1e6)
        if v > 1e8:
            return int(v * 1e9)
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00").replace("/", "-"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=tz)
    return int(d.timestamp() * 1e9)


def read_csv(path, et_path):
    out = {"rows": None, "start": None, "end": None, "ts_col": None, "gaps": None, "largest_gap": None, "step_sec": None}
    naive_tz = ET if et_path else timezone.utc
    with open(path, newline="", errors="replace") as fh:
        head = fh.readline()
        if not head:
            out["rows"] = 0
            return out
        try:
            dialect = csv.Sniffer().sniff(head, delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        cols = next(csv.reader([head], dialect))
        low = [c.strip().lower() for c in cols]
        idx = next((low.index(n) for n in TS_NAMES if n in low), None)
        tidx = low.index("time") if ("date" in low and "time" in low) else None
        if tidx is not None:
            idx = low.index("date")
        rows, vals = 0, []
        reader = csv.reader(fh, dialect)
        for rec in reader:
            rows += 1
            if idx is not None and rows <= CSV_GAP_CAP and len(rec) > idx:
                txt = rec[idx] + (" " + rec[tidx] if tidx is not None and len(rec) > tidx else "")
                v = _parse_ts(txt, naive_tz)
                if v is not None:
                    vals.append(v)
            if rows >= CSV_GAP_CAP:
                break
        last = None
        if rows >= CSV_GAP_CAP:
            out["gaps_sampled"] = True
    if out.get("gaps_sampled"):
        rows += _count_rest(path, head, rows)
        last = _last_line(path)
    out["rows"] = rows
    if idx is None or not vals:
        out["note"] = "no timestamp column" if idx is None else "unparsed timestamps"
        return out
    out["ts_col"] = cols[idx] + ("+" + cols[tidx] if tidx is not None else "")
    end_ns = vals[-1]
    if last is not None:
        rec = next(csv.reader([last], dialect), [])
        if len(rec) > idx:
            txt = rec[idx] + (" " + rec[tidx] if tidx is not None and len(rec) > tidx else "")
            end_ns = _parse_ts(txt, naive_tz) or end_ns
    vals.sort()
    out["start"] = _iso(datetime.fromtimestamp(vals[0] / 1e9, tz=timezone.utc))
    out["end"] = _iso(datetime.fromtimestamp(max(end_ns, vals[-1]) / 1e9, tz=timezone.utc))
    out["_ns"] = vals
    out["_tz"] = None  # already converted to absolute epoch ns
    return out


def _count_rest(path, head, done):
    """Total data lines minus the ones already read (newline count)."""
    n = 0
    with open(path, "rb") as fb:
        for chunk in iter(lambda: fb.read(1 << 22), b""):
            n += chunk.count(b"\n")
    return max(0, n - 1 - done)


def _last_line(path):
    with open(path, "rb") as fb:
        fb.seek(0, 2)
        size = fb.tell()
        fb.seek(max(0, size - 8192))
        lines = [ln for ln in fb.read().decode("utf-8", "replace").splitlines() if ln.strip()]
    return lines[-1] if lines else None


def analyze(path, shown):
    name = os.path.basename(shown)
    et_path = bool(ET_PATH_RE.search(shown) or ET_PATH_RE.search(path))
    tf, tf_sec = tf_from_name(name)
    reader = read_parquet if path.lower().endswith(".parquet") else read_csv
    try:
        info = reader(path, et_path)
    except Exception as exc:  # unreadable file: still indexed
        info = {"rows": None, "start": None, "end": None, "gaps": None, "largest_gap": None, "error": f"{type(exc).__name__}: {exc}"[:200]}
    ns = info.pop("_ns", None)
    tz = info.pop("_tz", None)
    if ns is not None and tf != "tick":
        med, gaps, largest = gap_stats(ns, tf_sec, tz)
        info["step_sec"] = med
        if tf is None and med:
            tf, tf_sec = tf_label(med), med
            info["tf_inferred"] = True
        if tf_sec or med:
            info["gaps"], info["largest_gap"] = gaps, largest
    info.update({"symbol": symbol_from_name(name), "tf": tf, "roll": roll_for(shown) or roll_for(path), "tz_assumed": "ET" if et_path else "UTC"})
    return info


# ---------- discovery, cache, bad-data ----------

def walk(roots, skip_dirs, deadline=None):
    """Yield (realpath, shown_path) for every bar file, deduped, cycle-safe."""
    seen_dirs, seen_files = set(), set()
    count = 0
    for root in roots:
        root = os.path.expanduser(root)
        if not os.path.isdir(root):
            continue
        for d, dirs, files in os.walk(root, followlinks=True, onerror=lambda e: None):
            rd = os.path.realpath(d)
            if rd in seen_dirs:
                dirs[:] = []
                continue
            seen_dirs.add(rd)
            dirs[:] = [x for x in dirs if x not in skip_dirs and not x.endswith(".egg-info")]
            for fn in files:
                if not fn.lower().endswith(EXTS):
                    continue
                shown = os.path.join(d, fn)
                rp = os.path.realpath(shown)
                if rp in seen_files:
                    continue
                try:
                    st = os.stat(rp)
                except OSError:
                    continue
                if st.st_size < MIN_BYTES:
                    continue
                seen_files.add(rp)
                count += 1
                if count % 500 == 0:
                    log(f"data-index: found {count} files ({len(seen_dirs)} dirs)")
                yield rp, shown, st


def load_bad(path):
    try:
        with open(os.path.expanduser(path)) as fh:
            raw = json.load(fh)
    except Exception:
        return []
    out = []
    for e in raw.get("files", []) if isinstance(raw, dict) else []:
        if not isinstance(e, dict) or not e.get("match") or not e.get("defect"):
            continue
        m = e["match"]
        try:
            rx = re.compile(m[6:], re.I) if m.startswith("regex:") else re.compile(re.escape(m), re.I)
        except re.error:
            continue
        out.append((rx, e.get("id") or m, e["defect"]))
    return out


def bad_for(paths, bad):
    hits = []
    for rx, bid, defect in bad:
        if any(rx.search(p) for p in paths):
            hits.append({"id": bid, "defect": defect})
    return hits


def load_cache(out_path):
    try:
        with open(out_path) as fh:
            prev = json.load(fh)
        if prev.get("version") != VERSION:
            return {}
        return {f["realpath"]: f for f in prev.get("files", []) if "realpath" in f}
    except Exception:
        return {}


def build(roots, skip_dirs, out_path, bad_path, max_seconds=None):
    t_start = time.time()
    deadline = t_start + max_seconds if max_seconds else None
    cache = load_cache(out_path)
    bad = load_bad(bad_path)
    files, hits, read, partial, skipped = [], 0, 0, False, 0
    for rp, shown, st in walk(roots, skip_dirs):
        c = cache.get(rp)
        if c and c.get("mtime") == int(st.st_mtime) and c.get("size") == st.st_size:
            entry = dict(c)
            hits += 1
        elif deadline and time.time() > deadline:
            partial, skipped = True, skipped + 1
            continue
        else:
            entry = {"realpath": rp, "size": st.st_size, "mtime": int(st.st_mtime)}
            entry.update(analyze(rp, shown))
            read += 1
            if read % 50 == 0:
                log(f"data-index: read {read} files, {hits} cached, {time.time() - t_start:.0f}s")
        entry["path"] = shown
        b = bad_for([shown, rp], bad)
        entry["bad"] = b or None
        entry["clean"] = not b
        files.append(entry)
    files.sort(key=lambda f: (f.get("symbol") or "~", f.get("tf") or "~", f["path"]))
    idx = {
        "version": VERSION,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "partial": partial,
        "unread_files": skipped,
        "roots": roots,
        "pyarrow": pa.__version__ if pa else None,
        "assumptions": ASSUMPTIONS,
        "count": len(files),
        "seconds": round(time.time() - t_start, 1),
        "cache_hits": hits,
        "files_read": read,
        "files": files,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    _write_json(out_path, idx)
    slim = {k: idx[k] for k in ("version", "generated", "partial", "count")}
    slim["files"] = [{k: f[k] for k in LOOKUP_KEYS if f.get(k) is not None} for f in files]
    _write_json(lookup_path(out_path), slim)
    return idx


# /data reads files through the mod API, which rejects a read over 4 MiB, so
# both files are compact JSON and /data reads the slim lookup file first.
LOOKUP_KEYS = ("path", "symbol", "tf", "rows", "start", "end", "gaps", "gaps_sampled", "largest_gap", "roll", "bad", "error")


def lookup_path(out_path):
    return os.path.splitext(out_path)[0] + ".lookup.json"


def _write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(obj, fh, separators=(",", ":"), default=str)
    os.replace(tmp, path)


def load_config(path):
    try:
        with open(path) as fh:
            return json.load(fh)
    except Exception:
        return {}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default=os.path.join(os.path.dirname(HERE), "config.json"))
    ap.add_argument("--root", action="append", help="scan these roots instead of ~/Trading + extra_roots")
    ap.add_argument("--out", default=os.path.expanduser("~/Trading/_data/index.json"))
    ap.add_argument("--bad-data", default=os.path.expanduser("~/.claude/mods-src/bad-data/bad-data.json"))
    ap.add_argument("--max-seconds", type=float, default=None, help="time budget; writes partial: true and resumes from cache next run")
    a = ap.parse_args(argv)
    cfg = load_config(a.config)
    roots = a.root or [os.path.expanduser("~/Trading")] + [os.path.expanduser(r) for r in cfg.get("extra_roots", [])]
    skip = set(cfg.get("skip_dirs") or [".venv", "node_modules", ".git", "site-packages", "__pycache__", ".cache"])
    idx = build(roots, skip, a.out, a.bad_data, a.max_seconds)
    bad = sum(1 for f in idx["files"] if f.get("bad"))
    print(json.dumps({"ok": True, "count": idx["count"], "bad": bad, "partial": idx["partial"], "seconds": idx["seconds"],
                      "cache_hits": idx["cache_hits"], "files_read": idx["files_read"], "out": a.out}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}))
    sys.exit(0)
