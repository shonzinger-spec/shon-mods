#!/usr/bin/env python3
"""health-band watchdog: missed Claude desktop scheduled-task runs and failed or missed launchd jobs.

check(cfg, now, issues) appends {level, check: "watchdog", text} rows to `issues`:
  red   : a cron scheduled task whose lastRunAt is older than its latest due time; a launchd job
          (watchdog_regex, minus labels the forward pane already covers) that is not loaded, exited
          non-zero, is a stopped daemon, missed its calendar/interval run, or whose success marker
          is stale.
  amber : a one-time scheduled task past its fireAt that never ran; a job with a known_issues note.
The desktop app keeps no per-run status, so a FAILED scheduled run cannot be seen, only a missed one.
`now` is a naive local datetime.
"""
import datetime as dt, glob, importlib.util, json, os, plistlib, re

HERE = os.path.dirname(os.path.abspath(__file__))
TASK_GRACE = dt.timedelta(minutes=15)   # app jitter seen: ~3 min
RUN_SLACK = dt.timedelta(minutes=2)
ONE_TIME_GRACE = dt.timedelta(minutes=30)
DEFAULT_TASKS = "~/Library/Application Support/Claude/claude-code-sessions/*/*/scheduled-tasks.json"
DEFAULT_REGEX = r"^com\.(secondbrain|propfarm|autorank|example\.youtube)"


def expand(p):
    return os.path.expanduser(p)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def local_naive(iso):
    """ISO timestamp (usually ...Z) -> local naive datetime, or None."""
    try:
        t = dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t.astimezone().replace(tzinfo=None) if t.tzinfo else t


def row(level, text):
    return {"level": level, "check": "watchdog", "text": text}


def check_tasks(cfg, now, issues, last_fire):
    for path in sorted(glob.glob(expand(cfg.get("scheduled_tasks_glob", DEFAULT_TASKS)))):
        try:
            with open(path, encoding="utf-8") as f:
                tasks = json.load(f).get("scheduledTasks", [])
        except (OSError, ValueError, AttributeError):
            continue
        for t in tasks:
            if not isinstance(t, dict) or not t.get("enabled", True):
                continue
            name = t.get("displayName") or t.get("id") or "?"
            last = local_naive(t["lastRunAt"]) if t.get("lastRunAt") else None
            if t.get("cronExpression"):
                due = last_fire(t["cronExpression"], now - TASK_GRACE)
                if due is None:
                    continue
                created = t.get("createdAt")
                if last is None and isinstance(created, (int, float)) and dt.datetime.fromtimestamp(created / 1000) > due:
                    continue  # created after the latest due time: nothing was missed yet
                if last is None or last < due - RUN_SLACK:
                    issues.append(row("red", f"scheduled task {name}: missed run due {due:%a %H:%M}"))
            elif isinstance(t.get("fireAt"), (int, float)):
                fire = dt.datetime.fromtimestamp(t["fireAt"] / 1000)
                if fire < now - ONE_TIME_GRACE and last is None:
                    issues.append(row("amber", f"one-time task {name} never ran (due {fire:%a %H:%M})"))


def short_name(label):
    return label[4:] if label.startswith("com.") else label


def check_launchd(cfg, now, issues, launchctl_fn):
    fs_path = expand(cfg.get("forward_pane", ""))
    if not fs_path or not os.path.exists(fs_path):
        return
    fs = load("forward_status", fs_path)
    lc = (launchctl_fn or fs.launchctl)()
    wd = re.compile(cfg.get("watchdog_regex", DEFAULT_REGEX), re.I)
    covered = re.compile(cfg["label_regex"], re.I) if cfg.get("label_regex") else None
    markers, known = cfg.get("success_markers", {}), cfg.get("known_issues", {})
    skip = set(cfg.get("skip_labels", []))
    for plist in sorted(glob.glob(os.path.join(expand(cfg.get("launch_agents_dir", "~/Library/LaunchAgents")), "*.plist"))):
        try:
            with open(plist, "rb") as f:
                pl = plistlib.load(f)
        except Exception:
            continue
        label = pl.get("Label", "")
        if label in skip or not wd.search(label) or (covered and covered.search(label)):
            continue
        logs = [p for p in (pl.get("StandardOutPath"), pl.get("StandardErrorPath")) if p]
        pid, status = lc.get(label, (None, None))
        marker = markers.get(label)
        if marker:
            last = fs.mtime(expand(marker["file"]))
        else:
            times = [t for t in (fs.mtime(p) for p in logs) if t]
            last = max(times) if times else None
        why = []
        if label not in lc:
            why.append("not loaded in launchd")
        elif pid is None and status not in (0, None):
            hit = next((h for p in logs for h in reversed(fs.tail_errors(p, keep=1))), "")
            why.append(f"last exit {status}" + (f" ({hit[:100]})" if hit else ""))
        if label in lc and pid is None:
            if pl.get("KeepAlive") and status in (0, None):
                why.append("daemon not running")
            elif "StartInterval" in pl and last and (now - last).total_seconds() > 3 * int(pl["StartInterval"]) + fs.GRACE.total_seconds():
                why.append("missed 3+ intervals")
            elif pl.get("StartCalendarInterval"):
                due = fs.last_calendar_run(pl["StartCalendarInterval"], now)
                if due and (last is None or last < due - RUN_SLACK):
                    why.append(f"missed run due {due:%a %H:%M}")
        if marker and label in lc and pid is None:
            limit = float(marker.get("max_age_hours", 36))
            if last is None:
                why.append("success marker missing")
            elif (now - last).total_seconds() > limit * 3600:
                age = (now - last).total_seconds() / 3600
                why.append(f"no success for {int(age // 24)}d {int(age % 24)}h (limit {limit:g}h)")
        if why:
            if label in known:
                issues.append(row("amber", f"launchd {short_name(label)}: {known[label]}"))
            else:
                issues.append(row("red", f"launchd {short_name(label)}: " + "; ".join(why)))


def check(cfg, now, issues, launchctl_fn=None):
    last_fire = load("cron_due", os.path.join(HERE, "cron_due.py")).last_fire
    check_tasks(cfg, now, issues, last_fire)
    check_launchd(cfg, now, issues, launchctl_fn)
