"""Read-only scan of the desktop app's per-chat files. Prints {"now_ms", "rows"} as JSON.

usage: scan_chats.py [--running id,id] [--now ms] [--sessions-root dir] [--projects-root dir]
Archived chats and routine (scheduledTaskId) chats are left out. The transcript is read
(last 400 KB, read-only) only for chats classified as waiting, to get the exact question.
"""
import argparse
import glob
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify import classify, tail_info  # noqa: E402
from parse_reset import parse_reset  # noqa: E402

HOME = os.path.expanduser("~")
SESSIONS = os.path.join(HOME, "Library/Application Support/Claude/claude-code-sessions")
PROJECTS = os.path.join(HOME, ".claude/projects")
TAIL_BYTES = 400_000


def read_tail_lines(path):
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - TAIL_BYTES))
            data = f.read()
    except OSError:
        return []
    lines = data.decode("utf-8", "replace").split("\n")
    if size > TAIL_BYTES:
        lines = lines[1:]  # first line is probably cut in half
    return lines


def find_transcript(projects_root, cli_id):
    if not isinstance(cli_id, str) or not cli_id or "/" in cli_id:
        return None
    hits = glob.glob(os.path.join(projects_root, "*", cli_id + ".jsonl"))
    return hits[0] if hits else None


def scan(sessions_root, projects_root, running, now_ms):
    rows = []
    for path in glob.glob(os.path.join(sessions_root, "*", "*", "local_*.json")):
        try:
            with open(path) as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        if not isinstance(d, dict) or not isinstance(d.get("sessionId"), str):
            continue
        res = classify(d, running, now_ms)
        if res["status"] == "skip":
            continue
        if res["status"] == "waiting":
            tp = find_transcript(projects_root, d.get("cliSessionId"))
            if tp:
                res = classify(d, running, now_ms, tail_info(read_tail_lines(tp)))
        err = d.get("error")
        act = d.get("lastActivityAt")
        err_at = d.get("errorAt")
        stalled_err = isinstance(err, str) and res["status"] == "stalled"
        rows.append({
            "sessionId": d["sessionId"],
            "title": d.get("title") if isinstance(d.get("title"), str) and d.get("title") else "(untitled)",
            "status": res["status"],
            "kind": res["kind"],
            "question": res["question"],
            "question_source": res["question_source"],
            "last_activity_ms": act if isinstance(act, int) and not isinstance(act, bool) else None,
            "error": err[:200] if stalled_err else None,
            "error_at_ms": err_at if stalled_err and isinstance(err_at, int) and not isinstance(err_at, bool) else None,
            # {kind, reset_at_ms} when the error text is a usage-limit message, else None
            "limit": parse_reset(err, err_at) if stalled_err and isinstance(err_at, int) and not isinstance(err_at, bool) else None,
        })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--running", default="")
    ap.add_argument("--now", type=int, default=int(time.time() * 1000))
    ap.add_argument("--sessions-root", default=SESSIONS)
    ap.add_argument("--projects-root", default=PROJECTS)
    a = ap.parse_args()
    running = {x for x in a.running.split(",") if x}
    json.dump({"now_ms": a.now, "rows": scan(a.sessions_root, a.projects_root, running, a.now)}, sys.stdout)


if __name__ == "__main__":
    main()
