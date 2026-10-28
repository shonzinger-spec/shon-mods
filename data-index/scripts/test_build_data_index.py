import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data_index as bdi  # noqa: E402

import pyarrow as pa  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402


def minutes(start, n, step=60, skip=()):
    out, t = [], start
    for i in range(n):
        if not any(a <= t < b for a, b in skip):
            out.append(t)
        t += timedelta(seconds=step)
    return out


def write_parquet(path, stamps):
    tbl = pa.table({"timestamp": pa.array(stamps, pa.timestamp("ns")), "close": pa.array([1.0] * len(stamps))})
    pq.write_table(tbl, path)


def write_csv(path, stamps):
    with open(path, "w") as fh:
        fh.write("timestamp,open,close\n")
        for t in stamps:
            fh.write(f"{t.isoformat()},1.0,1.0\n")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = self.tmp.name
        self.out = os.path.join(self.d, "out", "index.json")
        self.bad = os.path.join(self.d, "bad.json")
        with open(self.bad, "w") as fh:
            json.dump({"files": [{"id": "kag", "match": "NQ_1m_kaggle", "defect": "+1 min offset"},
                                 {"id": "rx", "match": "regex:(?<![\\w])MGC_5m\\.parquet", "defect": "hole"}],
                       "costs": {"NQ": 1}}, fh)

    def tearDown(self):
        self.tmp.cleanup()

    def build(self, **kw):
        return bdi.build([self.d], {".git"}, self.out, self.bad, **kw)


class TestNames(unittest.TestCase):
    def test_symbol_and_tf_from_filename(self):
        self.assertEqual(bdi.symbol_from_name("NQ_1m_kaggle_clean.parquet"), "NQ")
        self.assertEqual(bdi.symbol_from_name("orbpb_MGC_5m.parquet"), "MGC")
        self.assertIsNone(bdi.symbol_from_name("trades_summary.csv"))
        self.assertEqual(bdi.tf_from_name("ES_15min.csv"), ("15m", 900))
        self.assertEqual(bdi.tf_from_name("NQ_1h.parquet"), ("1h", 3600))
        self.assertEqual(bdi.tf_from_name("NQ_ticks.parquet")[0], "tick")
        self.assertEqual(bdi.tf_from_name("prices.parquet"), (None, None))

    def test_roll_map(self):
        self.assertEqual(bdi.roll_for("/x/NQ_1m_kaggle_clean.parquet"), "forward-adjusted")
        self.assertEqual(bdi.roll_for("/x/NQ_1m_primary.parquet"), "unadjusted")
        self.assertEqual(bdi.roll_for("/x/lse/NQ.F_1m.csv"), "undisclosed (LSE .F)")
        self.assertEqual(bdi.roll_for("/x/topstep/MNQ_5m.parquet"), "front contract")
        self.assertIsNone(bdi.roll_for("/x/NQ_1m_6mo.parquet"))


class TestGaps(unittest.TestCase):
    def test_weekend_and_daily_halt_are_not_gaps(self):
        # Thu 2024-01-04 12:00 ET -> Mon 2024-01-08 12:00 ET, 1m bars, closed hours removed.
        et = bdi.ET
        start = datetime(2024, 1, 4, 12, 0, tzinfo=et)
        closed = [(datetime(2024, 1, 4, 17, tzinfo=et), datetime(2024, 1, 4, 18, tzinfo=et)),
                  (datetime(2024, 1, 5, 17, tzinfo=et), datetime(2024, 1, 7, 18, tzinfo=et))]
        stamps = minutes(start, 4 * 24 * 60, skip=closed)
        ns = [int(t.timestamp() * 1e9) for t in stamps]
        med, gaps, largest = bdi.gap_stats(ns, 60, None)
        self.assertEqual(med, 60)
        self.assertEqual(gaps, 0)
        self.assertIsNone(largest)

    def test_hole_in_session_is_a_gap(self):
        et = bdi.ET
        start = datetime(2024, 1, 3, 9, 0, tzinfo=et)  # Wednesday
        hole = [(datetime(2024, 1, 3, 10, tzinfo=et), datetime(2024, 1, 3, 11, tzinfo=et))]
        ns = [int(t.timestamp() * 1e9) for t in minutes(start, 240, skip=hole)]
        _, gaps, largest = bdi.gap_stats(pa.array(ns, pa.int64()), 60, None)
        self.assertEqual(gaps, 1)
        self.assertAlmostEqual(largest["open_hours"], 1.02, places=2)

    def test_tf_inferred_from_median_step(self):
        ns = [i * 300 * 10**9 for i in range(100)]
        med, gaps, _ = bdi.gap_stats(ns, None, timezone.utc)
        self.assertEqual(med, 300)
        self.assertEqual(bdi.tf_label(med), "5m")


