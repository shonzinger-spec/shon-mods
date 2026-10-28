#!/usr/bin/env python3
"""forward-pane collector: the state of the live launchd forward-test jobs, as JSON.

For each job in ~/Library/LaunchAgents whose label matches jobs.json's label_regex:
running pid and last exit status (launchctl list), last run (newest of its logs
and ledger), whether it is stale for its schedule, the last error lines of its
logs, and trades logged vs target n (jobs.json says how to count each ledger).

Usage: forward_status.py [--config jobs.json] [--text]
Also imported by health-band (stale_jobs()).
"""
import argparse, csv, datetime as dt, glob, json, os, plistlib, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CFG = os.path.join(os.path.dirname(HERE), "jobs.json")
AGENTS = os.path.expanduser("~/Library/LaunchAgents")
ERR = re.compile(r"Traceback|[A-Za-z]*Error\b|Exception\b|FAILED|credit balance|insufficient_quota|\b40[13]\b|expired", re.I)
GRACE = dt.timedelta(minutes=10)  # a calendar run may take this long to write its log


def launchctl():
    """label -> (pid or None, last exit status or None)."""
    out = {}
    try:
        txt = subprocess.run(["launchctl", "list"], capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return out
    for ln in txt.splitlines()[1:]:
        parts = ln.split("\t")
        if len(parts) != 3:
            continue
        pid, status, label = parts
        out[label] = (int(pid) if pid.strip().isdigit() else None, int(status) if status.lstrip("-").isdigit() else None)
    return out


def mtime(p):
    try:
        return dt.datetime.fromtimestamp(os.path.getmtime(p))
    except OSError:
        return None


def tail_errors(path, n_lines=60, keep=2):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 24000))
            lines = f.read().decode("utf-8", "replace").splitlines()[-n_lines:]
    except OSError:
        return []
    hits = [ln.strip()[:180] for ln in lines if ERR.search(ln)]
    return hits[-keep:]


def last_calendar_run(cal, now):
    """Latest scheduled time <= now - GRACE for a StartCalendarInterval (dict or list)."""
    specs = cal if isinstance(cal, list) else [cal]
    best = None
    for day_back in range(0, 9):
        d = (now - dt.timedelta(days=day_back)).date()
        for s in specs:
            wd = s.get("Weekday")  # launchd: 0/7 = Sunday, 1 = Monday
            if wd is not None and (d.isoweekday() % 7) != (wd % 7):
                continue
            t = dt.datetime.combine(d, dt.time(s.get("Hour", 0), s.get("Minute", 0)))
            if t <= now - GRACE and (best is None or t > best):
                best = t
        if best:
            return best
    return best


def schedule_text(pl):
    if pl.get("KeepAlive"):
        return "daemon"
    if "StartInterval" in pl:
        return f"every {int(pl['StartInterval']) // 60} min"
    cal = pl.get("StartCalendarInterval")
    if cal:
        specs = cal if isinstance(cal, list) else [cal]
        days = sorted({s.get("Weekday") for s in specs if "Weekday" in s})
        s0 = specs[0]
        dd = "Mon-Fri" if days == [1, 2, 3, 4, 5] else ("daily" if not days else ",".join("SMTWTFS"[d % 7] for d in days))
        return f"{dd} {s0.get('Hour', 0):02d}:{s0.get('Minute', 0):02d}"
    return "on demand"


def count_ledger(path, spec):
    if not path or not os.path.exists(path):
        return None
    kind = (spec or {}).get("kind", "lines")
    field, equals = (spec or {}).get("field"), (spec or {}).get("equals")
    f2, e2 = (spec or {}).get("and_field"), (spec or {}).get("and_equals")
    n = 0
    try:
        if kind == "csv":
            with open(path, newline="", encoding="utf-8", errors="replace") as f:
                for row in csv.DictReader(f):
                    if not any(row.values()):
                        continue
                    if field and str(row.get(field)) != str(equals):
                        continue
                    n += 1
        elif kind == "jsonl":
            with open(path, encoding="utf-8", errors="replace") as f:
                for ln in f:
                    if not ln.strip():
                        continue
                    if field:
                        try:
                            rec = json.loads(ln)
                        except ValueError:
                            continue
                        if str(rec.get(field)) != str(equals) or (f2 and str(rec.get(f2)) != str(e2)):
                            continue
                    n += 1
        else:
            with open(path, encoding="utf-8", errors="replace") as f:
                n = sum(1 for ln in f if ln.strip())
    except OSError:
        return None
    return n


