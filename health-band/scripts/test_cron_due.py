"""Tests for cron_due.last_fire. Run: python3 -m unittest discover -s <this folder>"""
import datetime as dt, os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cron_due  # noqa: E402

D = dt.datetime


class LastFire(unittest.TestCase):
    def test_daily_after_time_today(self):
        self.assertEqual(cron_due.last_fire("30 7 * * *", D(2026, 10, 28, 8, 0)), D(2026, 10, 28, 7, 30))

    def test_daily_before_time_yesterday(self):
        self.assertEqual(cron_due.last_fire("30 7 * * *", D(2026, 10, 28, 7, 0)), D(2026, 10, 27, 7, 30))

    def test_exactly_on_the_minute_counts(self):
        self.assertEqual(cron_due.last_fire("30 7 * * *", D(2026, 10, 28, 7, 30)), D(2026, 10, 28, 7, 30))

    def test_seconds_are_dropped(self):
        self.assertEqual(cron_due.last_fire("30 7 * * *", D(2026, 10, 28, 7, 30, 20)), D(2026, 10, 28, 7, 30))

    def test_weekday_only_on_saturday_returns_friday(self):
        # 2026-10-31 is a Saturday
        self.assertEqual(cron_due.last_fire("0 9 * * 1-5", D(2026, 10, 31, 12, 0)), D(2026, 10, 30, 9, 0))

    def test_step_minutes(self):
        self.assertEqual(cron_due.last_fire("*/15 * * * *", D(2026, 10, 28, 10, 7)), D(2026, 10, 28, 10, 0))
        self.assertEqual(cron_due.last_fire("*/15 * * * *", D(2026, 10, 28, 10, 15)), D(2026, 10, 28, 10, 15))
        self.assertEqual(cron_due.last_fire("*/15 * * * *", D(2026, 10, 28, 10, 44)), D(2026, 10, 28, 10, 30))

    def test_range_hours(self):
        self.assertEqual(cron_due.last_fire("0 9-11 * * *", D(2026, 10, 28, 10, 30)), D(2026, 10, 28, 10, 0))
        self.assertEqual(cron_due.last_fire("0 9-11 * * *", D(2026, 10, 28, 15, 0)), D(2026, 10, 28, 11, 0))
        self.assertEqual(cron_due.last_fire("0 9-11 * * *", D(2026, 10, 28, 8, 0)), D(2026, 10, 27, 11, 0))

    def test_range_with_step(self):
        # 9, 13, 17
        self.assertEqual(cron_due.last_fire("0 9-17/4 * * *", D(2026, 10, 28, 16, 0)), D(2026, 10, 28, 13, 0))

    def test_list(self):
        self.assertEqual(cron_due.last_fire("0,30 8 * * *", D(2026, 10, 28, 8, 45)), D(2026, 10, 28, 8, 30))
        self.assertEqual(cron_due.last_fire("0,30 8 * * *", D(2026, 10, 28, 8, 20)), D(2026, 10, 28, 8, 0))

    def test_sunday_as_zero_and_seven(self):
        # 2026-10-28 is a Wednesday; the Sunday before is 10-25
        self.assertEqual(cron_due.last_fire("0 6 * * 0", D(2026, 10, 28, 12, 0)), D(2026, 10, 25, 6, 0))
        self.assertEqual(cron_due.last_fire("0 6 * * 7", D(2026, 10, 28, 12, 0)), D(2026, 10, 25, 6, 0))

    def test_day_of_month_and_weekday_are_or(self):
        # the 15th OR any Friday. 2026-10-15 is a Thursday, 2026-10-23 a Friday.
        self.assertEqual(cron_due.last_fire("0 6 15 * 5", D(2026, 10, 29, 12, 0)), D(2026, 10, 23, 6, 0))
        self.assertEqual(cron_due.last_fire("0 6 15 * 5", D(2026, 10, 15, 12, 0)), D(2026, 10, 15, 6, 0))

    def test_restricted_day_of_month_only(self):
        self.assertEqual(cron_due.last_fire("0 6 1 * *", D(2026, 11, 3, 12, 0)), D(2026, 11, 1, 6, 0))

    def test_month_field(self):
        self.assertIsNone(cron_due.last_fire("0 0 1 1 *", D(2026, 10, 28, 12, 0)))  # nothing within 8 days

    def test_garbage_returns_none(self):
        for bad in ("garbage", "", "* * *", "61 * * * *", "* 24 * * *", "* * * * * *", "*/0 * * * *", "5-1 * * * *", "a-b * * * *"):
            self.assertIsNone(cron_due.last_fire(bad, D(2026, 10, 28, 12, 0)), bad)

    def test_search_window_is_eight_days(self):
        self.assertEqual(cron_due.last_fire("0 0 15 10 *", D(2026, 10, 22, 12, 0)), D(2026, 10, 15, 0, 0))
        self.assertIsNone(cron_due.last_fire("0 0 15 10 *", D(2026, 10, 28, 12, 0)))


if __name__ == "__main__":
    unittest.main()
