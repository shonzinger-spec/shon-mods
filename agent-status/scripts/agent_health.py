#!/usr/bin/env python3
"""Per-agent health for the external-agent pipeline (stdlib only, no network, no quota spent unless --ping).

  agent_health.py --json            print the health contract and write ~/.claude/agent-status/health.json (atomically)
  agent_health.py --ping <lane>     also run one tiny real prompt through that lane's CLI (temp dir, 60 s) -> pings.json
Env (tests): DISPATCH_LANES_JSON, DISPATCH_LOG_DIR, AGENT_HEALTH_BIN_DIR (searched first), AGENT_HEALTH_NO_AUTOPING=1.
Free lanes (opencode, opencode-glm) are auto-pinged by --json when their last ping is >6 h old; the ping runs in a
detached child so --json stays fast, and shows up on the next call. Paid/quota lanes only ping on explicit --ping.
"""
import concurrent.futures as cf
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LANES_JSON = Path(os.environ.get("DISPATCH_LANES_JSON") or HERE / "lanes.json")
LOGDIR = Path(os.environ.get("DISPATCH_LOG_DIR") or HERE / "logs")
STATUS = Path.home() / ".claude" / "agent-status"
AUTOPING = ("opencode", "opencode-glm")
FRESH_DAYS, PING_STALE_H = 7, 6
CREDIT_RE = re.compile(r"out of credits|insufficient (credits?|balance|funds|quota)|quota (exceeded|exhausted)|exceeded your (current )?quota|credit balance is too low|add credits|usage limit (reached|exceeded)|payment required|premium requests? (limit|quota)")
AUTH_RE = re.compile(r"not (logged|signed) in|please (log|sign) ?in|sign in to |log ?in required|authentication (failed|required|error)|failed to authenticate|unauthori[sz]ed|invalid (api[ _-]?key|token|credentials)|oauth[^.]*expired|token (has )?expired|http 401|status( code)?[ :=]+401|401 unauthori")
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def now():
    return dt.datetime.now().astimezone()


def iso(d):
    return d.astimezone().isoformat(timespec="seconds")


def search_path():
    nvm = sorted((Path.home() / ".nvm/versions/node").glob("*/bin"))
    parts = [os.environ.get("AGENT_HEALTH_BIN_DIR", "")] + [str(p) for p in nvm[-1:]] + [
        str(Path.home() / ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
    return ":".join(p for p in parts if p)


def run_cmd(args, timeout, cwd=None):
    env = {"HOME": str(Path.home()), "PATH": search_path(), "TERM": "dumb", "NO_COLOR": "1", "LANG": "en_US.UTF-8"}
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, cwd=cwd, env=env, stdin=subprocess.DEVNULL)
        return p.returncode, ANSI.sub("", (p.stdout or "") + (p.stderr or ""))
    except subprocess.TimeoutExpired:
        return None, "timeout after %ss" % timeout
    except OSError as e:
        return None, str(e)


def load_lanes():
    return json.load(open(LANES_JSON))["lanes"]


def read_json(p, default):
    try:
        return json.load(open(p))
    except Exception:
        return default


def atomic_write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".")
    with os.fdopen(fd, "w") as f:
        json.dump(obj, f, indent=2)
    os.replace(tmp, path)


def newest_log(lane):
    rx = re.compile(r"^%s-(\d{8})-(\d{6})(?:-\d+)?\.log$" % re.escape(lane))
    cands = []
    for p in LOGDIR.glob(lane + "-*.log"):
        m = rx.match(p.name)
        if m:
            cands.append((m.group(1) + m.group(2), p))
    for stamp, p in sorted(cands, reverse=True):
        verdict = None
        for line in p.read_text(errors="replace").splitlines()[-40:]:
            if line.startswith(("OK:", "FAILED:")):
                verdict = line.strip()[:160]
        if verdict:
            at = dt.datetime.strptime(stamp, "%Y%m%d%H%M%S").astimezone()
            return {"at": at, "verdict": verdict}
    return None


def classify_text(text):
    t = text.lower()
    if CREDIT_RE.search(t):
        return "credits"
    if AUTH_RE.search(t):
        return "sign-in"
    return None


def loop_signal(cfg):
    """Newest nightly-loop result for a token-file lane: (time, verdict) or None. Reads only the run report files."""
    import glob
    files = sorted(glob.glob(os.path.expanduser(cfg["run_glob"])), key=os.path.getmtime, reverse=True)
    for f in files[:10]:
        try:
            text = Path(f).read_text(errors="replace")[:20000]
        except OSError:
            continue
        m = re.search(r"^VERDICT: (\w+)(.*)$", text, re.M)
        if not m or m.group(1) == "SKIPPED":
            continue
        at, name = dt.datetime.fromtimestamp(os.path.getmtime(f)).astimezone(), os.path.basename(f)
        if m.group(1) == "DONE":
            return at, "OK: nightly run DONE (%s)" % name
        if "auth" in m.group(2).lower() or AUTH_RE.search(text.lower()):
            return at, "FAILED:sign-in | nightly run %s" % name
        return at, "FAILED:nightly-run | %s%s" % (name, m.group(2)[:80])
    return None


