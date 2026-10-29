"""scan_chats against a temp tree of invented chat files (no real chat data)."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_chats import scan  # noqa: E402

NOW = 1_800_000_000_000


class ScanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.sessions = os.path.join(self.tmp.name, "s", "acct", "org")
        self.projects = os.path.join(self.tmp.name, "p", "proj")
        os.makedirs(self.sessions)
        os.makedirs(self.projects)
        self.sessions_root = os.path.join(self.tmp.name, "s")
        self.projects_root = os.path.join(self.tmp.name, "p")

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, sid, **kw):
        d = {"sessionId": sid, "title": "T " + sid, "lastActivityAt": NOW - 1000, "lastTurnEdgeAt": NOW - 1000}
        d.update(kw)
        with open(os.path.join(self.sessions, sid + ".json"), "w") as f:
            json.dump(d, f)
        # glob needs local_*.json
        os.rename(os.path.join(self.sessions, sid + ".json"), os.path.join(self.sessions, "local_" + sid + ".json"))

    def test_waiting_gets_exact_question_from_transcript(self):
        self.put("w", cliSessionId="cli1", lastAssistantUuid="u1", postTurnSummaryFor="u1",
                 postTurnSummary={"status_category": "blocked", "needs_action": "model summary"})
        lines = [
            json.dumps({"type": "user", "message": {"content": "hi"}}),
            json.dumps({"type": "assistant", "message": {"content": [
                {"type": "tool_use", "id": "x", "name": "mcp__ccd_turn__wrap_up", "input": {"ask": "Exact ask?"}}]}}),
        ]
        with open(os.path.join(self.projects, "cli1.jsonl"), "w") as f:
            f.write("\n".join(lines) + "\n")
        rows = scan(self.sessions_root, self.projects_root, set(), NOW)
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["status"], rows[0]["question"], rows[0]["question_source"]), ("waiting", "Exact ask?", "wrap_up"))

    def test_skips_archived_and_routines_and_survives_junk(self):
        self.put("a", isArchived=True)
        self.put("r", scheduledTaskId="t")
        self.put("ok")
        with open(os.path.join(self.sessions, "local_bad.json"), "w") as f:
            f.write("{not json")
        rows = scan(self.sessions_root, self.projects_root, {"ok"}, NOW)
        self.assertEqual([(r["sessionId"], r["status"]) for r in rows], [("ok", "working")])

    def test_limit_stall_keeps_error_text(self):
        self.put("l", error="You've hit your session limit · resets 3:10pm (America/Toronto)", errorAt=NOW - 1000)
        rows = scan(self.sessions_root, self.projects_root, set(), NOW)
        self.assertEqual((rows[0]["status"], rows[0]["kind"]), ("stalled", "limit"))
        self.assertIn("resets 3:10pm", rows[0]["error"])

    def test_limit_row_carries_reset_time_and_error_at(self):
        self.put("l", error="You've hit your session limit \u00b7 resets 3:10pm (America/Toronto)", errorAt=NOW - 1000)
        row = scan(self.sessions_root, self.projects_root, set(), NOW)[0]
        self.assertEqual(row["error_at_ms"], NOW - 1000)
        # NOW is 2027-01-15 03:00 EST; 3:10pm EST the same day is 20:10Z
        self.assertEqual(row["limit"], {"kind": "session", "reset_at_ms": 1800043800000})

    def test_rate_limit_error_has_kind_but_no_reset(self):
        self.put("x", error="You've exceed your account's rate limit.", errorAt=NOW - 1000)
        row = scan(self.sessions_root, self.projects_root, set(), NOW)[0]
        self.assertEqual((row["status"], row["kind"]), ("stalled", "error"))
        self.assertEqual(row["limit"], {"kind": "rate", "reset_at_ms": None})

    def test_plain_error_and_waiting_rows_have_no_limit(self):
        self.put("e", error="boom", errorAt=NOW - 1000)
        row = scan(self.sessions_root, self.projects_root, set(), NOW)[0]
        self.assertIsNone(row["limit"])

    def test_routine_chat_with_limit_error_is_left_out(self):
        self.put("r", scheduledTaskId="t", error="You've hit your session limit \u00b7 resets 3:10pm (America/Toronto)", errorAt=NOW - 1000)
        self.assertEqual(scan(self.sessions_root, self.projects_root, set(), NOW), [])


if __name__ == "__main__":
    unittest.main()
