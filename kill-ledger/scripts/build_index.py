#!/usr/bin/env python3
"""Build kill-ledger's index from the auto-memory, by script (never by hand).

Reads   ~/.claude/projects/-Users-shonzinger/memory/MEMORY.md  (one line per topic file)
        + each linked topic file's frontmatter `description` and its `## Index hook` sections
        + ../vocab.json (strategy names and their aliases; the only hand-kept part. A name
          starting with '?' is generic (needs_context); with '?!' also strict)
Writes  ../data/kill_index.json

Per topic file it records: status (from the line's first status emoji, else its
section heading, else kill words), the first date, the reason (the index line's
text), and which vocabulary terms the line/label/slug/description mention.
Slug words (project_<words>.md) become extra terms automatically.

Also reads ~/Trading/_ledger/experiments.jsonl (verdict.py's experiment ledger) when it exists:
an idea whose latest ledger line (by date) is FAIL becomes a killed entry `ledger:<idea>`
(source "ledger"), so the index stays current between memory updates. Missing ledger = no change.

Usage: build_index.py [--memory DIR] [--out FILE] [--ledger FILE]   (prints a one-line summary)
"""
import argparse, json, os, re, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_MEM = os.path.expanduser("~/.claude/projects/-Users-shonzinger/memory")
DEFAULT_LEDGER = os.path.expanduser("~/Trading/_ledger/experiments.jsonl")

STATUS = [("🛑", "killed"), ("⚠️", "caution"), ("⏳", "live"), ("🔧", "fixing"), ("📄", "spec"), ("✅", "passed")]
KILL_WORDS = re.compile(r"\b(KILLED|REFUTED|REJECTED|DO NOT (?:TRADE|FUND|DEPLOY)|NOT-FUNDABLE|mirage|dead|CLOSED)\b", re.I)
DATE = re.compile(r"\b(20\d\d-\d\d-\d\d)\b")
LINE = re.compile(r"^- \[([^\]]+)\]\(([^)]+\.md)\)\s*[—-]+\s*(.*)$")
# slug words that name no strategy
STOP = set("""project reference feedback strat strategy bot bots skill test tests audit live combined systems system
method replay blind level1 dataset video executor replication kill new directions discovery search portfolio farm
prop account layer topstep unified trading deleak research fidelity costflip lab original data integrity part
forward observation daily target base rates payout market style token efficiency format send pack intraday only
second brain youtube automation resume tailor autorank tradingview mcp offset defect kaggle buildout scanner
recreate fromscratch level bug ohlc edge entry backtest feed event rare zero cross asset signals regime noise
gold happy trigger stacked lookahead propfarm marketos cont continuation flow""".split())


def status_of(text, heading):
    for emo, name in STATUS:
        if emo in text[:12]:
            return name, emo
    for emo, name in STATUS:
        if emo in heading:
            return name, emo
    if KILL_WORDS.search(text):
        return "killed", "🛑"
    return "open", ""


def description_of(path):
    try:
        with open(path, encoding="utf-8") as f:
            head = f.read(4000)
    except OSError:
        return ""
    m = re.search(r"^description:\s*(.+)$", head, re.M)
    return m.group(1).strip().strip('"') if m else ""


HOOK = re.compile(r"^## Index hook[^\n]*\n(.*?)(?=^## |\Z)", re.M | re.S)


def hook_text_of(path):
    """Text under the topic file's '## Index hook ...' headings: detail moved out of MEMORY.md lines."""
    try:
        with open(path, encoding="utf-8") as f:
            return " ".join(m.group(1).strip() for m in HOOK.finditer(f.read()))
    except OSError:
        return ""

