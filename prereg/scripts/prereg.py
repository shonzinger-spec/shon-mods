#!/usr/bin/env python3
"""Pre-registration files with a SHA256, written before any result is seen.

  prereg.py create --slug S --hypothesis H --gate "name|metric|op|threshold" [--gate ...]
                   [--data D] [--period P] [--notes N] [--dir prereg]
      writes <dir>/<S>.json (refuses to overwrite) holding the plan and its sha256
  prereg.py verify S [--dir prereg]        recompute the sha256; exit 1 on mismatch
  prereg.py result S RESULTS_FILE [--dir]  record results: writes <dir>/<S>.result.json
                                           (prereg sha + results sha); from then on the
                                           prereg mod refuses edits to <S>.json
  prereg.py judge S METRICS_JSON [--dir]   evaluate each gate against {"metric": value}
  prereg.py list [--dir prereg]

The sha256 covers the canonical JSON of every field but `sha256`
(sort_keys, separators=(",", ":"), ensure_ascii=False).
"""
import argparse, datetime as dt, hashlib, json, os, re, sys

OPS = {">=": lambda a, b: a >= b, ">": lambda a, b: a > b, "<=": lambda a, b: a <= b,
       "<": lambda a, b: a < b, "==": lambda a, b: a == b}
SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$")


def canon(body):
    return json.dumps({k: v for k, v in body.items() if k != "sha256"}, sort_keys=True,
                      separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha_of(body):
    return hashlib.sha256(canon(body)).hexdigest()


def file_sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_gate(s):
    parts = [p.strip() for p in s.split("|")]
    if len(parts) != 4 or parts[2] not in OPS:
        raise SystemExit(f"bad --gate {s!r}: want 'name|metric|op|threshold', op one of {', '.join(OPS)}")
    try:
        thr = float(parts[3])
    except ValueError:
        raise SystemExit(f"bad threshold in --gate {s!r}: {parts[3]!r} is not a number")
    return {"name": parts[0], "metric": parts[1], "op": parts[2], "threshold": thr}


def load(d, slug):
    p = os.path.join(d, f"{slug}.json")
    with open(p, encoding="utf-8") as f:
        return p, json.load(f)


def cmd_create(a):
    if not SLUG.match(a.slug):
        raise SystemExit(f"bad slug {a.slug!r}: letters, digits, . _ - only")
    if not a.gate:
        raise SystemExit("at least one --gate is required: a pre-registration without pass/fail thresholds is not one")
    os.makedirs(a.dir, exist_ok=True)
    p = os.path.join(a.dir, f"{a.slug}.json")
    if os.path.exists(p):
        raise SystemExit(f"{p} already exists; pre-registrations are never overwritten. Use a new slug (e.g. {a.slug}-A1).")
    body = {
        "schema": "prereg/1",
        "slug": a.slug,
        "created_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "hypothesis": a.hypothesis,
        "data": a.data or "",
        "period": a.period or "",
        "gates": [parse_gate(g) for g in a.gate],
        "notes": a.notes or "",
    }
    body["sha256"] = sha_of(body)
    with open(p, "x", encoding="utf-8") as f:
        json.dump(body, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"pre-registered {p}\nsha256 {body['sha256']}")
    for g in body["gates"]:
        print(f"  gate {g['name']}: {g['metric']} {g['op']} {g['threshold']}")
    return 0


def cmd_verify(a):
    p, body = load(a.dir, a.slug)
    got = sha_of(body)
    if got != body.get("sha256"):
        print(f"MISMATCH {p}: recorded {body.get('sha256')} computed {got} — the file changed after registration")
        return 1
    print(f"OK {p} sha256 {got}")
    return 0


def cmd_result(a):
    p, body = load(a.dir, a.slug)
    if sha_of(body) != body.get("sha256"):
        raise SystemExit(f"{p} no longer matches its sha256; refusing to record results against a changed plan")
    marker = os.path.join(a.dir, f"{a.slug}.result.json")
    if os.path.exists(marker):
        raise SystemExit(f"{marker} exists; results are recorded once")
    rec = {"slug": a.slug, "prereg_sha256": body["sha256"], "results_file": os.path.abspath(a.results),
           "results_sha256": file_sha(a.results), "recorded_at": dt.datetime.now().astimezone().isoformat(timespec="seconds")}
    with open(marker, "x", encoding="utf-8") as f:
        json.dump(rec, f, indent=2)
        f.write("\n")
    print(f"results recorded {marker}; {p} is now locked")
    return 0


def cmd_judge(a):
    _, body = load(a.dir, a.slug)
    with open(a.metrics, encoding="utf-8") as f:
        m = json.load(f)
    ok_all = True
    for g in body["gates"]:
        v = m.get(g["metric"])
        ok = v is not None and OPS[g["op"]](float(v), g["threshold"])
        ok_all &= ok
        print(f"{'PASS' if ok else 'FAIL'} {g['name']}: {g['metric']}={v} {g['op']} {g['threshold']}")
    print("VERDICT", "PASS" if ok_all else "FAIL")
    return 0 if ok_all else 2


def cmd_list(a):
    if not os.path.isdir(a.dir):
        print(f"no {a.dir}/")
        return 0
    for fn in sorted(os.listdir(a.dir)):
        if fn.endswith(".json") and not fn.endswith(".result.json"):
            slug = fn[:-5]
            locked = os.path.exists(os.path.join(a.dir, f"{slug}.result.json"))
            print(f"{'LOCKED' if locked else 'open  '} {slug}")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create")
    c.add_argument("--slug", required=True)
    c.add_argument("--hypothesis", required=True)
    c.add_argument("--gate", action="append", default=[])
    c.add_argument("--data")
    c.add_argument("--period")
    c.add_argument("--notes")
    for name in ("verify", "result", "judge"):
        s = sub.add_parser(name)
        s.add_argument("slug")
        if name == "result":
            s.add_argument("results")
        if name == "judge":
            s.add_argument("metrics")
    sub.add_parser("list")
    for s in sub.choices.values():
        s.add_argument("--dir", default="prereg")
    a = ap.parse_args()
    return {"create": cmd_create, "verify": cmd_verify, "result": cmd_result, "judge": cmd_judge, "list": cmd_list}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
