#!/usr/bin/env python3
"""health-band checks, as JSON: {level, issues: [{level, check, text}], checked_at}.

red   : Anthropic API credit errors in launchd logs; ~/.lse_key missing/empty or
        rejected (401/403); a live feed stale beyond its market-minute limit;
        a forward job stale or exited non-zero.
amber : LSE daily request limit hit; a feed unreadable.
stats (always drawn): LSE requests today, helper-agent jobs today, fixed per-turn
        context overhead of plugins and skills; each null when its source is unreadable.
Usage: health_check.py [--config health.json] [--text]
"""
import argparse, contextlib, datetime as dt, glob, importlib.util, io, json, os, plistlib, re, sys
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CFG = os.path.join(os.path.dirname(HERE), "health.json")
ET = ZoneInfo("America/New_York")
CREDIT = re.compile(r"credit balance is too low|insufficient[_ ]quota|purchase (?:more )?credits|billing_error|Your credit balance", re.I)
LSE_AUTH = re.compile(r"(?:LSE|lse|vault|api\.lse)[^\n]{0,120}\b(?:401|403)\b|\b(?:401|403)\b[^\n]{0,120}(?:LSE|lse|vault)|invalid api key|key (?:has )?expired", re.I)
LSE_LIMIT = re.compile(r"daily request limit reached", re.I)


def expand(p):
    return os.path.expanduser(p)


def job_logs(label_regex):
    rx = re.compile(label_regex, re.I)
    out = []
    for plist in glob.glob(expand("~/Library/LaunchAgents/*.plist")):
        try:
            with open(plist, "rb") as f:
                pl = plistlib.load(f)
        except Exception:
            continue
        if rx.search(pl.get("Label", "")):
            for k in ("StandardOutPath", "StandardErrorPath"):
                if pl.get(k):
                    out.append((pl["Label"], pl[k]))
    return out


def tail(path, nbytes=60000):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - nbytes))
            return f.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return []


def check_logs(cfg, now, issues):
    window = dt.timedelta(hours=float(cfg.get("log_window_hours", 24)))
    seen = set()
    for label, path in job_logs(cfg.get("label_regex", ".")):
        try:
            mt = dt.datetime.fromtimestamp(os.path.getmtime(path))
        except OSError:
            continue
        if now - mt > window:
            continue
        lines = tail(path)
        name = label.split(".")[-1]
        for check, rx, level, what in (("api-credit", CREDIT, "red", "Anthropic API credit error"),
                                       ("lse-key", LSE_AUTH, "red", "LSE key rejected"),
                                       ("lse-limit", LSE_LIMIT, "amber", "LSE daily request limit hit")):
            hit = next((ln for ln in reversed(lines) if rx.search(ln)), None)
            if hit and (check, name) not in seen:
                seen.add((check, name))
                issues.append({"level": level, "check": check,
                               "text": f"{what} in {name} log ({int((now - mt).total_seconds() // 3600)}h ago): {hit.strip()[:120]}"})


def check_lse_key(cfg, issues):
    p = expand(cfg.get("lse_key", "~/.lse_key"))
    try:
        ok = os.path.getsize(p) > 0
    except OSError:
        ok = False
    if not ok:
        issues.append({"level": "red", "check": "lse-key", "text": f"{cfg.get('lse_key', '~/.lse_key')} missing or empty"})


def market_minutes(start, end):
    """CME Globex open minutes in (start, end], both aware datetimes."""
    if end <= start:
        return 0
    s, e = start.astimezone(ET), end.astimezone(ET)
    total = 0
    cur = s.replace(second=0, microsecond=0)
    # step by hour blocks for speed, minute precision at the edges
    while cur < e:
        nxt = min(e, (cur + dt.timedelta(hours=1)).replace(minute=0))
        if is_open(cur):
            total += (nxt - cur).total_seconds() / 60
        cur = nxt
    return int(total)


