"""Tests for creds.py. Run: python3 -m unittest discover -s <this folder>"""
import builtins, datetime as dt, os, shutil, sys, tempfile, types, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import creds  # noqa: E402

NOW = dt.datetime(2026, 10, 29, 12, 0)  # local naive
DAY = 86400


def stamp_utc(local_naive):
    return local_naive.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ok_line(local_naive):
    return f"{stamp_utc(local_naive)} backed up /x/{{logs,reports}} to /y\n"


def fake_stat(size=108, age_days=10):
    return types.SimpleNamespace(st_size=size, st_mtime=(NOW - dt.timedelta(days=age_days)).timestamp())


class Backup(unittest.TestCase):
    def test_fresh_success_is_quiet(self):
        log = ok_line(NOW - dt.timedelta(hours=10))
        self.assertIsNone(creds.backup_status(log, "", NOW))

    def test_old_success_is_red_with_age_date_and_err_line(self):
        log = ok_line(dt.datetime(2026, 10, 14, 21, 0))
        err = "rsync(1): error: /Users/x/Library/Mobile Documents/com~apple~CloudDocs/autorank-backup/subdirectory/another: open: Operation not permitted\nrsync(2): error: unexpected end of file\n"
        level, text = creds.backup_status(log, err, NOW)
        self.assertEqual(level, "red")
        self.assertIn("AutoRank backup: last success 2026-10-14", text)
        self.assertIn("15 days ago", text)
        self.assertIn("Operation not permitted", text)
        self.assertNotIn("unexpected end of file", text)

    def test_newest_stamp_wins_over_file_order(self):
        log = ok_line(dt.datetime(2026, 10, 14, 21, 0)) + ok_line(NOW - dt.timedelta(hours=2)) + ok_line(dt.datetime(2026, 10, 1, 9, 0))
        self.assertIsNone(creds.backup_status(log, "", NOW))

    def test_missing_log_is_red(self):
        level, text = creds.backup_status(None, None, NOW)
        self.assertEqual(level, "red")
        self.assertIn("no log", text)

    def test_unparsable_log_is_amber(self):
        level, text = creds.backup_status("garbage\nnothing here\n", "", NOW)
        self.assertEqual(level, "amber")
        self.assertIn("no 'backed up' line", text)

    def test_custom_limit(self):
        log = ok_line(NOW - dt.timedelta(hours=10))
        self.assertEqual(creds.backup_status(log, "", NOW, max_age_hours=6)[0], "red")


class TokenAge(unittest.TestCase):
    def test_missing_is_red(self):
        level, text = creds.token_age_status(None, NOW, 365, 30)
        self.assertEqual(level, "red")
        self.assertIn("missing", text)

    def test_empty_is_red(self):
        level, text = creds.token_age_status(fake_stat(size=0), NOW, 365, 30)
        self.assertEqual(level, "red")
        self.assertIn("empty", text)

    def test_young_is_quiet(self):
        self.assertIsNone(creds.token_age_status(fake_stat(age_days=10), NOW, 365, 30))

    def test_near_expiry_is_amber_and_labelled_estimated(self):
        level, text = creds.token_age_status(fake_stat(age_days=340), NOW, 365, 30)
        self.assertEqual(level, "amber")
        self.assertIn("estimated", text)
        self.assertIn("25 days", text)

    def test_past_estimated_expiry_is_red(self):
        level, text = creds.token_age_status(fake_stat(age_days=400), NOW, 365, 30)
        self.assertEqual(level, "red")
        self.assertIn("estimated", text)


class ScanAuth(unittest.TestCase):
    def test_auth_error_line_hits(self):
        self.assertTrue(creds.scan_auth_errors(["ok", 'API Error: 401 {"type":"authentication_error"}']))
        self.assertTrue(creds.scan_auth_errors(["OAuth token has expired. Please run /login"]))
        self.assertTrue(creds.scan_auth_errors(["Invalid bearer token"]))

    def test_normal_log_and_bare_401_are_quiet(self):
        self.assertFalse(creds.scan_auth_errors(["wrote 401 rows", "took 4010 ms", "all good"]))

    def test_stamped_line_older_than_window_is_ignored(self):
        old = f"[{(NOW - dt.timedelta(hours=40)).strftime('%Y-%m-%d %H:%M:%S')}] authentication_error"
        new = f"[{(NOW - dt.timedelta(hours=2)).strftime('%Y-%m-%d %H:%M:%S')}] authentication_error"
        self.assertFalse(creds.scan_auth_errors([old], NOW, 24))
        self.assertTrue(creds.scan_auth_errors([old, new], NOW, 24))

    def test_result_never_echoes_the_line(self):
        hit = creds.scan_auth_errors(["authentication_error sk-ant-oat01-SECRET"])
        self.assertNotIn("SECRET", str(hit))


