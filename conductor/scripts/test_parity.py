import contextlib
import io
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parity  # noqa: E402

DAY = "2026-10-28"
SID = "sess-1"
# A fake stats.py: flat $1 per million tokens of any kind, so costs equal token counts / 1e6.
FAKE_STATS = """
PRICES = [("fake", (1.0, 1.0))]
CALLS = []
def cost_usd(record, price=None):
    CALLS.append(record.get("model"))
    return sum(record.get(k, 0) for k in
               ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")) / 1e6
"""
DAY_EPOCH = 1793145600  # 2026-10-28T00:00:00Z


def toks(n, out=0):
    return {"input_tokens": 0, "output_tokens": out, "cache_read_input_tokens": n, "cache_creation_input_tokens": 0}


class Fixture:
    def __init__(self, root):
        self.root = root
        self.ledger_dir = os.path.join(root, "ledger")
        os.makedirs(self.ledger_dir)
        self.frugal = os.path.join(root, "metrics.jsonl")
        self.stats = os.path.join(root, "stats.py")
        with open(self.stats, "w") as fh:
            fh.write(FAKE_STATS)
        self.cond_rows, self.frug_rows = [], []
        self.projects = os.path.join(root, "projects")
        self.subagents = os.path.join(self.projects, "-proj", SID, "subagents")
        os.makedirs(self.subagents)

    def transcript(self, aid, typ, messages, finished=True, first="2026-10-28T10:00:01Z"):
        """messages: list of (message id, tokens dict); a repeated id is the same message written twice."""
        with open(os.path.join(self.subagents, f"agent-{aid}.jsonl"), "w") as fh:
            fh.write(json.dumps({"type": "user", "timestamp": first, "agentId": aid,
                                 "message": {"role": "user", "content": "go"}}) + "\n")
            for mid, t in messages:
                fh.write(json.dumps({"type": "assistant", "timestamp": "2026-10-28T10:02:00Z", "agentId": aid,
                                     "message": {"id": mid, "model": "claude-fake", "usage": t}}) + "\n")
        with open(os.path.join(self.subagents, f"agent-{aid}.meta.json"), "w") as fh:
            json.dump({"agentType": typ, "finished": finished}, fh)

    def agent(self, aid, typ, cond_tokens=None, frug_tokens=None, route=True, first="2026-10-28T10:00:01Z"):
        if cond_tokens is not None:
            if route:
                self.cond_rows.append({"type": "route", "ts": first.replace(":01Z", ":00Z"), "agentId": aid,
                                       "subagentType": typ, "cls": "x"})
            self.cond_rows.append({"type": "usage", "agentId": aid, "subagentType": typ, "description": "d",
                                   "model": "claude-fake", "steps": 3, "firstTs": first,
                                   "lastTs": "2026-10-28T10:05:00Z", **cond_tokens})
        if frug_tokens is not None:
            self.frug_rows.append({"ts": DAY_EPOCH + 40000, "session_id": SID, "agent_id": aid, "agent_type": typ,
                                   "model": "claude-fake", "main_model": "claude-fake", "escalated": False,
                                   "duration_ms": 1, "handoff_output_tokens": 0, **frug_tokens})

    def run(self, *extra):
        with open(os.path.join(self.ledger_dir, f"{DAY}-{SID}.jsonl"), "w") as fh:
            fh.writelines(json.dumps(r) + "\n" for r in self.cond_rows)
        with open(self.frugal, "w") as fh:
            fh.writelines(json.dumps(r) + "\n" for r in self.frug_rows)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = parity.main(["--day", DAY, "--conductor-dir", self.ledger_dir, "--frugal", self.frugal,
                                "--stats", self.stats, "--projects", self.projects, *extra])
        return code, buf.getvalue()


class ParityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.fx = Fixture(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_identical_tokens_pass(self):
        for i in range(3):
            self.fx.agent(f"a{i}", "Explore", toks(1_000_000 * (i + 1), 500), toks(1_000_000 * (i + 1), 500))
        code, out = self.fx.run("--against", "frugal", "--json")
        res = json.loads(out)
        self.assertEqual(code, 0)
        self.assertEqual(res["verdict"], "PASS")
        self.assertEqual(res["total"]["diff_pct"], 0.0)
        self.assertEqual(res["by_type"]["Explore"]["diff_pct"], 0.0)

    def test_one_type_eight_percent_off_fails_naming_it(self):
        for i in range(3):
            self.fx.agent(f"e{i}", "Explore", toks(1_000_000), toks(1_000_000))
            self.fx.agent(f"b{i}", "delegate:builder", toks(1_080_000), toks(1_000_000))
        for i in range(30):  # dilute the total under 5% so only the type check can fail
            self.fx.agent(f"p{i}", "Plan", toks(1_000_000), toks(1_000_000))
        code, out = self.fx.run("--against", "frugal")
        self.assertEqual(code, 1)
        verdict = out.strip().splitlines()[-1]
        self.assertTrue(verdict.startswith("FAIL"), verdict)
        self.assertIn("delegate:builder +8.00%", verdict)
        self.assertNotIn("total", verdict.split("--")[1])
        self.assertNotIn("Explore", verdict)

    def test_partial_agent_excluded_and_reported(self):
        for i in range(3):
            self.fx.agent(f"a{i}", "Explore", toks(1_000_000), toks(1_000_000))
        # spawned before the mod loaded: no route row, only its later steps counted
        self.fx.agent("partial", "Explore", toks(100_000), toks(5_000_000), route=False)
        code, out = self.fx.run("--against", "frugal", "--json")
        res = json.loads(out)
        self.assertEqual(code, 0, out)
        self.assertIn("partial", res["excluded"])
        self.assertNotIn("partial", [r["agent_id"] for r in res["per_agent"]])
        self.assertEqual(res["only"]["frugal_only_in_conductor_sessions"], 0)
        _, text = self.fx.run("--against", "frugal")
        self.assertIn("excluded 1 partial conductor agent(s)", text)

    def test_one_sided_agents_reported_not_joined(self):
        for i in range(3):
            self.fx.agent(f"a{i}", "Explore", toks(1_000_000), toks(1_000_000))
        self.fx.agent("conly", "Explore", toks(1_000_000), None)
        self.fx.agent("fonly1", "workflow-subagent", None, toks(1_000_000))
        self.fx.agent("fonly2", "workflow-subagent", None, toks(1_000_000))
        code, out = self.fx.run("--against", "frugal", "--json")
        res = json.loads(out)
        self.assertEqual(code, 0)
        self.assertEqual(res["total"]["n"], 3)
        self.assertEqual(res["only"]["conductor_only"], 1)
        self.assertEqual(res["only"]["frugal_only_in_conductor_sessions"], 2)
        self.assertEqual(res["only_types"]["frugal_only_in_conductor_sessions"], {"workflow-subagent": 2})
        self.assertEqual(res["only_ids"]["conductor_only"], ["conly"])

    def test_too_little_overlap_exits_2(self):
        for i in range(2):
            self.fx.agent(f"a{i}", "Explore", toks(1_000_000), toks(1_000_000))
        code, out = self.fx.run("--against", "frugal")
        self.assertEqual(code, 2)
        self.assertIn("INSUFFICIENT: 2 joined agent(s), need >= 3", out)

    def test_pricing_goes_through_injected_stats(self):
        for i in range(3):
            self.fx.agent(f"a{i}", "Explore", toks(2_000_000, 1_000_000), toks(2_000_000, 1_000_000))
        code, out = self.fx.run("--against", "frugal", "--json")
        res = json.loads(out)
        self.assertEqual(res["stats_path"], self.fx.stats)
        # fake stats prices every token at $1/M: 3 agents x 3M tokens = $9 per side
        self.assertAlmostEqual(res["total"]["conductor_usd"], 9.0)
        self.assertAlmostEqual(res["total"]["frugal_usd"], 9.0)
        stats = parity.load_stats(self.fx.stats)
        stats.cost_usd({"model": "m", "output_tokens": 1})
        self.assertEqual(stats.CALLS, ["m"])

    def test_missing_stats_errors_clearly(self):
        with self.assertRaises(SystemExit) as cm:
            parity.load_stats(os.path.join(self.tmp.name, "nope.py"))
        self.assertIn("stats.py with PRICES and cost_usd not found", str(cm.exception))

    def test_default_reference_is_the_transcripts(self):
        # frugal under-records every agent by 25%; the transcripts hold what conductor logged
        for i in range(3):
            n = 1_000_000 * (i + 1)
            self.fx.agent(f"a{i}", "delegate:builder", toks(n, 400), toks(n * 3 // 4, 300))
            self.fx.transcript(f"a{i}", "delegate:builder", [(f"m{i}a", toks(n // 2, 100)), (f"m{i}b", toks(n // 2, 300))])
        code, out = self.fx.run("--json")
        res = json.loads(out)
        self.assertEqual(res["against"], "transcript")
        self.assertEqual(code, 0, out)
        self.assertEqual(res["total"]["diff_pct"], 0.0)
        code_f, _ = self.fx.run("--against", "frugal")
        self.assertEqual(code_f, 1)

    def test_transcript_usage_counts_each_message_once(self):
        # a message written twice (one line per content block) carries the same usage: count it once
        for i in range(3):
            self.fx.agent(f"a{i}", "Explore", toks(1_000_000, 200), None)
            self.fx.transcript(f"a{i}", "Explore", [("m1", toks(600_000, 100)), ("m1", toks(600_000, 100)),
                                                    ("m2", toks(400_000, 100))])
        code, out = self.fx.run("--json")
        res = json.loads(out)
        self.assertEqual(code, 0, out)
        self.assertEqual(res["total"]["frugal_tokens"], 3 * 1_000_200)

    def test_unfinished_and_premod_transcripts_are_left_out(self):
        for i in range(3):
            self.fx.agent(f"a{i}", "Explore", toks(1_000_000), None)
            self.fx.transcript(f"a{i}", "Explore", [("m", toks(1_000_000))])
        self.fx.transcript("running", "Explore", [("m", toks(5))], finished=False)
        self.fx.transcript("early", "Explore", [("m", toks(5))], first="2026-10-28T09:00:00Z")
        self.fx.transcript("missed", "Explore", [("m", toks(5))], first="2026-10-28T11:00:00Z")
        code, out = self.fx.run("--json")
        res = json.loads(out)
        self.assertEqual(code, 0, out)
        self.assertEqual(res["only_ids"]["frugal_only_in_conductor_sessions"], ["missed"])
        _, text = self.fx.run()
        self.assertIn("transcript_only_in_conductor_sessions: 1 (Explore 1)", text)
        self.assertIn("reference: transcript", text)


if __name__ == "__main__":
    unittest.main()