def collect(cfg_path=DEFAULT_CFG, now=None):
    now = now or dt.datetime.now()
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    rx = re.compile(cfg.get("label_regex", "."), re.I)
    over = cfg.get("jobs", {})
    daemon_h = float(cfg.get("daemon_stale_hours", 3))
    lc = launchctl()
    jobs = []
    for plist in sorted(glob.glob(os.path.join(AGENTS, "*.plist"))):
        try:
            with open(plist, "rb") as f:
                pl = plistlib.load(f)
        except Exception:
            continue
        label = pl.get("Label", "")
        if not rx.search(label):
            continue
        o = over.get(label, {})
        if o.get("hidden"):
            continue
        logs = [p for p in {pl.get("StandardOutPath"), pl.get("StandardErrorPath")} if p]
        ledger = os.path.expanduser(o["ledger"]) if o.get("ledger") else None
        times = [t for t in (mtime(p) for p in logs + ([ledger] if ledger else [])) if t]
        last = max(times) if times else None
        pid, status = lc.get(label, (None, None))
        loaded = label in lc
        stale, why = False, ""
        if not loaded:
            stale, why = True, "not loaded in launchd"
        elif pl.get("KeepAlive"):
            if pid is None:
                stale, why = True, "daemon not running"
            elif last and now - last > dt.timedelta(hours=daemon_h):
                stale, why = True, f"daemon silent {int((now - last).total_seconds() // 3600)}h"
        elif "StartInterval" in pl and last:
            if (now - last).total_seconds() > 3 * int(pl["StartInterval"]) + GRACE.total_seconds():
                stale, why = True, "missed 3+ intervals"
        elif pl.get("StartCalendarInterval"):
            due = last_calendar_run(pl["StartCalendarInterval"], now)
            if due and (last is None or last < due - dt.timedelta(minutes=2)):
                stale, why = True, f"missed run due {due:%a %H:%M}"
        errors = []
        for p in logs:
            t = mtime(p)
            if t and now - t < dt.timedelta(hours=48):
                errors += tail_errors(p)
        jobs.append({
            "label": label,
            "name": o.get("name", label.split(".")[-1]),
            "schedule": schedule_text(pl),
            "running": pid is not None,
            "pid": pid,
            "last_exit": status,
            "last_run": last.isoformat(timespec="minutes") if last else None,
            "age_min": int((now - last).total_seconds() // 60) if last else None,
            "stale": stale,
            "stale_reason": why,
            "errors": errors[-3:],
            "trades": count_ledger(ledger, o.get("count")),
            "unit": o.get("unit", "trades"),
            "target_n": o.get("target_n"),
            "target_note": o.get("target_note", ""),
            "logs": logs,
            "ledger": ledger,
        })
    return {"generated_at": now.isoformat(timespec="seconds"), "jobs": jobs}


def stale_jobs(cfg_path=DEFAULT_CFG):
    """For health-band: [(name, reason)] of jobs that are stale or exited non-zero."""
    out = []
    for j in collect(cfg_path)["jobs"]:
        if j["stale"]:
            out.append((j["name"], j["stale_reason"]))
        elif j["last_exit"] not in (0, None) and not j["running"]:
            out.append((j["name"], f"last exit {j['last_exit']}"))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=DEFAULT_CFG)
    ap.add_argument("--text", action="store_true")
    a = ap.parse_args()
    res = collect(a.config)
    if not a.text:
        print(json.dumps(res))
        return 0
    for j in res["jobs"]:
        n = "" if j["trades"] is None else f" {j['trades']}{'/' + str(j['target_n']) if j['target_n'] else ''} {j['unit']}"
        flag = "STALE " + j["stale_reason"] if j["stale"] else ("exit " + str(j["last_exit"]))
        print(f"{j['name']:<30} {j['schedule']:<14} last {j['last_run']} {flag}{n}")
        for e in j["errors"]:
            print(f"    ! {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
