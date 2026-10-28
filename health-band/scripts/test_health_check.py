"""Tests for health_check.py. Run: python3 -m unittest discover -s <this folder>"""
import datetime as dt, json, os, sys, tempfile, unittest
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import health_check as hc  # noqa: E402

ET = ZoneInfo("America/New_York")


class MarketMinutes(unittest.TestCase):
    def test_weekend_counts_only_open_minutes(self):
        fri = dt.datetime(2026, 10, 16, 16, 0, tzinfo=ET)
        sun = dt.datetime(2026, 10, 18, 19, 0, tzinfo=ET)
        self.assertEqual(hc.market_minutes(fri, sun), 120)  # Fri 16-17 + Sun 18-19

    def test_daily_halt_is_closed(self):
        a = dt.datetime(2026, 10, 20, 16, 30, tzinfo=ET)
        b = dt.datetime(2026, 10, 20, 18, 30, tzinfo=ET)
        self.assertEqual(hc.market_minutes(a, b), 60)

    def test_saturday_is_zero(self):
        a = dt.datetime(2026, 10, 17, 9, 0, tzinfo=ET)
        self.assertEqual(hc.market_minutes(a, a + dt.timedelta(hours=8)), 0)


class Checks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def log(self, name, text):
        p = os.path.join(self.tmp, name)
        with open(p, "w") as f:
            f.write(text)
        return p

    def test_credit_error_is_red_and_clean_log_is_quiet(self):
        bad = self.log("bad.log", "ok\nanthropic.BadRequestError: Your credit balance is too low to access the API\n")
        good = self.log("good.log", "heartbeat\nheartbeat\n")
        orig = hc.job_logs
        hc.job_logs = lambda rx: [("com.propfarm.claude4b", bad), ("com.mnq-mgc.observe", good)]
        try:
            issues = []
            hc.check_logs({"label_regex": "."}, dt.datetime.now(), issues)
        finally:
            hc.job_logs = orig
        self.assertEqual([(i["level"], i["check"]) for i in issues], [("red", "api-credit")])
        self.assertIn("claude4b", issues[0]["text"])

    def test_missing_lse_key_is_red(self):
        issues = []
        hc.check_lse_key({"lse_key": os.path.join(self.tmp, "nope")}, issues)
        self.assertEqual(issues[0]["level"], "red")
        issues = []
        hc.check_lse_key({"lse_key": self.log("key", "abc123")}, issues)
        self.assertEqual(issues, [])

    def feed(self, last_et):
        import pandas as pd
        idx = pd.date_range(end=last_et, periods=5, freq="5min")
        p = os.path.join(self.tmp, "f.parquet")
        pd.DataFrame({"timestamp": idx.tz_convert("UTC"), "close": range(5)}).to_parquet(p)
        return {"feeds": [{"name": "F", "path": p, "ts": "timestamp", "bar_minutes": 5, "max_stale_market_min": 30}]}

    def test_stale_feed_is_red_fresh_is_quiet(self):
        now = dt.datetime(2026, 10, 20, 11, 0, tzinfo=ET)  # Tuesday
        issues = []
        hc.check_feeds(self.feed(now - dt.timedelta(hours=3)), now, issues)
        self.assertEqual(issues[0]["level"], "red")
        issues = []
        hc.check_feeds(self.feed(now - dt.timedelta(minutes=10)), now, issues)
        self.assertEqual(issues, [])

    def test_friday_close_is_not_stale_on_saturday(self):
        last = dt.datetime(2026, 10, 16, 16, 55, tzinfo=ET)
        now = dt.datetime(2026, 10, 17, 12, 0, tzinfo=ET)
        issues = []
        hc.check_feeds(self.feed(last), now, issues)
        self.assertEqual(issues, [])

    def test_run_levels(self):
        cfg = os.path.join(self.tmp, "cfg.json")
        with open(cfg, "w") as f:
            json.dump({"label_regex": "^$", "lse_key": os.path.join(self.tmp, "nope"), "feeds": []}, f)
        res = hc.run(cfg)
        self.assertEqual(res["level"], "red")