def verdict_kind(v):
    if v.startswith("OK:"):
        return "ok"
    if v.startswith("FAILED:sign-in"):
        return "sign-in"
    if v.startswith("FAILED:out-of-credits"):
        return "credits"
    return "other"


def do_ping(lane, cfg):
    binp = shutil.which(cfg["binary"], path=search_path())
    if cfg.get("ping") is None or cfg.get("disabled") or not binp:
        return {"at": iso(now()), "ok": None, "verdict": "ping not available", "detail": ""}
    with tempfile.TemporaryDirectory() as tmp:
        args = [a.replace("{model}", cfg["models"][0]["id"]).replace("{cwd}", tmp) for a in cfg["ping"]]
        rc, out = run_cmd([binp] + args, 60, cwd=tmp)
    kind = classify_text(out)
    if kind:
        verdict = "FAILED:" + ("out-of-credits" if kind == "credits" else "sign-in")
    elif rc == 0 and out.strip():
        verdict = "OK: ping"
    else:
        verdict = "FAILED:ping-exit-%s" % rc
    rec = {"at": iso(now()), "ok": verdict.startswith("OK"), "verdict": verdict, "detail": out.strip()[-200:].replace("\n", " ")}
    pings = read_json(STATUS / "pings.json", {})
    pings[lane] = rec
    atomic_write(STATUS / "pings.json", pings)
    return rec


def token_info(cfg):
    p = Path(os.path.expanduser(cfg["token_file"]))
    if not p.exists():
        return None
    st = p.stat()  # existence, size, mtime only; the content is never read
    return {"size": st.st_size, "mtime": dt.datetime.fromtimestamp(st.st_mtime).astimezone()}


def auth_state(cfg, binp):
    spec = cfg.get("auth")
    if not spec or not binp:
        return None, "no non-spending status command"
    rc, out = run_cmd([binp] + spec["cmd"], 5)
    if rc is None:
        return None, "`%s` %s" % (" ".join([cfg["binary"]] + spec["cmd"]), out)
    low = out.lower()
    if "count_re" in spec:
        m = re.search(spec["count_re"], low)
        if not m:
            return None, "`%s`: unparseable" % " ".join([cfg["binary"]] + spec["cmd"])
        n = int(m.group(1))
        return ("in" if n > 0 else "out"), "`%s`: %d credential(s)" % (" ".join([cfg["binary"]] + spec["cmd"]), n)
    state = "out" if spec["out"] in low else ("in" if spec["in"] in low else None)
    return state, "`%s`: %s" % (" ".join([cfg["binary"]] + spec["cmd"]), out.strip().splitlines()[0][:60] if out.strip() else "no output")


