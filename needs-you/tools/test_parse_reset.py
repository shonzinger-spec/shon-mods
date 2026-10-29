import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_reset import parse_reset  # noqa: E402

# Epoch values below were computed independently of the implementation
# (datetime + zoneinfo America/Toronto, then * 1000).
SESSION = "You've hit your session limit · resets 3:10pm (America/Toronto)"
WEEKLY_DATE = "You've hit your weekly limit · resets Oct 27 at 6am (America/Toronto)"
WEEKLY_TIME = "You've hit your weekly limit · resets 6am (America/Toronto)"


class ParseResetTests(unittest.TestCase):
    def test_session_time_only_same_day(self):
        # error 2026-10-27 12:00 EDT -> reset 2026-10-27 15:10 EDT
        self.assertEqual(parse_reset(SESSION, 1793116800000), {"kind": "session", "reset_at_ms": 1793128200000})

    def test_session_time_only_rolls_next_day(self):
        # error 2026-10-27 16:00 EDT is past 3:10pm -> next day 15:10 EDT
        self.assertEqual(parse_reset(SESSION, 1793131200000), {"kind": "session", "reset_at_ms": 1793214600000})

    def test_weekly_with_date(self):
        # error 2026-10-22 -> Oct 27 06:00 EDT of the same year
        self.assertEqual(parse_reset(WEEKLY_DATE, 1792677600000), {"kind": "weekly", "reset_at_ms": 1793095200000})

    def test_weekly_with_date_already_past_rolls_next_year(self):
        # error 2026-11-02 and "Oct 27" -> Oct 27 2027 06:00 EDT
        self.assertEqual(parse_reset(WEEKLY_DATE, 1793631600000), {"kind": "weekly", "reset_at_ms": 1824631200000})

    def test_weekly_time_only(self):
        # error 2026-10-27 12:00 EDT, 6am already passed -> 2026-10-28 06:00 EDT
        self.assertEqual(parse_reset(WEEKLY_TIME, 1793116800000), {"kind": "weekly", "reset_at_ms": 1793181600000})

    def test_tz_toronto_dst_boundary(self):
        # error 2026-10-31 22:00 EDT; DST ends 2026-11-01 02:00, so "6am" next day is EST
        # (11:00Z), not +24h (10:00Z).
        self.assertEqual(parse_reset(WEEKLY_TIME, 1793498400000), {"kind": "weekly", "reset_at_ms": 1793530800000})

    def test_tz_toronto_spring_forward(self):
        # error 2027-03-13 22:00 EST; DST starts 2027-03-14 02:00, so 6am next day is EDT (10:00Z).
        self.assertEqual(parse_reset(WEEKLY_TIME, 1804993200000), {"kind": "weekly", "reset_at_ms": 1805018400000})

    def test_garbage_returns_none(self):
        for text in ("", "something unrelated", "resets soon", None, 42):
            self.assertIsNone(parse_reset(text, 1793116800000), text)

    def test_rate_limit_text_no_reset_time(self):
        text = "You've exceed your account's rate limit. Please try again later."
        self.assertEqual(parse_reset(text, 1793116800000), {"kind": "rate", "reset_at_ms": None})

    def test_limit_without_parsable_reset_keeps_kind(self):
        self.assertEqual(parse_reset("You've hit your session limit", 1793116800000), {"kind": "session", "reset_at_ms": None})
        bad_tz = "You've hit your session limit · resets 3:10pm (Nowhere/Land)"
        self.assertEqual(parse_reset(bad_tz, 1793116800000), {"kind": "session", "reset_at_ms": None})


if __name__ == "__main__":
    unittest.main()