class TestBuild(Base):
    def test_parquet_and_csv_indexed_with_tf_inference_and_bad_merge(self):
        start = datetime(2024, 1, 3, 14, 0)  # naive = UTC
        write_parquet(os.path.join(self.d, "NQ_1m_kaggle_clean.parquet"), minutes(start, 500))
        write_csv(os.path.join(self.d, "prices_es.csv"), minutes(start, 300, step=300))
        write_parquet(os.path.join(self.d, "MGC_5m.parquet"), minutes(start, 200, step=300))
        idx = self.build()
        by = {os.path.basename(f["path"]): f for f in idx["files"]}
        nq = by["NQ_1m_kaggle_clean.parquet"]
        self.assertEqual((nq["symbol"], nq["tf"], nq["rows"], nq["gaps"]), ("NQ", "1m", 500, 0))
        self.assertEqual(nq["start"], "2024-01-03T14:00:00+00:00")
        self.assertEqual(nq["roll"], "forward-adjusted")
        self.assertEqual(nq["bad"][0]["id"], "kag")
        self.assertFalse(nq["clean"])
        es = by["prices_es.csv"]
        self.assertEqual((es["symbol"], es["tf"], es["rows"]), ("ES", "5m", 300))
        self.assertTrue(es.get("tf_inferred"))
        self.assertTrue(es["clean"])
        self.assertEqual(by["MGC_5m.parquet"]["bad"][0]["id"], "rx")
        with open(self.out) as fh:
            self.assertEqual(json.load(fh)["count"], 3)

    def test_index_is_compact_and_a_slim_lookup_file_is_written_beside_it(self):
        # /data reads through the mod API's 4 MiB read limit: no indentation, and
        # a lookup file holding only the fields /data shows.
        write_parquet(os.path.join(self.d, "NQ_1m_kaggle_clean.parquet"), minutes(datetime(2024, 1, 3, 14), 500))
        self.build()
        with open(self.out) as fh:
            text = fh.read()
        self.assertNotIn("\n", text)
        self.assertEqual(text, json.dumps(json.loads(text), separators=(",", ":")))
        lookup = os.path.join(os.path.dirname(self.out), "index.lookup.json")
        with open(lookup) as fh:
            ltext = fh.read()
        slim = json.loads(ltext)
        self.assertNotIn("\n", ltext)
        self.assertEqual(slim["count"], 1)
        f = slim["files"][0]
        self.assertEqual((f["symbol"], f["tf"], f["rows"], f["roll"], f["bad"][0]["id"]), ("NQ", "1m", 500, "forward-adjusted", "kag"))
        self.assertTrue(f["path"].endswith("NQ_1m_kaggle_clean.parquet"))
        self.assertFalse({"realpath", "mtime", "size", "ts_col", "clean"} & set(f))
        self.assertLess(len(ltext), len(text))

    def test_non_time_series_has_null_gaps(self):
        pq.write_table(pa.table({"a": list(range(2000)), "b": [0.5] * 2000}), os.path.join(self.d, "params.parquet"))
        f = self.build()["files"][0]
        self.assertEqual(f["rows"], 2000)
        self.assertIsNone(f["gaps"])
        self.assertIsNone(f["start"])

    def test_small_files_skipped(self):
        with open(os.path.join(self.d, "tiny.csv"), "w") as fh:
            fh.write("timestamp\n")
        self.assertEqual(self.build()["count"], 0)

    def test_cache_hit_skips_reread(self):
        write_parquet(os.path.join(self.d, "NQ_1m_x.parquet"), minutes(datetime(2024, 1, 3), 500))
        first = self.build()
        self.assertEqual(first["files_read"], 1)
        with mock.patch.object(bdi, "analyze", side_effect=AssertionError("re-read")):
            second = self.build()
        self.assertEqual((second["files_read"], second["cache_hits"]), (0, 1))
        self.assertEqual(second["files"][0]["rows"], 500)

    def test_changed_file_is_reread(self):
        p = os.path.join(self.d, "NQ_1m_x.parquet")
        write_parquet(p, minutes(datetime(2024, 1, 3), 500))
        self.build()
        write_parquet(p, minutes(datetime(2024, 1, 3), 900))
        os.utime(p, (1, 1))
        again = self.build()
        self.assertEqual((again["files_read"], again["files"][0]["rows"]), (1, 900))

    def test_budget_writes_partial_and_resumes(self):
        write_parquet(os.path.join(self.d, "NQ_1m_x.parquet"), minutes(datetime(2024, 1, 3), 500))
        idx = self.build(max_seconds=-1)
        self.assertTrue(idx["partial"])
        self.assertEqual(idx["count"], 0)
        self.assertFalse(self.build()["partial"])

    def test_symlink_cycle_and_duplicate_link_do_not_loop_or_double(self):
        sub = os.path.join(self.d, "proj")
        os.makedirs(sub)
        write_parquet(os.path.join(sub, "ES_1m.parquet"), minutes(datetime(2024, 1, 3), 300))
        os.symlink(self.d, os.path.join(sub, "loop"))
        os.symlink(sub, os.path.join(self.d, "hub_link"))
        idx = self.build()
        self.assertEqual(idx["count"], 1)


class TestMain(unittest.TestCase):
    def test_fatal_error_prints_json_and_exits_zero(self):
        import subprocess
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "build_data_index.py")
        r = subprocess.run([sys.executable, script, "--root", "/nonexistent", "--out", "/dev/null/x/index.json"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0)
        self.assertIn("error", json.loads(r.stdout.strip().splitlines()[-1]))


if __name__ == "__main__":
    unittest.main()
