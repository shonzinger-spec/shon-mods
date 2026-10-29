"""Weekly friction review: scan Claude Code transcripts, write a report, ask whether to open it.

IO shell around friction.core. Standard library only, Python 3.9 compatible, no network.
Usage: python3 scan.py [--days 7] [--out DIR] [--no-notify] [--now ISO] [--projects DIR]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Tuple

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from friction import core  # noqa: E402

MAX_BYTES = 50 * 1024 * 1024
INVOCATION_DAYS = 30
MOD_MARKETPLACE = "shon-mods"
HOME = os.path.expanduser("~")
DEFAULT_OUT = os.path.join(HOME, ".claude", "friction-review")
DEFAULT_PROJECTS = os.path.join(HOME, ".claude", "projects")
DEFAULT_PLUGINS = os.path.join(HOME, ".claude", "plugins", "installed_plugins.json")
DEFAULT_SETTINGS = os.path.join(HOME, ".claude", "settings.json")
_COMMAND_RE = re.compile(r"<command-name>/?([^<\s]+)</command-name>")


def _open(path: str):
    """The one place transcripts are opened (tests wrap it to prove one-file-at-a-time streaming)."""
    return open(path, "r", encoding="utf-8", errors="replace")


def parse_ts(value: object) -> Optional[datetime]:
    """ISO-8601 (with Z or an offset, or naive = UTC) to an aware datetime; None when unusable."""
    if not isinstance(value, str) or not value:
        return None
    s = value.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    s = re.sub(r"(\.\d{6})\d+", r"\1", s)  # py3.9 fromisoformat wants 3 or 6 fractional digits
    s = re.sub(r"\.(\d{1,5})(?=[+-]|$)", lambda m: "." + m.group(1).ljust(6, "0"), s)
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def invoked_plugin(tool: str, tool_input: object, plugins: Sequence[str],
                   bare_skills: Optional[Dict[str, str]] = None) -> Optional[str]:
    """Which plugin does this tool call exercise? Skill 'p:s' and Agent/Task subagent_type 'p:a'
    name it before the colon; mcp__plugin_<plugin>_<server>__<tool> is matched against the known
    plugin names (longest first); a bare skill name is looked up in bare_skills."""
    inp = tool_input if isinstance(tool_input, dict) else {}
    if tool == "Skill":
        name = inp.get("skill")
        if not isinstance(name, str) or not name:
            return None
        if ":" in name:
            return name.split(":", 1)[0]
        return (bare_skills or {}).get(name)
    if tool in ("Agent", "Task"):
        name = inp.get("subagent_type")
        if isinstance(name, str) and ":" in name:
            return name.split(":", 1)[0]
        return None
    if tool.startswith("mcp__plugin_"):
        rest = tool[len("mcp__plugin_"):]
        for p in sorted(plugins, key=len, reverse=True):
            if rest.startswith(p + "_"):
                return p
    return None


def _count_dir(path: str, want_dirs: bool) -> int:
    try:
        names = os.listdir(path)
    except OSError:
        return 0
    n = 0
    for name in names:
        full = os.path.join(path, name)
        if name.startswith("."):
            continue
        if want_dirs and os.path.isdir(full):
            n += 1
        elif not want_dirs and name.endswith(".md"):
            n += 1
    return n


def _mcp_count(install: str) -> int:
    try:
        with open(os.path.join(install, ".mcp.json"), encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return 0
    if isinstance(data, dict):
        servers = data.get("mcpServers", data)
        if isinstance(servers, dict):
            return len(servers)
    return 0


def _has_hooks(install: str) -> int:
    if not install:
        return 0
    if os.path.isfile(os.path.join(install, "hooks", "hooks.json")):
        return 1
    try:
        with open(os.path.join(install, ".claude-plugin", "plugin.json"), encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return 0
    return 1 if isinstance(data, dict) and "hooks" in data else 0


def discover_installed(plugins_json: str, settings_json: str) -> Tuple[Dict[str, Dict[str, object]], Dict[str, str]]:
    """Enabled plugins -> {name: {skills, agents, mcp, is_mod, hooks}}, plus bare skill name -> plugin."""
    try:
        with open(plugins_json, encoding="utf-8") as f:
            plugins = json.load(f).get("plugins", {})
    except (OSError, ValueError, AttributeError):
        return {}, {}
    enabled = None
    try:
        with open(settings_json, encoding="utf-8") as f:
            e = json.load(f).get("enabledPlugins")
        if isinstance(e, dict):
            enabled = e
    except (OSError, ValueError, AttributeError):
        pass
    out: Dict[str, Dict[str, object]] = {}
    bare: Dict[str, str] = {}
    for key, entries in plugins.items():
        if enabled is not None and not enabled.get(key):
            continue
        name, _, market = key.partition("@")
        install = ""
        if isinstance(entries, list) and entries and isinstance(entries[0], dict):
            install = str(entries[0].get("installPath") or "")
        skills_dir = os.path.join(install, "skills")
        out[name] = {
            "skills": _count_dir(skills_dir, True) + _count_dir(os.path.join(install, "commands"), False),
            "agents": _count_dir(os.path.join(install, "agents"), False),
            "mcp": _mcp_count(install) if install else 0,
            "is_mod": market == MOD_MARKETPLACE,
            "hooks": _has_hooks(install),
        }
        try:
            for s in os.listdir(skills_dir):
                bare.setdefault(s, name)
        except OSError:
            pass
    return out, bare


def scan_file(path: str, session: str, friction_from: Optional[datetime], inv_from: datetime,
              plugins: Sequence[str], bare: Dict[str, str], mtime: datetime) -> Tuple[List[core.Hit], Counter]:
    """Stream one transcript line by line. Friction hits only for events at or after friction_from
    (None = this file has none in the window); invocations for events at or after inv_from."""
    hits: List[core.Hit] = []
    inv: Counter = Counter()
    ctx = core.Ctx()
    with _open(path) as fh:
        for raw in fh:
            ev = core.parse_line(raw, default_session=session)
            if ev is None:
                continue
            ts = parse_ts(ev.ts) or mtime
            if friction_from is not None:
                for h in core.classify(ev, ctx):
                    if ts >= friction_from:
                        hits.append(h)
            if ts < inv_from:
                continue
            for tu in ev.tool_uses:
                p = invoked_plugin(tu.name, tu.input, plugins, bare)
                if p:
                    inv[p] += 1
            if ev.kind == "user" and ev.text and len(ev.text) < 2000:
                for m in _COMMAND_RE.finditer(ev.text):
                    if ":" in m.group(1):
                        inv[m.group(1).split(":", 1)[0]] += 1
    return hits, inv


def run(projects_dir: str, out_dir: str, now: datetime, days: int = 7, *,
        installed: Optional[Dict[str, Dict[str, object]]] = None, bare: Optional[Dict[str, str]] = None,
        max_bytes: int = MAX_BYTES, date: Optional[str] = None) -> Dict[str, object]:
    """Scan, write reports/DATE.md and latest.json under out_dir, return the latest.json dict."""
    installed = installed or {}
    bare = bare or {}
    names = list(installed)
    friction_from = now - timedelta(days=days)
    inv_from = now - timedelta(days=max(days, INVOCATION_DAYS))
    hits: List[core.Hit] = []
    inv: Counter = Counter()
    skipped: List[Tuple[str, int]] = []
    scanned = 0
    for path in sorted(glob.glob(os.path.join(projects_dir, "*", "*.jsonl"))):
        try:
            st = os.stat(path)
        except OSError:
            continue
        mtime = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc)
        if mtime < inv_from:
            continue
        label = os.path.join(os.path.basename(os.path.dirname(path)), os.path.basename(path))
        if st.st_size > max_bytes:
            skipped.append((label, st.st_size))
            continue
        session = os.path.splitext(os.path.basename(path))[0]
        try:
            h, i = scan_file(path, session, friction_from if mtime >= friction_from else None,
                             inv_from, names, bare, mtime)
        except OSError as err:
            print("skip unreadable file: %s" % err.__class__.__name__, file=sys.stderr)
            continue
        scanned += 1
        hits.extend(h)
        inv.update(i)
    summary = core.aggregate(hits, top_n=20)
    unused = core.find_unused(installed, inv)
    date = date or now.date().isoformat()
    md = core.render_markdown(summary, unused, skipped, {"date": date, "days": days, "files": scanned})
    report = os.path.join(out_dir, "reports", date + ".md")
    _atomic_write(report, md)
    latest = {
        "date": date, "path": report,
        "counts": {"total": summary.total, "patterns": summary.patterns},
        "top3": [{"pattern": r.pattern, "count": r.count, "sessions": r.sessions} for r in summary.rows[:3]],
    }
    _atomic_write(os.path.join(out_dir, "latest.json"), json.dumps(latest, indent=2) + "\n")
    return latest


def _atomic_write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = "%s.tmp.%d" % (path, os.getpid())
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--projects", default=DEFAULT_PROJECTS)
    ap.add_argument("--no-notify", action="store_true")
    ap.add_argument("--now", default=None, help="ISO timestamp to treat as now (testing)")
    args = ap.parse_args(argv)
    if args.now:
        now = parse_ts(args.now)
        if now is None:
            print("bad --now", file=sys.stderr)
            return 2
        date = args.now[:10]
    else:
        now = datetime.now(timezone.utc)
        date = datetime.now().date().isoformat()
    installed, bare = discover_installed(DEFAULT_PLUGINS, DEFAULT_SETTINGS)
    latest = run(args.projects, args.out, now, args.days, installed=installed, bare=bare, date=date)
    counts = latest["counts"]
    print("report: %s (%d hits, %d patterns)" % (latest["path"], counts["total"], counts["patterns"]))  # type: ignore[index]
    if not args.no_notify and counts["patterns"]:  # type: ignore[index]
        from friction import notify
        notify.notify(str(latest["path"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
