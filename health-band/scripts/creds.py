#!/usr/bin/env python3
"""health-band credential and backup checks: AutoRank backup, headless Claude auth, YouTube sign-in.

The pure helpers return None (healthy) or (level, text). check(cfg, now, issues) reads the files
named in health.json and appends {level, check, text} rows. The headless OAuth token file is only
ever stat()ed (size, mtime): its content is never opened, read or printed.
Unsupported on purpose: the interactive login's expiry (macOS keychain item `Claude Code-credentials`,
readable only through a keychain prompt). Dates come from the log lines, never from file mtimes, except
the token file's age, which is an estimate.
"""
import datetime as dt, glob, os, re

BACKUP_OK = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})Z\s+backed up\b")
STAMP = re.compile(r"(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(Z?)")
AUTH_ERR = re.compile(r"authentication_error|OAuth token has (?:expired|been revoked)|invalid x-api-key|Invalid bearer|API Error: 401|Please run /login", re.I)
YT_REVOKED = re.compile(r"invalid_grant|Token has been expired or revoked|RefreshError", re.I)
YT_UPLOADED = re.compile(r"LIVE: https://youtu\.be/")
BACKUP_FIX_KEY = "com.autorank.backup"


def expand(p):
    return os.path.expanduser(p)


def line_time(line):
    """Local naive datetime of a stamp in the line ('[2026-10-29 12:00:00]' local, '...T..Z' UTC), or None."""
    m = STAMP.search(line)
    if not m:
        return None
    try:
        t = dt.datetime.strptime(f"{m.group(1)} {m.group(2)}", "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    if m.group(3):
        t = t.replace(tzinfo=dt.timezone.utc).astimezone().replace(tzinfo=None)
    return t


def err_line(err_text):
    """Last useful line of an .err file (the generic 'unexpected end of file' tail is skipped)."""
    for line in reversed((err_text or "").splitlines()):
        line = line.strip()
        if line and "unexpected end of file" not in line:
            line = line.replace(os.path.expanduser("~"), "~")
            return line if len(line) <= 110 else "..." + line[-107:]
    return ""


def backup_status(log_text, err_text, now, max_age_hours=36):
    if log_text is None:
        return "red", "AutoRank backup: no log file, it has never reported a success"
    last = None
    for line in log_text.splitlines():
        m = BACKUP_OK.match(line)
        if m:
            t = dt.datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=dt.timezone.utc).astimezone().replace(tzinfo=None)
            if last is None or t > last:
                last = t
    if last is None:
        return "amber", "AutoRank backup: no 'backed up' line found in its log (format changed?)"
    age = now - last
    if age.total_seconds() <= max_age_hours * 3600:
        return None
    days = round(age.total_seconds() / 86400)
    text = f"AutoRank backup: last success {last:%Y-%m-%d} ({days} days ago)"
    hit = err_line(err_text)
    return "red", text + (f"; {hit}" if hit else "")


def token_age_status(st, now, valid_days, warn_days):
    """st: os.stat result of the token file (or None). Only st_size and st_mtime are used."""
    if st is None:
        return "red", "headless Claude token file missing"
    if st.st_size == 0:
        return "red", "headless Claude token file is empty"
    age_days = (now - dt.datetime.fromtimestamp(st.st_mtime)).total_seconds() / 86400
    left = int(valid_days - age_days)
    if left <= 0:
        return "red", f"headless Claude token is {int(age_days)} days old, past its estimated {valid_days}-day life: run `claude setup-token` again"
    if left <= warn_days:
        return "amber", f"headless Claude token expires in ~{left} days (estimated from file age, {valid_days}-day life assumed)"
    return None


def scan_auth_errors(lines, now=None, window_hours=24):
    """Name of the first auth-rejection pattern found, else None. Never returns the line itself.
    A line carrying a timestamp older than the window is ignored; unstamped lines count."""
    for line in lines:
        m = AUTH_ERR.search(line)
        if not m:
            continue
        if now is not None:
            t = line_time(line)
            if t is not None and (now - t).total_seconds() > window_hours * 3600:
                continue
        return m.group(0)
    return None


def youtube_status(st, log_lines, now, log_mtime=None, window_hours=48, stale_days=6):
    if st is None:
        return "amber", "YouTube: not signed in (credentials/token.json missing)"
    fresh_log = log_mtime is None or (now - log_mtime).total_seconds() <= window_hours * 3600
    if fresh_log:
        for line in log_lines:
            m = YT_REVOKED.search(line)
            if not m:
                continue
            t = line_time(line)
            if t is not None and (now - t).total_seconds() > window_hours * 3600:
                continue
            return "red", f"YouTube: Google sign-in rejected ({m.group(0)}): re-run pipeline.py --auth-only"
    age_days = (now - dt.datetime.fromtimestamp(st.st_mtime)).total_seconds() / 86400
    if age_days > stale_days and not any(YT_UPLOADED.search(line) for line in log_lines):
        return "amber", (f"YouTube: token.json is {int(age_days)} days old and no upload is logged since; "
                         "a consent screen in Testing mode kills refresh tokens after 7 days")
    return None


def read_text(path, nbytes=60000):
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - nbytes))
            return f.read().decode("utf-8", "replace")
    except OSError:
        return None


def stat_or_none(path):
    try:
        return os.stat(path)
    except OSError:
        return None


def add(issues, status, check, extra=""):
    if status:
        issues.append({"level": status[0], "check": check, "text": status[1] + extra})


def check(cfg, now, issues):
    b = cfg.get("backup")
    if b:
        fix = cfg.get("known_issues", {}).get(BACKUP_FIX_KEY)
        status = backup_status(read_text(expand(b["log"])), read_text(expand(b["err"])) if b.get("err") else "", now,
                               float(b.get("max_age_hours", 36)))
        add(issues, status, "backup", f". Fix: {fix}" if fix and status and status[0] == "red" else "")
    o = cfg.get("oauth_token")
    if o:
        add(issues, token_age_status(stat_or_none(expand(o["path"])), now, float(o.get("valid_days", 365)), float(o.get("warn_days", 30))),
            "oauth-token")
        for pattern in o.get("scan_logs", []):
            for path in sorted(glob.glob(expand(pattern))):
                st = stat_or_none(path)
                if not st or (now - dt.datetime.fromtimestamp(st.st_mtime)).total_seconds() > 24 * 3600:
                    continue
                hit = scan_auth_errors((read_text(path) or "").splitlines(), now, 24)
                if hit:
                    issues.append({"level": "red", "check": "oauth-token",
                                   "text": f"headless auth rejected in {os.path.basename(path)} ({hit})"})
    y = cfg.get("youtube")
    if y:
        log = expand(y["log"]) if y.get("log") else None
        lst = stat_or_none(log) if log else None
        lines = (read_text(log) or "").splitlines() if lst else []
        add(issues, youtube_status(stat_or_none(expand(y["token"])), lines, now,
                                   dt.datetime.fromtimestamp(lst.st_mtime) if lst else None), "youtube")
