"""Tests for watchdog.py. Run: python3 -m unittest discover -s <this folder>"""
import datetime as dt, json, os, plistlib, shutil, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import watchdog  # noqa: E402

FORWARD = os.path.join(HERE, "..", "..", "forward-pane", "scripts", "forward_status.py")
NOW = dt.datetime(2026, 10, 29, 12, 0)  # a Thursday, local naive


def utc_z(local_naive):
    return local_naive.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def epoch_ms(local_naive):
    return int(local_naive.timestamp() * 1000)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.agents = os.path.join(self.tmp, "agents")
        os.makedirs(self.agents)
        self.cfg = {
            "scheduled_tasks_glob": os.path.join(self.tmp, "sessions", "*", "*", "scheduled-tasks.json"),
            "launch_agents_dir": self.agents,
            "forward_pane": FORWARD,
            "watchdog_regex": r"^com\.(secondbrain|autorank)",
            "label_regex": "propfarm",
        }

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_check(self, lc=None):
        issues = []
        watchdog.check(self.cfg, NOW, issues, launchctl_fn=lambda: dict(lc or {}))
        return issues


class ScheduledTasks(Base):
    def write_tasks(self, tasks):
        d = os.path.join(self.tmp, "sessions", "a", "b")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "scheduled-tasks.json"), "w") as f:
            json.dump({"scheduledTasks": tasks, "recordedSkips": []}, f)

    def cron(self, **kw):
        t = {"id": "t1", "displayName": "Daily refresh", "cronExpression": "30 7 * * *", "enabled": True,
             "createdAt": epoch_ms(dt.datetime(2026, 10, 1, 9, 0))}
        t.update(kw)
        return t

    def test_ran_after_due_is_quiet(self):
        self.write_tasks([self.cron(lastRunAt=utc_z(dt.datetime(2026, 10, 29, 7, 34)))])
        self.assertEqual(self.run_check(), [])

    def test_run_within_two_minutes_before_due_is_quiet(self):
        self.write_tasks([self.cron(lastRunAt=utc_z(dt.datetime(2026, 10, 29, 7, 29)))])
        self.assertEqual(self.run_check(), [])

    def test_last_run_older_than_due_is_red(self):
        self.write_tasks([self.cron(lastRunAt=utc_z(dt.datetime(2026, 10, 28, 7, 34)))])
        issues = self.run_check()
        self.assertEqual([i["level"] for i in issues], ["red"])
        self.assertEqual(issues[0]["text"], "scheduled task Daily refresh: missed run due Thu 07:30")

    def test_not_yet_past_grace_uses_previous_fire(self):
        self.write_tasks([self.cron(lastRunAt=utc_z(dt.datetime(2026, 10, 28, 7, 34)))])
        issues = []
        watchdog.check(self.cfg, dt.datetime(2026, 10, 29, 7, 40), issues, launchctl_fn=dict)
        self.assertEqual(issues, [])  # due 07:30 is inside the 15-minute grace; Wed's run happened

    def test_disabled_is_quiet(self):
        self.write_tasks([self.cron(enabled=False)])
        self.assertEqual(self.run_check(), [])

    def test_never_run_is_red_but_not_when_created_after_due(self):
        self.write_tasks([self.cron()])
        self.assertEqual([i["level"] for i in self.run_check()], ["red"])
        self.write_tasks([self.cron(createdAt=epoch_ms(dt.datetime(2026, 10, 29, 9, 0)))])
        self.assertEqual(self.run_check(), [])

    def test_one_time_past_never_ran_is_amber(self):
        t = {"id": "o", "displayName": "Cost check", "fireAt": epoch_ms(dt.datetime(2026, 10, 29, 9, 15)), "enabled": True}
        self.write_tasks([t])
        issues = self.run_check()
        self.assertEqual([i["level"] for i in issues], ["amber"])
        self.assertEqual(issues[0]["text"], "one-time task Cost check never ran (due Thu 09:15)")

    def test_one_time_future_recent_or_ran_is_quiet(self):
        base = {"id": "o", "displayName": "Cost check", "enabled": True}
        for extra in ({"fireAt": epoch_ms(dt.datetime(2026, 10, 30, 9, 0))},
                      {"fireAt": epoch_ms(dt.datetime(2026, 10, 29, 11, 50))},
                      {"fireAt": epoch_ms(dt.datetime(2026, 10, 29, 9, 0)), "lastRunAt": utc_z(dt.datetime(2026, 10, 29, 9, 1))}):
            self.write_tasks([{**base, **extra}])
            self.assertEqual(self.run_check(), [], extra)

    def test_missing_or_corrupt_json_is_no_issue(self):
        self.assertEqual(self.run_check(), [])
        d = os.path.join(self.tmp, "sessions", "a", "b")
        os.makedirs(d)
        with open(os.path.join(d, "scheduled-tasks.json"), "w") as f:
            f.write("{not json")
        self.assertEqual(self.run_check(), [])

    def test_bad_cron_expression_is_quiet(self):
        self.write_tasks([self.cron(cronExpression="garbage")])
        self.assertEqual(self.run_check(), [])


