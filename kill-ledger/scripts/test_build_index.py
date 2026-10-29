"""build_index.py: the experiment ledger turns an idea whose latest line is FAIL into a killed entry."""
import json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_index  # noqa: E402

MEMORY = "# Memory Index\n\n## Live\n\n- [project_alpha_2026_10_01.md](project_alpha_2026_10_01.md) — 🛑 2026-10-01 alpha FAIL\n"


class LedgerIndex(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.mem = os.path.join(self.tmp.name, "mem")
        os.makedirs(self.mem)
        with open(os.path.join(self.mem, "MEMORY.md"), "w", encoding="utf-8") as f:
            f.write(MEMORY)
        self.ledger = os.path.join(self.tmp.name, "experiments.jsonl")

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, *rows):
        with open(self.ledger, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")

    def row(self, idea, verdict, date, **kw):
        return {"date": date, "slug": None, "idea": idea, "variant": "v1", "pf": 0.9, "t_stat": -1.0,
                "p_value": 0.6, "p_kind": "SPA", "basis": "NET", "n_trades": 200, "verdict": verdict, **kw}

    def test_latest_fail_becomes_killed_entry(self):
        self.put(self.row("sweep-reclaim", "PASS", "2026-10-01T10:00:00-05:00"),
                 self.row("sweep-reclaim", "FAIL", "2026-10-02T10:00:00-05:00"))
        idx = build_index.build(self.mem, {}, self.ledger)
        e = idx["entries"]["ledger:sweep-reclaim"]
        self.assertEqual((e["status"], e["emoji"], e["source"], e["date"], e["date_src"]),
                         ("killed", "🛑", "ledger", "2026-10-02", "ledger"))
        self.assertIn("ledger FAIL", e["reason"])
        self.assertNotIn("_hay", e)
        self.assertIn("ledger:sweep-reclaim", idx["terms"]["sweep-reclaim"]["files"])
        self.assertIn("sweep reclaim", idx["terms"]["sweep-reclaim"]["aliases"])

    def test_ledger_entries_add_no_chopped_slug_terms(self):
        self.put(self.row("sweep-reclaim", "FAIL", "2026-10-02"), self.row("gap-fill-session", "FAIL", "2026-10-02"),
                 self.row("gap", "FAIL", "2026-10-02"))
        terms = build_index.build(self.mem, {}, self.ledger)["terms"]
        for junk in ("recl", "ledger:sweep", "fill", "sess", "ledger:gap", "ledger:"):
            self.assertNotIn(junk, terms)
        for idea in ("sweep-reclaim", "gap-fill-session", "gap"):
            self.assertEqual(terms[idea]["files"], [f"ledger:{idea}"])

    def test_pass_after_fail_is_not_killed(self):
        self.put(self.row("orb", "FAIL", "2026-10-01T10:00:00-05:00"),
                 self.row("orb", "PASS", "2026-10-03T10:00:00-05:00"))
        idx = build_index.build(self.mem, {}, self.ledger)
        self.assertNotIn("ledger:orb", idx["entries"])

    def test_latest_is_by_date_not_line_order(self):
        self.put(self.row("gap", "FAIL", "2026-10-05T10:00:00-05:00"),
                 self.row("gap", "PASS", "2026-10-01T10:00:00-05:00"))
        self.assertIn("ledger:gap", build_index.build(self.mem, {}, self.ledger)["entries"])

    def test_missing_ledger_changes_nothing(self):
        without = build_index.build(self.mem, {})
        missing = build_index.build(self.mem, {}, os.path.join(self.tmp.name, "nope.jsonl"))
        self.assertEqual(without["entries"], missing["entries"])
        self.assertEqual(list(missing["entries"]), ["project_alpha_2026_10_01.md"])

    def test_bad_lines_are_skipped(self):
        with open(self.ledger, "w") as f:
            f.write("not json\n" + json.dumps(self.row("x", "FAIL", "2026-10-01")) + "\n[]\n")
        self.assertIn("ledger:x", build_index.build(self.mem, {}, self.ledger)["entries"])

    def test_strict_flag_from_vocab(self):
        with open(os.path.join(self.mem, "MEMORY.md"), "w", encoding="utf-8") as f:
            f.write("# Memory Index\n\n## Live\n\n- [project_a.md](project_a.md) — 🛑 2026-10-01 sweep and momentum FAIL\n")
        terms = build_index.build(self.mem, {"?!sweep": ["sweep"], "?momentum": ["momentum"]})["terms"]
        self.assertIn("sweep", terms)
        self.assertNotIn("!sweep", terms)
        self.assertEqual((terms["sweep"]["needs_context"], terms["sweep"]["strict"]), (True, True))
        self.assertEqual((terms["momentum"]["needs_context"], terms["momentum"]["strict"]), (True, False))


    def test_terms_in_relocated_index_hook_are_found(self):
        with open(os.path.join(self.mem, "MEMORY.md"), "w", encoding="utf-8") as f:
            f.write("# Memory Index\n\n## Live\n\n- [project_b.md](project_b.md) — 🛑 2026-10-01 short line …\n")
        with open(os.path.join(self.mem, "project_b.md"), "w", encoding="utf-8") as f:
            f.write("---\nname: b\ndescription: unrelated\n---\nbody text\n\n## Index hook (relocated from MEMORY.md 2026-10-29)\nfootprint sweep killed\n\n## Other\nmomentum not in a hook\n")
        terms = build_index.build(self.mem, {"footprint": ["footprint"], "momentum": ["momentum"]})["terms"]
        self.assertEqual(terms["footprint"]["files"], ["project_b.md"])
        self.assertEqual(terms.get("momentum", {}).get("files", []), [])

if __name__ == "__main__":
    unittest.main()