def reason_of(text, limit=240):
    t = re.sub(r"^\s*(?:🛑|⚠️|⏳|🔧|📄|✅)\s*", "", text)
    t = re.sub(r"^\s*20\d\d-\d\d-\d\d\s*", "", t).strip()
    if len(t) <= limit:
        return t
    cut = t[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(",;:") + " …"


def alias_re(alias):
    """`=QT` is case-sensitive; anything else is case-insensitive. Word-bounded."""
    cs = alias.startswith("=")
    a = alias[1:] if cs else alias
    return re.compile(r"(?<![\w])" + re.escape(a) + r"(?![\w])", 0 if cs else re.I)


def slug_terms(fname):
    slug = re.sub(r"^(project|reference|feedback)_", "", fname[:-3])
    words = [w for w in re.split(r"[_\-]+", slug) if w]
    out = []
    for w in words:
        wl = w.lower()
        if len(wl) < 4 or wl.isdigit() or re.fullmatch(r"v\d+|20\d\d|\d+", wl) or wl in STOP:
            continue
        out.append(wl)
    return out


def latest_by_idea(ledger_path):
    """{idea: its latest ledger line by date (later line wins a tie)}; {} when the file is missing."""
    latest = {}
    try:
        with open(ledger_path, encoding="utf-8") as f:
            rows = f.read().splitlines()
    except OSError:
        return latest
    for i, ln in enumerate(rows):
        try:
            r = json.loads(ln)
        except ValueError:
            continue
        if not isinstance(r, dict) or not r.get("idea"):
            continue
        key = (str(r.get("date") or ""), i)
        if r["idea"] not in latest or key >= latest[r["idea"]][0]:
            latest[r["idea"]] = (key, r)
    return {idea: r for idea, (_, r) in latest.items()}


def ledger_entry(idea, r):
    def num(k, fmt):
        v = r.get(k)
        return f"{k} {v:{fmt}}" if isinstance(v, (int, float)) and not isinstance(v, bool) else ""
    bits = [b for b in (num("pf", ".2f"), num("t_stat", ".2f"), f"{r.get('p_kind') or 'p'} {r['p_value']:.3g}"
                        if isinstance(r.get("p_value"), (int, float)) else "", r.get("basis") or "",
                        f"n {r['n_trades']}" if r.get("n_trades") is not None else "") if b]
    what = r.get("slug") or idea
    return {"file": f"ledger:{idea}", "label": idea, "section": "Experiment ledger", "status": "killed",
            "emoji": "🛑", "date": str(r.get("date") or "")[:10], "date_src": "ledger", "source": "ledger",
            "reason": reason_of(f"ledger FAIL: {what}" + (f" ({', '.join(bits)})" if bits else "")),
            "_hay": " ".join([idea, idea.replace("-", " ").replace("_", " "), str(r.get("slug") or "")])}


def build(mem_dir, vocab, ledger_path=None):
    index_path = os.path.join(mem_dir, "MEMORY.md")
    with open(index_path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    entries, heading = [], ""
    for ln in lines:
        if ln.startswith("## "):
            heading = ln[3:]
            continue
        m = LINE.match(ln.strip())
        if not m:
            continue
        label, fname, text = m.group(1), os.path.basename(m.group(2)), m.group(3)
        desc = description_of(os.path.join(mem_dir, fname))
        status, emo = status_of(text, heading)
        dm = DATE.search(text) or DATE.search(desc) or DATE.search(label)
        date, date_src = (dm.group(1), "text") if dm else ("", "")
        if not date:  # no date written: the topic file's last change stands in
            try:
                date = time.strftime("%Y-%m-%d", time.localtime(os.path.getmtime(os.path.join(mem_dir, fname))))
                date_src = "file"
            except OSError:
                pass
        entries.append({
            "file": fname, "label": label, "section": heading, "status": status, "emoji": emo,
            "date": date, "date_src": date_src, "reason": reason_of(text),
            "_hay": " ".join([label, fname.replace("_", " "), text, desc, hook_text_of(os.path.join(mem_dir, fname))]),
        })

    by_file = {e["file"]: e for e in entries}
    ledger_ideas = []
    for idea, r in (latest_by_idea(ledger_path) if ledger_path else {}).items():
        if str(r.get("verdict") or "").upper() != "FAIL":
            continue
        le = ledger_entry(idea, r)
        if le["file"] in by_file:
            by_file[le["file"]].update(le)
        else:
            entries.append(le)
            by_file[le["file"]] = le
        ledger_ideas.append((idea, le["file"]))

    terms = {}
    for name, aliases in vocab.items():
        needs_context = name.startswith("?")  # generic word: prompt must look like trading
        strict = name.startswith("?!")  # and its one-word aliases count only inside a strategy name
        term = name[2:] if strict else name.lstrip("?")
        regs = [alias_re(a) for a in aliases]
        files = [e["file"] for e in entries if any(r.search(e["_hay"]) for r in regs)]
        if files:
            terms[term] = {"aliases": aliases, "files": files, "needs_context": needs_context, "strict": strict}
    for e in entries:
        if e.get("source") == "ledger":
            continue  # 'ledger:<idea>' is no .md name; the idea slug term below names it
        for w in slug_terms(e["file"]):
            if any(w == a.lower().lstrip("=") for t in terms.values() for a in t["aliases"]):
                continue  # already a vocabulary alias
            t = terms.setdefault(w, {"aliases": [w], "files": []})
            if e["file"] not in t["files"]:
                t["files"].append(e["file"])
    for idea, fname in ledger_ideas:  # the idea slug (and its spaced form) names its ledger entry
        spaced = idea.replace("-", " ").replace("_", " ")
        t = terms.setdefault(idea.lower(), {"aliases": sorted({idea, spaced}), "files": []})
        if fname not in t["files"]:
            t["files"].append(fname)
    for e in entries:
        del e["_hay"]
    return {
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "memory_dir": mem_dir,
        "memory_mtime": os.path.getmtime(index_path),
        "entries": {e["file"]: e for e in entries},
        "terms": terms,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--memory", default=DEFAULT_MEM)
    ap.add_argument("--vocab", default=os.path.join(ROOT, "vocab.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "kill_index.json"))
    ap.add_argument("--ledger", default=DEFAULT_LEDGER)
    a = ap.parse_args()
    with open(a.vocab, encoding="utf-8") as f:
        vocab = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    idx = build(a.memory, vocab, a.ledger)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    tmp = a.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, indent=1)
    os.replace(tmp, a.out)
    killed = sum(1 for e in idx["entries"].values() if e["status"] == "killed")
    print(f"kill-ledger: {len(idx['entries'])} entries ({killed} killed), {len(idx['terms'])} terms -> {a.out}")


if __name__ == "__main__":
    sys.exit(main())
