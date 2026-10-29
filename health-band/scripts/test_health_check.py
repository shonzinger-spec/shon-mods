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


GONE_LINE = "2026-10-28 18:30:14 ERR NQ.F try 7/8: [410] {\"detail\":\"Look at the new documentation: https://londonstrategicedge.com/docs/api\"}"


class ForwardDataGap(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.orig = hc.job_logs

    def tearDown(self):
        import shutil
        hc.job_logs = self.orig
        shutil.rmtree(self.tmp, ignore_errors=True)

    def log(self, name, text):
        p = os.path.join(self.tmp, name)
        with open(p, "w") as f:
            f.write(text)
        return p

    def logs(self, cfg, pairs):
        hc.job_logs = lambda rx: pairs
        issues = []
        hc.check_logs(cfg, dt.datetime(2026, 10, 29, 1, 0), issues)
        return issues

    def test_410_is_red_lse_gone_naming_the_migration_doc_and_429_stays_amber(self):
        gone = self.log("run.err", GONE_LINE + "\n")
        limit = self.log("lim.err", "daily request limit reached\n")
        issues = self.logs({"label_regex": "."}, [("com.propfarm.livepractice", gone), ("com.propfarm.v62", limit)])
        by = {i["check"]: i for i in issues}
        self.assertEqual(by["lse-gone"]["level"], "red")
        self.assertIn("LSE API v2 retired (HTTP 410)", by["lse-gone"]["text"])
        self.assertIn("LSE_V3_MIGRATION.md", by["lse-gone"]["text"])
        self.assertEqual(by["lse-gone"]["affects"], ["livepractice"])
        self.assertEqual(by["lse-limit"]["level"], "amber")
        self.assertNotIn("lse-key", by)

    def test_410_in_several_logs_is_one_issue_with_every_name(self):
        a = self.log("a.err", GONE_LINE + "\n")
        b = self.log("b.err", GONE_LINE + "\n")
        issues = self.logs({"label_regex": "."}, [("com.propfarm.livepractice", a), ("com.propfarm.claude4b", b)])
        gone = [i for i in issues if i["check"] == "lse-gone"]
        self.assertEqual(len(gone), 1)
        self.assertEqual(gone[0]["affects"], ["livepractice", "claude4b"])

    def test_an_old_410_line_in_a_recently_touched_log_is_ignored(self):
        old = self.log("run.log", "2026-10-20 09:00:00 ET  live context build failed: [410] new documentation\n"
                                   "2026-10-28 09:10:29 ET  live plan ok\n")
        self.assertEqual(self.logs({"label_regex": "."}, [("com.propfarm.claude4b", old)]), [])

    def test_extra_logs_are_scanned_like_job_logs(self):
        d = os.path.join(self.tmp, "plans")
        os.makedirs(d)
        p = os.path.join(d, "run.log")
        with open(p, "w") as f:
            f.write("Your credit balance is too low\n" + GONE_LINE + "\n")
        issues = self.logs({"label_regex": "^$", "extra_logs": [p]}, [])
        self.assertEqual(sorted(i["check"] for i in issues), ["api-credit", "lse-gone"])
        self.assertEqual([i for i in issues if i["check"] == "lse-gone"][0]["affects"], ["plans"])

    def test_missing_extra_log_is_skipped(self):
        self.assertEqual(self.logs({"label_regex": "^$", "extra_logs": [os.path.join(self.tmp, "nope.log")]}, []), [])

    def test_a_stamped_credit_line_older_than_the_window_is_ignored(self):
        p = self.log("run.log", "2026-10-05 12:53:11 ET  replay ERROR Your credit balance is too low\n2026-10-28 09:10:29 ET  live plan ok\n")
        self.assertEqual(self.logs({"label_regex": "."}, [("com.propfarm.claude4b", p)]), [])

    def test_the_410_is_found_even_when_the_displayed_error_is_cut(self):
        long_err = "2026-10-26 09:25:21 ET  live 2026-10-26 context build failed: RuntimeError: LSE recent bars failed after 4 tries: LSEError('[410] Look at the new documentation')"
        cfg = self.fake_forward([self.job(name="Lil Fish 4b", last_exit=1, errors=[long_err])])
        issues = []
        hc.check_jobs(cfg, issues)
        self.assertIn("[410]", issues[0]["detail"])
        issues.append({"level": "red", "check": "lse-gone", "text": "x", "affects": []})
        out = hc.group_causes(issues)
        self.assertEqual([i["check"] for i in out], ["lse-gone"])
        self.assertEqual(out[0]["affects"], ["Lil Fish 4b"])

    def test_grouping_collapses_410_job_rows_into_the_cause_and_sorts_red_first(self):
        issues = [
            {"level": "amber", "check": "lse-limit", "text": "LSE daily request limit hit"},
            {"level": "red", "check": "job", "subject": "livepractice", "text": "forward job livepractice: last exit 1: ERR NQ.F [410] x"},
            {"level": "red", "check": "job", "subject": "oftick", "text": "forward job oftick: missed run due Mon 08:00"},
            {"level": "red", "check": "job", "subject": "claude4b", "text": "forward job claude4b: last exit 1: LSE recent bars failed [410]"},
            {"level": "red", "check": "lse-gone", "text": "LSE API v2 retired (HTTP 410)", "affects": ["livepractice"]},
        ]
        out = hc.group_causes(issues)
        self.assertEqual([i["check"] for i in out], ["lse-gone", "job", "lse-limit"])
        self.assertEqual(out[0]["affects"], ["livepractice", "claude4b"])
        self.assertTrue(out[0]["text"].endswith(" -- affects: livepractice, claude4b"))
        self.assertEqual(hc.group_causes(out)[0]["text"], out[0]["text"])  # idempotent
        self.assertEqual(out[1]["subject"], "oftick")
        self.assertEqual(len(issues), 5)  # input untouched

    def test_without_lse_gone_nothing_is_collapsed_but_red_still_sorts_first(self):
        issues = [{"level": "amber", "check": "feed", "text": "a"},
                  {"level": "red", "check": "job", "subject": "x", "text": "forward job x: last exit 1: [410]"}]
        self.assertEqual([i["check"] for i in hc.group_causes(issues)], ["job", "feed"])

    def fake_forward(self, jobs):
        p = os.path.join(self.tmp, "fake_forward.py")
        with open(p, "w") as f:
            f.write(f"JOBS = {jobs!r}\ndef collect(*a, **k):\n    return {{'jobs': JOBS}}\n")
        return {"forward_pane": p}

    def job(self, **kw):
        base = {"name": "j", "stale": False, "stale_reason": "", "last_exit": 0, "running": False, "errors": []}
        base.update(kw)
        return base

    def test_job_row_appends_the_last_error_line_to_the_exit_text(self):
        cfg = self.fake_forward([
            self.job(name="restart live practice", last_exit=1, errors=["older", "ERR NQ.F try 7/8: [410] gone"]),
            self.job(name="quiet", last_exit=0, errors=["old noise"]),
            self.job(name="running", last_exit=1, running=True),
            self.job(name="stale one", stale=True, stale_reason="missed run due Mon 08:00", errors=["x"]),
            self.job(name="no errors", last_exit=2),
        ])
        issues = []
        hc.check_jobs(cfg, issues)
        self.assertEqual([i["subject"] for i in issues], ["restart live practice", "stale one", "no errors"])
        self.assertEqual(issues[0]["text"], "forward job restart live practice: last exit 1: ERR NQ.F try 7/8: [410] gone")
        self.assertEqual(issues[0]["detail"], "ERR NQ.F try 7/8: [410] gone")
        self.assertEqual(issues[1]["text"], "forward job stale one: missed run due Mon 08:00")
        self.assertEqual(issues[2]["text"], "forward job no errors: last exit 2")

    def test_run_includes_the_data_flow_check_and_groups(self):
        gone = self.log("run.err", GONE_LINE + "\n")
        stale = self.log("x.parquet", "x")
        os.utime(stale, (1.0e9, 1.0e9))
        cfg = os.path.join(self.tmp, "cfg.json")
        with open(cfg, "w") as f:
            json.dump({"label_regex": "^$", "extra_logs": [gone], "lse_key": gone, "feeds": [],
                       "data_flow": [{"name": "livepractice", "kind": "mtime_glob", "path": stale, "max_lag_business_days": 3}]}, f)
        t = dt.datetime(2026, 10, 29, 0, 30).timestamp()
        os.utime(gone, (t, t))
        res = hc.run(cfg, now=dt.datetime(2026, 10, 29, 1, 0))
        checks = [i["check"] for i in res["issues"]]
        self.assertEqual(checks[0], "lse-gone")
        self.assertIn("data-flow", checks)


if __name__ == "__main__":
    unittest.main()