class Launchd(Base):
    def plist(self, label, **kw):
        with open(os.path.join(self.agents, label + ".plist"), "wb") as f:
            plistlib.dump({"Label": label, **kw}, f)

    def touch(self, name, when, text=""):
        p = os.path.join(self.tmp, name)
        with open(p, "w") as f:
            f.write(text)
        ts = when.timestamp()
        os.utime(p, (ts, ts))
        return p

    def test_nonzero_exit_is_red_with_error_line(self):
        err = self.touch("a.err", dt.datetime(2026, 10, 29, 10, 0), "starting\nTraceback (most recent call last)\n")
        self.plist("com.secondbrain.jobs", StartInterval=600, StandardErrorPath=err)
        issues = self.run_check({"com.secondbrain.jobs": (None, 1)})
        self.assertEqual([i["level"] for i in issues], ["red"])
        self.assertIn("launchd secondbrain.jobs: last exit 1", issues[0]["text"])
        self.assertIn("Traceback", issues[0]["text"])

    def test_exit_zero_fresh_calendar_job_is_quiet(self):
        log = self.touch("a.log", dt.datetime(2026, 10, 29, 9, 1))
        self.plist("com.secondbrain.brief", StartCalendarInterval={"Hour": 9, "Minute": 0}, StandardOutPath=log)
        self.assertEqual(self.run_check({"com.secondbrain.brief": (None, 0)}), [])

    def test_running_job_with_old_exit_is_quiet(self):
        self.plist("com.secondbrain.telegram", KeepAlive=True)
        self.assertEqual(self.run_check({"com.secondbrain.telegram": (4242, 3)}), [])

    def test_stopped_daemon_is_red_and_unloaded_is_red(self):
        self.plist("com.secondbrain.telegram", KeepAlive=True)
        self.assertEqual([i["level"] for i in self.run_check({"com.secondbrain.telegram": (None, 0)})], ["red"])
        self.assertIn("not loaded", self.run_check({})[0]["text"])

    def test_stale_success_marker_is_red_even_when_err_is_fresh(self):
        err = self.touch("b.err", dt.datetime(2026, 10, 29, 9, 0), "boom\n")
        marker = self.touch("b.log", dt.datetime(2026, 10, 26, 9, 0))
        self.plist("com.autorank.backup", StartCalendarInterval={"Hour": 9, "Minute": 0}, StandardErrorPath=err)
        self.cfg["success_markers"] = {"com.autorank.backup": {"file": marker, "max_age_hours": 36}}
        issues = self.run_check({"com.autorank.backup": (None, 0)})
        self.assertEqual([i["level"] for i in issues], ["red"])
        self.assertIn("launchd autorank.backup:", issues[0]["text"])
        self.assertIn("missed run due Thu 09:00", issues[0]["text"])

    def test_fresh_success_marker_is_quiet(self):
        marker = self.touch("b.log", dt.datetime(2026, 10, 29, 9, 1))
        self.plist("com.autorank.backup", StartCalendarInterval={"Hour": 9, "Minute": 0})
        self.cfg["success_markers"] = {"com.autorank.backup": {"file": marker, "max_age_hours": 36}}
        self.assertEqual(self.run_check({"com.autorank.backup": (None, 0)}), [])

    def test_marker_older_than_max_age_is_red_without_calendar(self):
        marker = self.touch("c.log", dt.datetime(2026, 10, 26, 9, 0))
        self.plist("com.autorank.backup", StartInterval=3600)
        self.cfg["success_markers"] = {"com.autorank.backup": {"file": marker, "max_age_hours": 36}}
        issues = self.run_check({"com.autorank.backup": (None, 0)})
        self.assertEqual([i["level"] for i in issues], ["red"])
        self.assertIn("36h", issues[0]["text"])

    def test_known_issue_is_one_amber_row(self):
        err = self.touch("t.err", dt.datetime(2026, 10, 29, 10, 0), "Traceback\n")
        self.plist("com.secondbrain.telegram", KeepAlive=True, StandardErrorPath=err)
        self.cfg["known_issues"] = {"com.secondbrain.telegram": "awaiting Telegram token"}
        issues = self.run_check({"com.secondbrain.telegram": (None, 3)})
        self.assertEqual(issues, [{"level": "amber", "check": "watchdog", "text": "launchd secondbrain.telegram: awaiting Telegram token"}])

    def test_known_issue_on_healthy_job_is_quiet(self):
        self.plist("com.secondbrain.telegram", KeepAlive=True)
        self.cfg["known_issues"] = {"com.secondbrain.telegram": "awaiting Telegram token"}
        self.assertEqual(self.run_check({"com.secondbrain.telegram": (4242, 0)}), [])

    def test_label_matched_by_label_regex_is_not_duplicated(self):
        self.plist("com.propfarm.ticks", StartInterval=600)
        self.cfg["watchdog_regex"] = r"^com\."
        self.assertEqual(self.run_check({"com.propfarm.ticks": (None, 1)}), [])

    def test_skip_labels_are_left_to_another_check(self):
        err = self.touch("a.err", dt.datetime(2026, 10, 29, 10, 0), "boom\n")
        self.plist("com.secondbrain.jobs", StartInterval=600, StandardErrorPath=err)
        self.assertEqual(len(self.run_check({"com.secondbrain.jobs": (None, 1)})), 1)
        self.cfg["skip_labels"] = ["com.secondbrain.jobs"]
        self.assertEqual(self.run_check({"com.secondbrain.jobs": (None, 1)}), [])

    def test_label_outside_watchdog_regex_is_ignored(self):
        self.plist("com.other.thing", StartInterval=600)
        self.assertEqual(self.run_check({"com.other.thing": (None, 1)}), [])

    def test_missing_forward_pane_skips_launchd_part(self):
        self.cfg["forward_pane"] = os.path.join(self.tmp, "nope.py")
        self.plist("com.secondbrain.jobs", StartInterval=600)
        self.assertEqual(self.run_check({"com.secondbrain.jobs": (None, 1)}), [])


if __name__ == "__main__":
    unittest.main()
