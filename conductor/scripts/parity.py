#!/usr/bin/env python3
"""Cost-ledger parity: conductor's ledger against a reference count.

The reference is, by default, the subagent transcripts themselves
(<projects>/*/<session>/subagents/agent-<id>.jsonl, usage summed once per
message id): what each agent actually used. `--against frugal` compares with
frugal's metrics.jsonl instead, which records at SubagentStop and can miss an
agent's last turns. Both sides are priced with frugal's own stats.py
(imported, not copied), so a difference can only come from the token counts.
PASS when the total and every agent type with >= 3 joined agents are within 5%.

Exit codes: 0 PASS, 1 FAIL, 2 too little overlap (< 3 joined agents).
"""
import argparse
import glob
import importlib.util
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

TOLERANCE_PCT = 5.0
MIN_TYPE_AGENTS = 3
MIN_JOINED = 3
TOKEN_FIELDS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
STATS_GLOB = os.path.expanduser(
    "~/Library/Application Support/Claude/local-agent-mode-sessions/*/*/rpm/plugin_*/scripts/stats.py")


def load_stats(path=None, pattern=STATS_GLOB):
    """Import frugal's stats.py. Explicit path, else the newest glob match defining PRICES and cost_usd."""
    candidates = [path] if path else sorted(glob.glob(pattern), key=os.path.getmtime, reverse=True)
    for i, cand in enumerate(candidates):
        if not os.path.isfile(cand):
            continue
        spec = importlib.util.spec_from_file_location(f"frugal_stats_{i}", cand)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
        except Exception:
            continue
        if hasattr(mod, "PRICES") and callable(getattr(mod, "cost_usd", None)):
            mod.__parity_path__ = cand
            return mod
    raise SystemExit(f"parity: frugal stats.py with PRICES and cost_usd not found ({path or pattern})")


def _read_jsonl(path):
    rows = []
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return rows