class YouTube(unittest.TestCase):
    def test_missing_token_is_amber(self):
        level, text = creds.youtube_status(None, [], NOW)
        self.assertEqual(level, "amber")
        self.assertIn("not signed in", text)

    def test_invalid_grant_in_window_is_red(self):
        line = f"[{(NOW - dt.timedelta(hours=3)).strftime('%Y-%m-%d %H:%M:%S')}] RefreshError: invalid_grant: Token has been expired or revoked."
        level, text = creds.youtube_status(fake_stat(age_days=2), [line], NOW)
        self.assertEqual(level, "red")
        self.assertIn("sign-in", text)

    def test_old_invalid_grant_is_ignored(self):
        line = f"[{(NOW - dt.timedelta(hours=60)).strftime('%Y-%m-%d %H:%M:%S')}] invalid_grant"
        self.assertIsNone(creds.youtube_status(fake_stat(age_days=2), [line], NOW))

    def test_present_and_clean_is_quiet(self):
        self.assertIsNone(creds.youtube_status(fake_stat(age_days=2), ["Picking topic"], NOW))

    def test_testing_mode_stale_token_without_upload_is_amber(self):
        level, text = creds.youtube_status(fake_stat(age_days=8), ["Picking topic"], NOW)
        self.assertEqual(level, "amber")
        self.assertIn("7 days", text)

    def test_stale_token_but_recent_upload_is_quiet(self):
        self.assertIsNone(creds.youtube_status(fake_stat(age_days=8), ["LIVE: https://youtu.be/abc"], NOW))


class Check(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        j = lambda *p: os.path.join(self.tmp, *p)
        os.makedirs(j("logs"))
        self.cfg = {
            "backup": {"log": j("b.log"), "err": j("b.err"), "max_age_hours": 36},
            "oauth_token": {"path": j("tok"), "valid_days": 365, "warn_days": 30, "scan_logs": [j("cron.log"), j("logs", "*.log")]},
            "youtube": {"token": j("yt", "token.json"), "log": j("yt.log")},
            "known_issues": {"com.autorank.backup": "grant Full Disk Access to /bin/bash"},
        }
        self.j = j

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, path, text="x", age_days=0):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(text)
        ts = (NOW - dt.timedelta(days=age_days)).timestamp()
        os.utime(path, (ts, ts))

    def run_check(self):
        issues = []
        creds.check(self.cfg, NOW, issues)
        return issues

    def healthy(self):
        self.write(self.j("b.log"), ok_line(NOW - dt.timedelta(hours=3)))
        self.write(self.j("tok"), "opaque-token-text", age_days=10)
        self.write(self.j("yt", "token.json"), "{}", age_days=1)

    def test_healthy_is_quiet(self):
        self.healthy()
        self.assertEqual(self.run_check(), [])

    def test_backup_red_carries_the_known_fix(self):
        self.healthy()
        self.write(self.j("b.log"), ok_line(dt.datetime(2026, 10, 14, 21, 0)))
        self.write(self.j("b.err"), "rsync: open: Operation not permitted\n")
        issues = self.run_check()
        self.assertEqual([(i["level"], i["check"]) for i in issues], [("red", "backup")])
        self.assertIn("Full Disk Access", issues[0]["text"])
        self.assertIn("Operation not permitted", issues[0]["text"])

    def test_missing_backup_log_is_red(self):
        self.healthy()
        os.remove(self.j("b.log"))
        self.assertEqual([i["level"] for i in self.run_check()], ["red"])

    def test_token_file_is_only_stat_ed_never_opened(self):
        self.healthy()
        real_open = builtins.open
        tok = self.j("tok")

        def guarded(path, *a, **kw):
            if os.fspath(path) == tok:
                raise AssertionError("token file was opened")
            return real_open(path, *a, **kw)

        with mock.patch("builtins.open", guarded):
            self.assertEqual(self.run_check(), [])

    def test_missing_and_empty_token_are_red(self):
        self.healthy()
        os.remove(self.j("tok"))
        self.assertEqual([(i["level"], i["check"]) for i in self.run_check()], [("red", "oauth-token")])
        self.write(self.j("tok"), "", age_days=1)
        self.assertEqual([(i["level"], i["check"]) for i in self.run_check()], [("red", "oauth-token")])

    def test_recent_auth_error_in_log_is_red_and_names_the_file_only(self):
        self.healthy()
        self.write(self.j("logs", "a.log"), "step\nAPI Error: 401 authentication_error sk-SECRET\n", age_days=0)
        issues = self.run_check()
        self.assertEqual([(i["level"], i["check"]) for i in issues], [("red", "oauth-token")])
        self.assertIn("a.log", issues[0]["text"])
        self.assertNotIn("SECRET", issues[0]["text"])

    def test_auth_error_in_log_untouched_for_two_days_is_ignored(self):
        self.healthy()
        self.write(self.j("cron.log"), "authentication_error\n", age_days=2)
        self.assertEqual(self.run_check(), [])

    def test_youtube_missing_token_is_amber(self):
        self.healthy()
        os.remove(self.j("yt", "token.json"))
        issues = self.run_check()
        self.assertEqual([(i["level"], i["check"]) for i in issues], [("amber", "youtube")])

    def test_youtube_revoked_in_log_is_red(self):
        self.healthy()
        self.write(self.j("yt.log"), f"[{(NOW - dt.timedelta(hours=1)).strftime('%Y-%m-%d %H:%M:%S')}] RefreshError invalid_grant\n")
        self.assertEqual([(i["level"], i["check"]) for i in self.run_check()], [("red", "youtube")])

    def test_empty_config_is_quiet(self):
        issues = []
        creds.check({}, NOW, issues)
        self.assertEqual(issues, [])


if __name__ == "__main__":
    unittest.main()
