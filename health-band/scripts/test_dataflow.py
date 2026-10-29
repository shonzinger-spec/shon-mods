"""Tests for dataflow.py. Run: python3 -m unittest discover -s <this folder>"""
import datetime as dt, json, os, shutil, sys, tempfile, unittest
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dataflow as df  # noqa: E402

ET = ZoneInfo("America/New_York")
THU = dt.datetime(2026, 10, 29, 9, 0)   # Thursday, local naive
FRI = dt.datetime(2026, 10, 23, 17, 0)


class DataFlow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def file(self, name, text="x", mtime=None):
        p = os.path.join(self.tmp, name)
        with open(p, "w") as f:
            f.write(text)
        if mtime:
            t = mtime.timestamp()
            os.utime(p, (t, t))
        return p

    def run_one(self, item, now=THU, **kw):
        issues = []
        df.check({"data_flow": [item]}, now, issues, **kw)
        return issues

    # lag arithmetic
    def test_business_lag_skips_weekends(self):
        fri = dt.datetime(2026, 10, 23, 17, 0)
        self.assertEqual(df.business_lag(fri, dt.datetime(2026, 10, 24, 12, 0)), 0)  # Sat
        self.assertEqual(df.business_lag(fri, dt.datetime(2026, 10, 25, 12, 0)), 0)  # Sun
        self.assertEqual(df.business_lag(fri, dt.datetime(2026, 10, 26, 7, 0)), 1)   # Mon
        self.assertEqual(df.business_lag(fri, dt.datetime(2026, 10, 29, 9, 0)), 4)   # Thu
        self.assertEqual(df.business_lag(fri, fri), 0)

    # mtime_glob
    def test_stale_mtime_glob_is_red_even_though_the_job_exits_zero(self):
        self.file("NQ_live.parquet", mtime=FRI)
        item = {"name": "livepractice", "kind": "mtime_glob", "path": os.path.join(self.tmp, "*_live.parquet"), "max_lag_business_days": 3}
        issues = self.run_one(item)
        self.assertEqual([(i["level"], i["check"]) for i in issues], [("red", "data-flow")])
        self.assertIn("livepractice", issues[0]["text"])
        self.assertIn("2026-10-23", issues[0]["text"])

    def test_mtime_glob_uses_the_newest_file(self):
        self.file("a_live.parquet", mtime=FRI)
        self.file("b_live.parquet", mtime=THU - dt.timedelta(hours=2))
        item = {"name": "lp", "kind": "mtime_glob", "path": os.path.join(self.tmp, "*_live.parquet"), "max_lag_business_days": 3}
        self.assertEqual(self.run_one(item), [])

    def test_weekend_does_not_count_toward_lag(self):
        self.file("x.parquet", mtime=FRI)
        item = {"name": "lp", "kind": "mtime_glob", "path": os.path.join(self.tmp, "x.parquet"), "max_lag_business_days": 1}
        self.assertEqual(self.run_one(item, now=dt.datetime(2026, 10, 25, 20, 0)), [])    # Sunday evening
        self.assertEqual(self.run_one(item, now=dt.datetime(2026, 10, 26, 7, 0)), [])     # Monday, limit 1
        self.assertEqual(self.run_one(item, now=dt.datetime(2026, 10, 27, 7, 0))[0]["level"], "red")  # Tuesday: 2 > 1

    def test_fresh_is_quiet(self):
        self.file("x.parquet", mtime=THU - dt.timedelta(hours=1))
        item = {"name": "lp", "kind": "mtime_glob", "path": os.path.join(self.tmp, "x.parquet"), "max_lag_business_days": 1}
        self.assertEqual(self.run_one(item), [])

    def test_calendar_day_limit(self):
        self.file("x.parquet", mtime=THU - dt.timedelta(days=3))
        item = {"name": "t", "kind": "mtime_glob", "path": os.path.join(self.tmp, "x.parquet"), "max_lag_days": 2}
        self.assertEqual(self.run_one(item)[0]["level"], "red")
        item["max_lag_days"] = 4
        self.assertEqual(self.run_one(item), [])

    # missing / broken
    def test_missing_path_is_amber_not_a_crash(self):
        for kind in ("mtime_glob", "parquet_ts", "json_field", "log_match"):
            item = {"name": "gone", "kind": kind, "path": os.path.join(self.tmp, "nope*"), "ts": "ts", "field": "updated",
                    "pattern": "x", "max_lag_days": 1}
            issues = self.run_one(item)
            self.assertEqual([(i["level"], i["check"]) for i in issues], [("amber", "data-flow")], kind)

    def test_unknown_kind_is_amber(self):
        issues = self.run_one({"name": "z", "kind": "wat", "path": "/x", "max_lag_days": 1})
        self.assertEqual(issues[0]["level"], "amber")

    # parquet_ts
    def test_parquet_ts_reads_newest_bar_through_the_injected_reader(self):
        p = self.file("t.parquet")
        seen = []

        def reader(path, col):
            seen.append((path, col))
            return dt.datetime(2026, 10, 16, 16, 59, tzinfo=ET)
        item = {"name": "ticks", "kind": "parquet_ts", "path": p, "ts": "ts", "max_lag_days": 10}
        issues = self.run_one(item, newest_bar_fn=reader)
        self.assertEqual(seen, [(p, "ts")])
        self.assertEqual([i["level"] for i in issues], ["red"])
        self.assertIn("2026-10-16", issues[0]["text"])

    def test_parquet_ts_real_file_fresh_and_stale(self):
        import pandas as pd
        idx = pd.date_range("2026-10-14 09:30", periods=5, freq="1min", tz="America/New_York")
        p = os.path.join(self.tmp, "real.parquet")
        pd.DataFrame({"vol": range(5), "ts": idx}).to_parquet(p)
        item = {"name": "ticks", "kind": "parquet_ts", "path": p, "ts": "ts", "max_lag_days": 10}
        self.assertEqual(self.run_one(item, now=dt.datetime(2026, 10, 20, 9, 0)), [])
        self.assertEqual(self.run_one(item, now=dt.datetime(2026, 10, 29, 9, 0))[0]["level"], "red")

    # json_field
    def test_json_field_with_et_suffix(self):
        p = self.file("status.json", json.dumps({"updated": "2026-10-28 08:00:05 ET", "state": "RUNNING"}))
        item = {"name": "oftick", "kind": "json_field", "path": p, "field": "updated", "max_lag_business_days": 2}
        self.assertEqual(self.run_one(item), [])
        self.assertEqual(self.run_one(item, now=dt.datetime(2026, 11, 3, 9, 0))[0]["level"], "red")

    def test_json_field_missing_or_unparseable_is_amber(self):
        p = self.file("status.json", json.dumps({"updated": "garbage"}))
        self.assertEqual(self.run_one({"name": "o", "kind": "json_field", "path": p, "field": "updated", "max_lag_days": 1})[0]["level"], "amber")
        self.assertEqual(self.run_one({"name": "o", "kind": "json_field", "path": p, "field": "nope", "max_lag_days": 1})[0]["level"], "amber")

    # log_match
    def test_log_match_recent_line_is_red_old_line_quiet(self):
        p = self.file("run.log", "2026-10-26 09:25:21 ET  live 2026-10-26 context build failed: RuntimeError: LSE\n"
                                 "2026-10-28 09:10:29 ET  live plan late=False {}\n")
        item = {"name": "claude4b", "kind": "log_match", "path": p, "pattern": "context build failed", "within_hours": 48}
        self.assertEqual(self.run_one(item, now=dt.datetime(2026, 10, 29, 9, 0)), [])
        issues = self.run_one(item, now=dt.datetime(2026, 10, 27, 9, 0))
        self.assertEqual([(i["level"], i["check"]) for i in issues], [("red", "data-flow")])
        self.assertIn("claude4b", issues[0]["text"])

    def test_one_broken_item_does_not_stop_the_rest(self):
        self.file("x.parquet", mtime=FRI)
        cfg = {"data_flow": [{"name": "bad", "kind": "mtime_glob"},
                             {"name": "lp", "kind": "mtime_glob", "path": os.path.join(self.tmp, "x.parquet"), "max_lag_business_days": 1}]}
        issues = []
        df.check(cfg, THU, issues)
        self.assertEqual([i["level"] for i in issues], ["amber", "red"])


if __name__ == "__main__":
    unittest.main()