def _iso(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _day_bounds(day):
    start = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
    return start.timestamp(), start.timestamp() + 86400


def load_conductor(ledger_dir, day=None, since=None):
    """Return (agents, excluded, sessions); sessions maps session id -> its first route time.

    agents: agentId -> {type, tokens, records (one per model), session}
    excluded: agentIds whose usage the mod only partly saw.
    An agent is partial when its spawn has no route row in that file (it was
    spawned before the mod loaded), or its first step predates the file's
    first route row.
    """
    agents, excluded, sessions = {}, {}, {}
    for path in sorted(glob.glob(os.path.join(ledger_dir, "*.jsonl"))):
        name = os.path.basename(path)[:-len(".jsonl")]
        date, sid = name[:10], name[11:]
        if day and date != day:
            continue
        rows = _read_jsonl(path)
        routes = [r for r in rows if r.get("type") == "route"]
        routed = {r.get("agentId") for r in routes if r.get("agentId")}
        first_route = min((_iso(r["ts"]) for r in routes if r.get("ts")), default=None)
        usage = [r for r in rows if r.get("type") == "usage" and r.get("agentId")]
        if since:
            usage = [u for u in usage if _iso(u["lastTs"]).timestamp() >= since]
        if usage:
            sessions[sid] = first_route
        for u in usage:
            aid = u["agentId"]
            if aid not in routed:
                excluded[aid] = "no route row (spawned before the mod loaded)"
                continue
            if first_route is not None and _iso(u["firstTs"]) < first_route:
                excluded[aid] = "first step before the mod's first route row"
                continue
            a = agents.setdefault(aid, {"type": u.get("subagentType"), "records": [], "session": sid})
            a["records"].append({"model": u.get("model"), **{k: u.get(k, 0) for k in TOKEN_FIELDS}})
    for aid in excluded:
        agents.pop(aid, None)
    return agents, excluded, sessions


def load_frugal(path, day=None, since=None):
    agents = {}
    lo, hi = _day_bounds(day) if day else (since, None)
    for r in _read_jsonl(path):
        ts, aid = r.get("ts"), r.get("agent_id")
        if not aid or ts is None or (lo is not None and ts < lo) or (hi is not None and ts >= hi):
            continue
        a = agents.setdefault(aid, {"type": r.get("agent_type"), "records": [], "session": r.get("session_id")})
        a["records"].append({"model": r.get("model"), **{k: r.get(k, 0) for k in TOKEN_FIELDS}})
    return agents


def _transcript(path):
    """(records per model, first timestamp) for one subagent transcript; usage counted once per message id."""
    last, first = {}, None
    for r in _read_jsonl(path):
        ts = r.get("timestamp")
        if ts and (first is None or _iso(ts) < first):
            first = _iso(ts)
        m = r.get("message")
        if isinstance(m, dict) and isinstance(m.get("usage"), dict):
            last[m.get("id") or r.get("uuid")] = (m.get("model"), m["usage"])
    by_model = {}
    for model, u in last.values():
        rec = by_model.setdefault(model, {"model": model, **{k: 0 for k in TOKEN_FIELDS}})
        for k in TOKEN_FIELDS:
            rec[k] += u.get(k, 0) or 0
    return list(by_model.values()), first


def load_transcripts(projects_dir, sessions):
    """Finished subagent transcripts of the given sessions: agentId -> {type, records, session, first}."""
    agents = {}
    for sid in sessions:
        for path in glob.glob(os.path.join(projects_dir, "*", sid, "subagents", "agent-*.jsonl")):
            aid = os.path.basename(path)[len("agent-"):-len(".jsonl")]
            meta = {}
            try:
                with open(path[:-len(".jsonl")] + ".meta.json") as fh:
                    meta = json.load(fh)
            except (OSError, json.JSONDecodeError):
                pass
            if meta.get("finished") is False:
                continue  # still running: its count is not final
            records, first = _transcript(path)
            agents[aid] = {"type": meta.get("agentType"), "records": records, "session": sid, "first": first}
    return agents


def _cost(stats, records):
    return sum(stats.cost_usd(rec) for rec in records)


def _tokens(records):
    return sum(rec.get(k, 0) or 0 for rec in records for k in TOKEN_FIELDS)


def _pct(c, f):
    if f == 0:
        return 0.0 if c == 0 else float("inf")
    return (c - f) / f * 100.0


def compare(conductor_dir, frugal_path, stats, day=None, since=None, against="transcript",
            projects_dir=os.path.expanduser("~/.claude/projects")):
    cond, excluded, cond_sessions = load_conductor(conductor_dir, day, since)
    if against == "transcript":
        frug = load_transcripts(projects_dir, cond_sessions)
        # a transcript that began before the mod's first route in its session is partial on the conductor side
        before = {a for a, t in frug.items() if a not in cond and t["first"] is not None
                  and (cond_sessions[t["session"]] is None or t["first"] < cond_sessions[t["session"]])}
        for a in before:
            frug.pop(a)
    else:
        frug = load_frugal(frugal_path, day, since)
    joined = sorted(set(cond) & set(frug))
    per_agent, by_type = [], defaultdict(lambda: {"n": 0, "conductor_usd": 0.0, "frugal_usd": 0.0})
    for aid in joined:
        c, f = cond[aid], frug[aid]
        typ = f["type"] or c["type"] or "?"
        row = {
            "agent_id": aid, "type": typ,
            "conductor_tokens": _tokens(c["records"]), "frugal_tokens": _tokens(f["records"]),
            "conductor_usd": _cost(stats, c["records"]), "frugal_usd": _cost(stats, f["records"]),
        }
        row["diff_pct"] = _pct(row["conductor_usd"], row["frugal_usd"])
        per_agent.append(row)
        t = by_type[typ]
        t["n"] += 1
        t["conductor_usd"] += row["conductor_usd"]
        t["frugal_usd"] += row["frugal_usd"]
    for t in by_type.values():
        t["diff_pct"] = _pct(t["conductor_usd"], t["frugal_usd"])
    total = {
        "n": len(joined),
        "conductor_usd": sum(r["conductor_usd"] for r in per_agent),
        "frugal_usd": sum(r["frugal_usd"] for r in per_agent),
        "conductor_tokens": sum(r["conductor_tokens"] for r in per_agent),
        "frugal_tokens": sum(r["frugal_tokens"] for r in per_agent),
    }
    total["diff_pct"] = _pct(total["conductor_usd"], total["frugal_usd"])

    frugal_only = sorted(set(frug) - set(cond) - set(excluded))
    only = {
        "conductor_only": sorted(set(cond) - set(frug)),
        # frugal agents in a session conductor logged: the mod should have seen them
        "frugal_only_in_conductor_sessions": [a for a in frugal_only if frug[a]["session"] in cond_sessions],
        # frugal agents in sessions with no conductor file (mod not loaded there)
        "frugal_only_other_sessions": [a for a in frugal_only if frug[a]["session"] not in cond_sessions],
    }
    only_types = {k: dict(sorted(_count_types(v, cond if k == "conductor_only" else frug).items())) for k, v in only.items()}

    failing = [typ for typ, t in sorted(by_type.items()) if t["n"] >= MIN_TYPE_AGENTS and abs(t["diff_pct"]) > TOLERANCE_PCT]
    if len(joined) < MIN_JOINED:
        verdict, code = "INSUFFICIENT", 2
    elif abs(total["diff_pct"]) > TOLERANCE_PCT or failing:
        verdict, code = "FAIL", 1
    else:
        verdict, code = "PASS", 0
    return {
        "verdict": verdict, "exit_code": code, "against": against, "stats_path": getattr(stats, "__parity_path__", None),
        "window": {"day": day, "since": since}, "total": total, "by_type": dict(sorted(by_type.items())),
        "failing_types": failing, "total_fails": abs(total["diff_pct"]) > TOLERANCE_PCT,
        "per_agent": per_agent, "excluded": excluded,
        "only": {k: len(v) for k, v in only.items()}, "only_types": only_types, "only_ids": only,
    }


def _count_types(ids, agents):
    counts = defaultdict(int)
    for a in ids:
        counts[agents[a]["type"] or "?"] += 1
    return counts


def render(res):
    out = []
    w = res["window"]
    ref = "transcript" if res.get("against") == "transcript" else "frugal"
    out.append(f"parity window: {w['day'] or w['since'] or 'all'}   reference: {ref}   prices: {res['stats_path']}")
    out.append(f"excluded {len(res['excluded'])} partial conductor agent(s)"
               + "".join(f"\n  {a}: {why}" for a, why in sorted(res["excluded"].items())))
    out.append("")
    out.append(f"{'agent':<20} {'type':<28} {'conductor $':>12} {ref + ' $':>12} {'diff %':>8}")
    for r in res["per_agent"]:
        out.append(f"{r['agent_id']:<20} {r['type']:<28} {r['conductor_usd']:>12.4f} {r['frugal_usd']:>12.4f} {r['diff_pct']:>8.2f}")
    out.append("")
    out.append(f"{'type':<28} {'n':>3} {'conductor $':>12} {ref + ' $':>12} {'diff %':>8}")
    for typ, t in res["by_type"].items():
        out.append(f"{typ:<28} {t['n']:>3} {t['conductor_usd']:>12.4f} {t['frugal_usd']:>12.4f} {t['diff_pct']:>8.2f}")
    t = res["total"]
    out.append(f"{'TOTAL':<28} {t['n']:>3} {t['conductor_usd']:>12.4f} {t['frugal_usd']:>12.4f} {t['diff_pct']:>8.2f}")
    out.append(f"tokens: conductor {t['conductor_tokens']:,}  {ref} {t['frugal_tokens']:,}")
    out.append("")
    for k, n in res["only"].items():
        types = ", ".join(f"{typ} {c}" for typ, c in res["only_types"][k].items())
        out.append(f"{k.replace('frugal', ref)}: {n}" + (f" ({types})" if types else ""))
    out.append("")
    if res["verdict"] == "INSUFFICIENT":
        out.append(f"INSUFFICIENT: {t['n']} joined agent(s), need >= {MIN_JOINED}")
    else:
        why = []
        if res["total_fails"]:
            why.append(f"total {t['diff_pct']:+.2f}%")
        why += [f"{typ} {res['by_type'][typ]['diff_pct']:+.2f}%" for typ in res["failing_types"]]
        out.append(f"{res['verdict']}: total and every agent type with >= {MIN_TYPE_AGENTS} agents within "
                   f"{TOLERANCE_PCT:g}%" + (f" -- off: {'; '.join(why)}" if why else ""))
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--since", help="ISO timestamp; rows at or after it")
    g.add_argument("--day", help="UTC date YYYY-MM-DD")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--conductor-dir", default=os.path.expanduser("~/.claude/conductor/ledger"))
    ap.add_argument("--frugal", default=os.path.expanduser("~/.claude/frugal/metrics.jsonl"))
    ap.add_argument("--stats", help="path to frugal's stats.py (default: newest installed)")
    ap.add_argument("--against", choices=("transcript", "frugal"), default="transcript",
                    help="reference count: subagent transcripts (default) or frugal's metrics.jsonl")
    ap.add_argument("--projects", default=os.path.expanduser("~/.claude/projects"),
                    help="Claude Code projects dir holding the subagent transcripts")
    args = ap.parse_args(argv)
    stats = load_stats(args.stats)
    since = _iso(args.since).timestamp() if args.since else None
    if args.since and _iso(args.since).tzinfo is None:
        since = _iso(args.since).replace(tzinfo=timezone.utc).timestamp()
    res = compare(args.conductor_dir, args.frugal, stats, day=args.day, since=since,
                  against=args.against, projects_dir=args.projects)
    print(json.dumps(res, indent=2, default=str) if args.json else render(res))
    return res["exit_code"]


if __name__ == "__main__":
    sys.exit(main())