def agent_row(lane, cfg, pings):
    fix, models = cfg.get("fix", {}), cfg["models"]
    model, label = models[0]["id"], models[0]["label"]
    gs = Path.home() / ".cline" / "data" / "globalState.json"
    if lane == "cline" and gs.exists():
        mid = read_json(gs, {}).get("actModeClineModelId")
        if mid:
            model = mid
            label = next((m["label"] for m in models if m["id"] == mid), mid)
    row = {"id": lane, "name": cfg["label"], "model": model, "model_label": label, "works": None, "state": "unknown",
           "reason": None, "user_fix": None, "last_run": None, "fallback": [m["label"] for m in models[1:] if m.get("free")], "checked": ""}
    sign_in = {"label": "Sign in", "command": fix.get("sign_in")}
    credits = {"label": "Add credits", "url": fix.get("credits_url")}
    checked = []
    binp = shutil.which(cfg["binary"], path=search_path())
    log = None if cfg.get("dispatch") is False else newest_log(lane)
    if log:
        row["last_run"] = {"at": iso(log["at"]), "verdict": log["verdict"]}
    if cfg.get("disabled"):
        row.update(works=False, state="disabled", reason=cfg.get("disabled_reason", "disabled"), user_fix=credits,
                   checked="marked disabled in lanes.json; no checks run")
        return row
    if not binp:
        row.update(works=False, state="down", reason="%s is not installed or not on PATH" % cfg["binary"],
                   user_fix={"label": "Install", "command": fix.get("install")}, checked="binary lookup on PATH failed")
        return row
    rc, out = run_cmd([binp, "--version"], 5)
    checked.append("--version %s" % (out.strip().splitlines()[0][:40] if rc == 0 and out.strip() else "failed (%s)" % (out.strip()[:40] or rc)))
    auth, desc = None, None
    if cfg.get("token_file"):
        tok = token_info(cfg)
        if tok is None:
            row.update(works=False, state="down", reason="Claude login token file is missing", user_fix=sign_in,
                       checked="; ".join(checked + ["token file absent"]))
            return row
        checked.append("token file present (%d B, saved %s; content not read)" % (tok["size"], tok["mtime"].strftime("%Y-%m-%d")))
    else:
        auth, desc = auth_state(cfg, binp)
        checked.append(desc)
    sigs = []
    if log:
        sigs.append((log["at"], verdict_kind(log["verdict"]), log["verdict"], "newest dispatch log %s %s" % (log["at"].strftime("%Y-%m-%d %H:%M"), log["verdict"][:40])))
    if cfg.get("run_glob"):
        ls = loop_signal(cfg)
        if ls:
            sigs.append((ls[0], verdict_kind(ls[1]), ls[1], "nightly run %s %s" % (ls[0].strftime("%Y-%m-%d %H:%M"), ls[1][:50])))
    pg = pings.get(lane)
    if pg and pg.get("ok") is not None:
        pat = dt.datetime.fromisoformat(pg["at"])
        sigs.append((pat, verdict_kind(pg["verdict"]), pg["verdict"], "ping %s %s" % (pat.strftime("%Y-%m-%d %H:%M"), pg["verdict"][:40])))
    sig = max(sigs, key=lambda s: s[0]) if sigs else None
    if sig:
        checked.append(sig[3])
    else:
        checked.append("no dispatch log or ping")
    works, reason, ufix = None, None, None
    if auth == "out":
        works, reason, ufix = False, "CLI reports it is logged out", sign_in
    elif sig and sig[1] == "ok":
        age = (now() - sig[0]).days
        if age <= FRESH_DAYS:
            works = True
        else:
            reason = "last OK run was %d days ago" % age
    elif sig and sig[1] == "sign-in":
        if auth == "in":
            reason = "last run failed to sign in but the CLI now reports logged in; ping to confirm"
        else:
            works, reason, ufix = False, "sign-in needed: " + sig[2][:100], sign_in
    elif sig and sig[1] == "credits":
        works, reason, ufix = False, "out of credits: " + sig[2][:100], credits
    elif sig:
        reason = "last run failed: " + sig[2][:120]
    elif auth == "in":
        reason = "logged in; no run recorded yet"
    elif cfg.get("token_file"):
        reason = "token file present; not tested (a test spends subscription quota)"
    else:
        reason = "no run recorded and no status command"
    row.update(works=works, state="ok" if works else ("down" if works is False else "unknown"), reason=reason, user_fix=ufix,
               checked="; ".join(checked))
    return row


def maybe_autoping(lanes, pings):
    if os.environ.get("AGENT_HEALTH_NO_AUTOPING"):
        return
    for lane in AUTOPING:
        cfg = lanes.get(lane)
        if not cfg or cfg.get("disabled") or not shutil.which(cfg["binary"], path=search_path()):
            continue
        pg = pings.get(lane)
        if pg and (now() - dt.datetime.fromisoformat(pg["at"])).total_seconds() < PING_STALE_H * 3600:
            continue
        lock = STATUS / ("ping-%s.lock" % lane)
        if lock.exists() and (now().timestamp() - lock.stat().st_mtime) < 120:
            continue
        STATUS.mkdir(parents=True, exist_ok=True)
        lock.touch()
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--ping", lane, "--quiet"], stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def read_events():
    out = []
    p = LOGDIR / "events.jsonl"
    if p.exists():
        for i, line in enumerate(p.read_text().splitlines()):
            try:
                e = json.loads(line)
                out.append((e.get("at", ""), i, {k: e.get(k) for k in ("at", "lane", "kind", "from", "to", "text")}))
            except ValueError:
                continue
    out.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [e for _, _, e in out[:20]]


def build():
    lanes = load_lanes()
    pings = read_json(STATUS / "pings.json", {})
    with cf.ThreadPoolExecutor(max_workers=len(lanes)) as ex:
        rows = list(ex.map(lambda kv: agent_row(kv[0], kv[1], pings), lanes.items()))
    maybe_autoping(lanes, pings)
    return {"checked_at": iso(now()), "agents": rows, "events": read_events()}


def main(argv):
    quiet = "--quiet" in argv
    if "--ping" in argv:
        lane = argv[argv.index("--ping") + 1]
        lanes = load_lanes()
        if lane not in lanes:
            print("unknown lane: " + lane, file=sys.stderr)
            return 2
        rec = do_ping(lane, lanes[lane])
        (STATUS / ("ping-%s.lock" % lane)).unlink(missing_ok=True)
        if not quiet and "--json" not in argv:
            print(json.dumps({lane: rec}, indent=2))
        if quiet:
            return 0
    if "--json" in argv or "--ping" not in argv:
        data = build()
        atomic_write(STATUS / "health.json", data)
        if "--json" in argv:
            print(json.dumps(data))
        else:
            for a in data["agents"]:
                print("%-16s %-9s %-34s %s" % (a["id"], a["state"], a["model_label"], a["reason"] or ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
