#!/usr/bin/env python3
"""commit-queue: scan configured git repos for uncommitted work, grouped by top-level
folder, and commit one group at a time as the user, never pushing.

  commit_queue.py [--config F] scan
  commit_queue.py [--config F] stat   <repo> <group>
  commit_queue.py [--config F] commit <repo> <group> [-m MSG] [--expect-hash H]

Every subcommand prints one JSON object. Nothing here pushes, resets, checks out,
stashes, amends or skips hooks. Files that look secret, are oversize, or hold a
secret-looking added line are withheld: never staged, listed so the user commits
them by hand.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cq_paths import group_key, is_secret_line, is_secret_path, parse_porcelain_z  # noqa: E402

DEFAULT_CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "config.json")
MAX_ENTRIES = 5000
REPO_BUDGET_S = 20.0
CHUNK = 200
PLACEHOLDER_NAMES = {"", "your name"}
FALLBACK_INTERVAL_MIN = 10


class CqError(Exception):
    pass


def _env():
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["GIT_TERMINAL_PROMPT"] = "0"
    return env


def git(repo, args, timeout, stdin=None, scan=False):
    """Run git in `repo`. `scan` adds --no-optional-locks so a read never takes the index lock."""
    cmd = ["git", "--literal-pathspecs"]
    if scan:
        cmd.append("--no-optional-locks")
    cmd += ["-C", repo] + list(args)
    return subprocess.run(cmd, input=stdin, capture_output=True, timeout=max(timeout, 1), env=_env())


def load_config(path):
    with open(path or DEFAULT_CONFIG, encoding="utf-8") as f:
        cfg = json.load(f)
    cfg.setdefault("repos", [])
    cfg.setdefault("max_file_mb", 2)
    cfg.setdefault("interval_min", FALLBACK_INTERVAL_MIN)
    cfg.setdefault("identity", {})
    return cfg


def resolve_repos(cfg):
    """Existing git repos from the config, deduped by os.path.samefile (case-insensitive FS, symlinks)."""
    out = []
    for raw in cfg["repos"]:
        p = os.path.expanduser(raw)
        if not os.path.isdir(p) or not os.path.exists(os.path.join(p, ".git")):
            continue
        if any(os.path.samefile(p, q) for q in out):
            continue
        out.append(p)
    return out


def is_real_identity(name, email):
    n, e = (name or "").strip(), (email or "").strip()
    if n.lower() in PLACEHOLDER_NAMES or not e or "@" not in e:
        return False
    if e.lower().endswith("example.com") or e.lower() in {"you@example.com", "your@email.com"}:
        return False
    return True


def resolve_identity(repo, cfg):
    """Repo git config if real, else config.json identity, else None. Never guessed."""
    try:
        n = git(repo, ["config", "--get", "user.name"], 10, scan=True).stdout.decode("utf-8", "replace").strip()
        e = git(repo, ["config", "--get", "user.email"], 10, scan=True).stdout.decode("utf-8", "replace").strip()
    except (subprocess.SubprocessError, OSError):
        n = e = ""
    if is_real_identity(n, e):
        return {"name": n, "email": e, "source": "repo"}
    ident = cfg.get("identity") or {}
    if is_real_identity(ident.get("name"), ident.get("email")):
        return {"name": ident["name"].strip(), "email": ident["email"].strip(), "source": "config"}
    return None


def _count_lines(data):
    if not data:
        return 0
    return data.count(b"\n") + (0 if data.endswith(b"\n") else 1)


def _batches(items, n=CHUNK):
    for i in range(0, len(items), n):
        yield items[i : i + n]


def scan_repo(repo, cfg):
    """Scan one repo. Never raises: errors become readable=False."""
    name = os.path.basename(os.path.realpath(repo).rstrip("/")) or repo
    res = {"repo": repo, "name": name, "branch": None, "readable": True, "error": None, "truncated": False,
           "identity": None, "groups": []}
    start = time.monotonic()

    def left():
        return REPO_BUDGET_S - (time.monotonic() - start)

    try:
        st = git(repo, ["status", "--porcelain=v1", "-z", "-uall"], left(), scan=True)
        if st.returncode != 0:
            err = st.stderr.decode("utf-8", "replace").strip().splitlines()
            raise CqError(err[-1] if err else "git status failed")
        entries = [(xy, p) for xy, p in parse_porcelain_z(st.stdout) if xy != "!!"]
        if len(entries) > MAX_ENTRIES:
            res["truncated"] = True
            entries = entries[:MAX_ENTRIES]
        br = git(repo, ["symbolic-ref", "--short", "-q", "HEAD"], left(), scan=True)
        has_head = git(repo, ["rev-parse", "--verify", "-q", "HEAD"], left(), scan=True).returncode == 0
        res["branch"] = br.stdout.decode("utf-8", "replace").strip() or ("(detached)" if has_head else "(no commits)")
        res["identity"] = resolve_identity(repo, cfg)
        max_bytes = int(float(cfg["max_file_mb"]) * 1024 * 1024)

        info = {}  # path -> dict(xy, added, deleted, withheld)
        for xy, p in entries:
            info[p] = {"path": p, "xy": xy, "added": 0, "deleted": 0, "withheld": None}

        tracked = [p for xy, p in entries if xy != "??"]
        counted = set()
        if tracked and has_head:
            for batch in _batches(tracked):
                d = git(repo, ["diff", "--numstat", "-z", "--no-renames", "HEAD", "--"] + batch, left(), scan=True)
                if d.returncode != 0:
                    raise CqError("git diff failed")
                for rec in d.stdout.split(b"\0"):
                    if not rec:
                        continue
                    a, dl, path = rec.decode("utf-8").split("\t", 2)
                    if path in info:
                        info[path]["added"] = 0 if a == "-" else int(a)
                        info[path]["deleted"] = 0 if dl == "-" else int(dl)
                        counted.add(path)

        for xy, p in entries:
            it = info[p]
            full = os.path.join(repo, p)
            exists = os.path.lexists(full)
            if is_secret_path(p):
                it["withheld"] = "secret-name"
                continue
            if not exists:
                continue  # a deletion: nothing to read
            if os.path.isdir(full) and not os.path.islink(full):
                it["withheld"] = "directory"  # nested repo: not ours to add
                continue
            if os.path.islink(full):
                continue
            if os.path.getsize(full) > max_bytes:
                it["withheld"] = "oversize"
                continue
            if left() <= 0:
                it["withheld"] = "unscanned"
                continue
            added_lines = None
            if xy == "??" or not has_head or p not in counted:
                with open(full, "rb") as f:
                    data = f.read()
                if b"\0" not in data[:8000]:
                    it["added"] = _count_lines(data)
                    added_lines = data.decode("utf-8", "replace").splitlines()
            elif it["added"] > 0:
                d = git(repo, ["diff", "-U0", "--no-renames", "--no-color", "HEAD", "--", p], left(), scan=True)
                if d.returncode != 0:
                    it["withheld"] = "unscanned"
                    continue
                added_lines = []
                in_hunk = False
                for ln in d.stdout.decode("utf-8", "replace").splitlines():
                    if ln.startswith("@@"):
                        in_hunk = True
                    elif in_hunk and ln.startswith("+"):
                        added_lines.append(ln[1:])
            if added_lines and any(is_secret_line(t) for t in added_lines):
                it["withheld"] = "secret-content"

        groups = {}
        for p in sorted(info):
            groups.setdefault(group_key(p), []).append(info[p])
        for seg in sorted(groups):
            items = groups[seg]
            allowed = [i["path"] for i in items if not i["withheld"]]
            digest = hashlib.sha1("\n".join(
                f'{i["path"]}\t{i["xy"]}\t{i["added"]}\t{i["deleted"]}\t{i["withheld"] or ""}' for i in items
            ).encode("utf-8", "surrogateescape")).hexdigest()
            res["groups"].append({
                "id": f"{name}:{seg}", "group": seg, "repo": repo, "repo_name": name, "branch": res["branch"],
                "file_count": len(items), "allowed_count": len(allowed),
                "added": sum(i["added"] for i in items), "deleted": sum(i["deleted"] for i in items),
                "withheld": [{"path": i["path"], "reason": i["withheld"]} for i in items if i["withheld"]],
                "hash": digest, "_items": items,
            })
    except Exception as exc:  # noqa: BLE001 - a scan must never throw
        res["readable"] = False
        res["error"] = str(exc)[:200] or exc.__class__.__name__
        res["groups"] = []
    return res


def public(res):
    out = dict(res)
    out["groups"] = [{k: v for k, v in g.items() if k != "_items"} for g in res["groups"]]
    return out


def scan_all(cfg):
    repos = [scan_repo(r, cfg) for r in resolve_repos(cfg)]
    groups = [g for r in repos for g in r["groups"]]
    return {
        "ok": True, "interval_min": cfg["interval_min"],
        "totals": {"files": sum(g["file_count"] for g in groups), "groups": len(groups),
                   "repos": len([r for r in repos if r["groups"]]),
                   "unreadable": len([r for r in repos if not r["readable"]])},
        "repos": [public(r) for r in repos],
    }, repos


def find_repo(cfg, ref):
    for r in resolve_repos(cfg):
        if ref in (r, os.path.basename(r)) or (os.path.exists(ref) and os.path.samefile(ref, r)):
            return r
    raise CqError(f"repo not in config: {ref}")


def find_group(res, ref):
    for g in res["groups"]:
        if ref in (g["id"], g["group"]):
            return g
    raise CqError(f"no changes waiting in group {ref}")


def cmd_stat(cfg, repo_ref, group_ref):
    res = scan_repo(find_repo(cfg, repo_ref), cfg)
    if not res["readable"]:
        raise CqError(f"repo unreadable: {res['error']}")
    g = find_group(res, group_ref)
    out = {k: v for k, v in g.items() if k != "_items"}
    out["ok"] = True
    out["files"] = [{"path": i["path"], "xy": i["xy"], "added": i["added"], "deleted": i["deleted"],
                     "withheld": i["withheld"]} for i in g["_items"]]
    return out


def cmd_commit(cfg, repo_ref, group_ref, message, expect_hash):
    repo = find_repo(cfg, repo_ref)
    res = scan_repo(repo, cfg)
    if not res["readable"]:
        raise CqError(f"repo unreadable: {res['error']}")
    if res["truncated"]:
        raise CqError("too many changes to scan safely; commit this repo by hand")
    g = find_group(res, group_ref)
    if expect_hash and g["hash"] != expect_hash:
        raise CqError("files changed since the stat you saw; run the review again")
    allowed = [i["path"] for i in g["_items"] if not i["withheld"]]
    if not allowed:
        raise CqError("every file in this group is withheld; commit them by hand")
    ident = res["identity"]
    if not ident:
        raise CqError("no real git identity: set user.name/user.email in the repo or identity in config.json")
    msg = (message or f'{g["group"]}: {len(allowed)} files').strip()
    if not msg:
        raise CqError("empty commit message")
    if re.search(r"co-authored-by", msg, re.IGNORECASE):
        raise CqError("commit message may not carry a Co-Authored-By trailer")
    paths = ("\0".join(allowed) + "\0").encode("utf-8", "surrogateescape")
    pspec = ["--pathspec-from-file=-", "--pathspec-file-nul"]
    idc = ["-c", f'user.name={ident["name"]}', "-c", f'user.email={ident["email"]}']
    add = subprocess.run(["git", "--literal-pathspecs", "-C", repo, "add"] + pspec, input=paths,
                         capture_output=True, timeout=120, env=_env())
    if add.returncode != 0:
        raise CqError("git add failed: " + add.stderr.decode("utf-8", "replace").strip()[-200:])
    com = subprocess.run(["git", "--literal-pathspecs", "-C", repo] + idc + ["commit", "-m", msg] + pspec,
                         input=paths, capture_output=True, timeout=180, env=_env())
    if com.returncode != 0:
        tail = (com.stderr + com.stdout).decode("utf-8", "replace").strip()
        raise CqError("git commit failed: " + tail[-200:])
    log = git(repo, ["log", "-1", "--format=%h%x09%an%x09%ae%x09%B"], 20).stdout.decode("utf-8", "replace")
    sha, an, ae, body = (log.split("\t", 3) + ["", "", "", ""])[:4]
    ok = (an, ae) == (ident["name"], ident["email"])
    return {"ok": ok, "sha": sha, "author": an, "email": ae, "files": len(allowed), "branch": res["branch"],
            "withheld": g["withheld"], "has_trailer": bool(re.search(r"co-authored-by", body, re.IGNORECASE)),
            **({} if ok else {"error": "author on the new commit is not the expected identity"})}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="commit_queue")
    ap.add_argument("--config", default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("scan")
    s = sub.add_parser("stat")
    s.add_argument("repo")
    s.add_argument("group")
    c = sub.add_parser("commit")
    c.add_argument("repo")
    c.add_argument("group")
    c.add_argument("-m", "--message", default=None)
    c.add_argument("--expect-hash", default=None)
    a = ap.parse_args(argv)
    try:
        cfg = load_config(a.config)
        if a.cmd == "scan":
            out, _ = scan_all(cfg)
        elif a.cmd == "stat":
            out = cmd_stat(cfg, a.repo, a.group)
        else:
            out = cmd_commit(cfg, a.repo, a.group, a.message, a.expect_hash)
        code = 0 if out.get("ok", True) else 2
    except (CqError, OSError, ValueError, subprocess.SubprocessError) as exc:
        out, code = {"ok": False, "error": str(exc)[:300]}, 2
    sys.stdout.write(json.dumps(out) + "\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