def is_open(t):
    wd, h = t.weekday(), t.hour  # Mon=0 .. Sun=6
    if wd == 5:
        return False  # Saturday
    if wd == 6:
        return h >= 18  # Sunday from 18:00
    if wd == 4 and h >= 17:
        return False  # Friday after 17:00
    return h != 17  # daily halt 17:00-18:00


def newest_bar(path, ts):
    import pyarrow.parquet as pq  # noqa: PLC0415 (only when a feed is checked)
    pf = pq.ParquetFile(path)
    col = ts
    if ts == "index":
        meta = pf.schema_arrow.pandas_metadata or {}
        idx = meta.get("index_columns") or []
        col = idx[0] if idx and isinstance(idx[0], str) else "__index_level_0__"
    names = pf.schema_arrow.names
    if col not in names:
        raise ValueError(f"no column {col!r}")
    best = None
    md = pf.metadata
    ci = names.index(col)
    for rg in range(md.num_row_groups):
        st = md.row_group(rg).column(ci).statistics
        if st is not None and st.has_min_max:
            best = st.max if best is None or st.max > best else best
    if best is None:
        tbl = pf.read(columns=[col])
        best = tbl.column(col).to_pylist()[-1]
    field = pf.schema_arrow.field(col)
    tz = getattr(field.type, "tz", None)
    if isinstance(best, dt.datetime):
        if best.tzinfo is None:
            best = best.replace(tzinfo=ZoneInfo(tz) if tz else dt.timezone.utc)
        return best
    raise ValueError(f"{col} is not a timestamp")


def check_feeds(cfg, now_aware, issues):
    for f in cfg.get("feeds", []):
        p = expand(f["path"])
        if not os.path.exists(p):
            issues.append({"level": "amber", "check": "feed", "text": f"{f['name']}: file missing ({f['path']})"})
            continue
        try:
            last = newest_bar(p, f.get("ts", "timestamp")) + dt.timedelta(minutes=int(f.get("bar_minutes", 1)))
        except Exception as e:  # unreadable feed is a finding, not a crash
            issues.append({"level": "amber", "check": "feed", "text": f"{f['name']}: unreadable ({str(e)[:80]})"})
            continue
        mm = market_minutes(last, now_aware)
        limit = int(f.get("max_stale_market_min", 30))
        if mm > limit:
            issues.append({"level": "red", "check": "feed",
                           "text": f"{f['name']} stale: newest bar ends {last.astimezone(ET):%a %H:%M} ET, {mm} market-min ago (limit {limit})"})