class Stats(unittest.TestCase):
    NOW = dt.datetime(2026, 10, 27, 12, 0).astimezone()

    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, rel, text):
        p = os.path.join(self.tmp, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write(text)
        return p

    def test_lse_counts_only_todays_local_calls(self):
        off = self.NOW.strftime("%z")
        off = off[:3] + ":" + off[3:]
        log = self.write("lse.log", "".join([
            f"2026-10-26T23:59:59{off}\tfetch.py\tNQ.F\t200\n",
            f"2026-10-27T00:00:01{off}\tfetch.py\tNQ.F\t200\n",
            f"2026-10-27T09:10:20{off}\tfetch.py\tNQ.F\t410\n",
            "garbage line\n",
            f"2026-10-27T23:59:00{off}\tfetch.py\tNQ.F\t0\n",
            f"2026-10-28T00:00:00{off}\tfetch.py\tNQ.F\t200\n",
        ]))
        self.assertEqual(hc.lse_today({"lse_calls_log": log}, self.NOW), {"count": 3, "limit": 15000})

    def test_lse_missing_log_is_unavailable(self):
        cfg = {"lse_calls_log": os.path.join(self.tmp, "nope.log"), "agent_logs": self.tmp,
               "profile_script": os.path.join(self.tmp, "nope.py")}
        st = hc.stats(cfg, self.NOW)
        self.assertIsNone(st["lse"])
        self.assertIsNone(st["overhead_tokens"])

    def test_agent_jobs_states_and_window(self):
        alive = os.getpid()
        d = os.path.join(self.tmp, "logs")
        self.write("logs/codex-20261027-070422-1.log", "dispatch-start: x\nOK: from the agent, not a verdict\ndispatch-exit: 0\nOK: 0 changed file(s)\n")
        self.write("logs/codex-20261027-080000-2.log", "dispatch-start: x\ndispatch-exit: 0\nOK: 3 changed file(s)\n")
        self.write("logs/cline-20261027-090000-%d.log" % alive, "dispatch-start: x\nOK: an agent line mid-run\n")
        self.write("logs/opencode-20261027-065637-3.log", "dispatch-start: x\ndispatch-exit: 0\nFAILED:zero-changed-files\n")
        self.write("logs/amp-20261027-100000-999999999.log", "dispatch-start: x\n")  # died with no verdict
        self.write("logs/copilot-20261026-100000-4.log", "dispatch-start: x\ndispatch-exit: 0\nOK: 1 changed file(s)\n")  # yesterday
        self.write("logs/opencode-20261026-100000-%d.log" % alive, "dispatch-start: x\n")  # yesterday, still running
        self.write("logs/item2.run", "dispatch: codex ...\n")
        self.write("logs/R1.log", "not a dispatch log\n")
        jobs = hc.agent_jobs({"agent_logs": d}, self.NOW)
        self.assertEqual(jobs, [
            {"agent": "codex", "ok": 2, "running": 0, "failed": 0},
            {"agent": "cline", "ok": 0, "running": 1, "failed": 0},
            {"agent": "opencode", "ok": 0, "running": 1, "failed": 1},
            {"agent": "amp", "ok": 0, "running": 0, "failed": 1},
        ])

    def test_agent_jobs_missing_dir_is_unavailable(self):
        st = hc.stats({"agent_logs": os.path.join(self.tmp, "nope")}, self.NOW)
        self.assertIsNone(st["jobs"])

    def test_overhead_adds_user_skills_to_profile_measure(self):
        script = self.write("profile.py", (
            "def folded_description(text):\n"
            "    return text.split('description: ', 1)[1].split('\\n', 1)[0] if 'description: ' in text else ''\n"
            "def main(argv=None):\n"
            "    assert argv == ['measure']\n"
            "    print('plugins 2 (unknown 0), skills 3, commands 1, agents 1, desc_chars 4000, ~tokens 1000')\n"
            "    return 0\n"))
        self.write("skills/a/SKILL.md", "---\ndescription: " + "x" * 400 + "\n---\nbody\n")
        self.write("skills/b/SKILL.md", "---\nname: b\n---\n")
        cfg = {"profile_script": script, "user_skills": os.path.join(self.tmp, "skills/*/SKILL.md")}
        self.assertEqual(hc.overhead_tokens(cfg), (4000 + 400) // 4)

    def test_overhead_failed_measure_is_unavailable(self):
        script = self.write("profile.py", "def main(argv=None):\n    print('profile: boom')\n    return 1\n")
        self.assertIsNone(hc.stats({"profile_script": script}, self.NOW)["overhead_tokens"])

    def test_run_carries_stats(self):
        cfg = os.path.join(self.tmp, "health.json")
        with open(cfg, "w") as f:
            json.dump({"label_regex": "^$", "lse_key": os.path.join(self.tmp, "nope"), "feeds": [],
                       "lse_calls_log": self.write("lse.log", ""), "agent_logs": self.tmp,
                       "profile_script": os.path.join(self.tmp, "nope.py")}, f)
        res = hc.run(cfg)
        self.assertEqual(set(res["stats"]), {"lse", "jobs", "overhead_tokens"})
        self.assertEqual(res["stats"]["lse"]["count"], 0)
        self.assertEqual(res["stats"]["jobs"], [])


if __name__ == "__main__":
    unittest.main()