def check_jobs(cfg, issues):
    p = expand(cfg.get("forward_pane", ""))
    if not p or not os.path.exists(p):
        return
    spec = importlib.util.spec_from_file_location("forward_status", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for name, why in mod.stale_jobs():
        issues.append({"level": "red", "check": "job", "text": f"forward job {name}: {why}"})


def lse_today(cfg, now_aware):
    """Requests in the LSE call log stamped on today's local date: {count, limit}."""
    today = now_aware.date()
    near = {(today + dt.timedelta(days=d)).isoformat() for d in (-1, 0, 1)}
    count = 0
    with open(expand(cfg.get("lse_calls_log", "~/.lse_calls.log")), encoding="utf-8", errors="replace") as f:
        for line in f:
            if line[:10] not in near:
                continue
            try:
                stamp = dt.datetime.fromisoformat(line.split("\t", 1)[0].strip())
            except ValueError:
                continue
            if (stamp.astimezone() if stamp.tzinfo else stamp).date() == today:
                count += 1
    return {"count": count, "limit": int(cfg.get("lse_daily_limit", 15000))}


AGENT_ORDER = ("codex", "cline", "opencode", "amp", "atlarix", "copilot")
DISPATCH_LOG = re.compile(r"^([a-z]+)-(\d{8})-\d{6}(?:-(\d+))?\.log$")


def pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def job_state(path, pid):
    """ok/failed from dispatch.sh's verdict after its dispatch-exit line; else running
    while the dispatch pid lives, failed once it is gone without a verdict."""
    verdict, exited = None, False
    for line in tail(path, 8000):
        if line.startswith("dispatch-exit:"):
            exited, verdict = True, None
        elif exited and line.startswith("OK:"):
            verdict = "ok"
        elif exited and line.startswith("FAILED:"):
            verdict = "failed"
    if verdict:
        return verdict
    return "running" if pid and pid_alive(int(pid)) else "failed"


def agent_jobs(cfg, now_aware):
    """dispatch.sh jobs started today, plus any still running: [{agent, ok, running, failed}]."""
    d = expand(cfg.get("agent_logs", "~/Trading/_scratch/agent-pipeline/logs"))
    today = now_aware.strftime("%Y%m%d")
    counts = {}
    for name in os.listdir(d):
        m = DISPATCH_LOG.match(name)
        if not m:
            continue
        agent, day, pid = m.groups()
        state = job_state(os.path.join(d, name), pid)
        if day != today and state != "running":
            continue
        counts.setdefault(agent, {"ok": 0, "running": 0, "failed": 0})[state] += 1
    order = sorted(counts, key=lambda a: (AGENT_ORDER.index(a) if a in AGENT_ORDER else len(AGENT_ORDER), a))
    return [{"agent": a, **counts[a]} for a in order]


def overhead_tokens(cfg):
    """Description text listed every turn, ~4 chars a token: the enabled plugins' skills,
    commands and agents as `/profile measure` counts them, plus ~/.claude/skills."""
    spec = importlib.util.spec_from_file_location("profile_measure", expand(cfg.get("profile_script", "~/.claude/mods-src/profile/scripts/profile.py")))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
        rc = mod.main(["measure"])
    m = re.search(r"desc_chars (\d+)", out.getvalue())
    if rc != 0 or not m:
        raise RuntimeError("profile measure failed")
    chars = int(m.group(1))
    for path in glob.glob(expand(cfg.get("user_skills", "~/.claude/skills/*/SKILL.md"))):
        with open(path, encoding="utf-8", errors="replace") as f:
            chars += len(mod.folded_description(f.read()))
    return chars // 4


def stats(cfg, now_aware):
    out = {}
    for key, fn in (("lse", lambda: lse_today(cfg, now_aware)), ("jobs", lambda: agent_jobs(cfg, now_aware)),
                    ("overhead_tokens", lambda: overhead_tokens(cfg))):
        try:
            out[key] = fn()
        except Exception:  # an unreadable source draws as "unavailable"
            out[key] = None
    return out


def run(cfg_path=DEFAULT_CFG, now=None):
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    now = now or dt.datetime.now()
    now_aware = now.astimezone()
    issues = []
    for fn, args in ((check_logs, (cfg, now, issues)), (check_lse_key, (cfg, issues)),
                     (check_feeds, (cfg, now_aware, issues)), (check_jobs, (cfg, issues))):
        try:
            fn(*args)
        except Exception as e:  # a broken check reports itself
            issues.append({"level": "amber", "check": fn.__name__, "text": f"{fn.__name__} failed: {str(e)[:100]}"})
    level = "red" if any(i["level"] == "red" for i in issues) else ("amber" if issues else "ok")
    return {"level": level, "issues": issues, "checked_at": now_aware.isoformat(timespec="seconds"),
            "stats": stats(cfg, now_aware)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=DEFAULT_CFG)
    ap.add_argument("--text", action="store_true")
    a = ap.parse_args()
    res = run(a.config)
    if a.text:
        print(res["level"].upper(), res["checked_at"])
        for i in res["issues"]:
            print(f"  [{i['level']}] {i['text']}")
        print("  stats", json.dumps(res["stats"]))
    else:
        print(json.dumps(res))
    return 0


if __name__ == "__main__":
    sys.exit(main())
