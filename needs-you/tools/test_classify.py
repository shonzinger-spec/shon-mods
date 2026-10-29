"""Tests for classify.py. Fixtures carry only chat-metadata fields and invented text."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classify import classify, tail_info  # noqa: E402

NOW = 1_800_000_000_000
MIN = 60_000
LIMIT = "You've hit your session limit · resets 3:10pm (America/Toronto)"


def row(**over):
    base = {
        "sessionId": "local_a",
        "title": "Some chat",
        "isArchived": False,
        "lastActivityAt": NOW - 10 * MIN,
        "lastTurnEdgeAt": NOW - 10 * MIN,
        "latestUserFrameAt": NOW - 11 * MIN,
        "lastAssistantUuid": "uuid-new",
    }
    base.update(over)
    return base


def summary(cat, uuid_for="uuid-new", needs="Pick option A or B"):
    return {
        "postTurnSummary": {"status_category": cat, "status_detail": "detail", "needs_action": needs},
        "postTurnSummaryFor": uuid_for,
    }


def assistant(*blocks):
    return json.dumps({"type": "assistant", "message": {"content": list(blocks)}})


def user_text(text):
    return json.dumps({"type": "user", "message": {"content": text}})


def tool_result(tid):
    return json.dumps({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": tid, "content": "ok"}]}})


class ClassifyTests(unittest.TestCase):
    def test_limit_error_fresh_is_stalled(self):
        r = classify(row(error=LIMIT, errorAt=NOW - 10 * MIN + 2000), set(), NOW)
        self.assertEqual((r["status"], r["kind"]), ("stalled", "limit"))

    def test_limit_error_older_than_activity_is_not_stalled(self):
        r = classify(row(error=LIMIT, errorAt=NOW - 10 * MIN - 60_000), set(), NOW)
        self.assertEqual(r["status"], "done")

    def test_other_fresh_error_is_stalled_error(self):
        r = classify(row(error="Something broke", errorAt=NOW - 10 * MIN), set(), NOW)
        self.assertEqual((r["status"], r["kind"]), ("stalled", "error"))

    def test_unanswered_user_message_is_stalled(self):
        r = classify(row(latestUserFrameAt=NOW - 5 * MIN, lastTurnEdgeAt=NOW - 20 * MIN), set(), NOW)
        self.assertEqual((r["status"], r["kind"]), ("stalled", "unanswered"))

    def test_unanswered_but_running_is_working(self):
        r = classify(row(latestUserFrameAt=NOW - 5 * MIN, lastTurnEdgeAt=NOW - 20 * MIN), {"local_a"}, NOW)
        self.assertEqual(r["status"], "working")

    def test_missing_keys_tolerated(self):
        r = classify({"sessionId": "local_z"}, set(), NOW)
        self.assertEqual(r["status"], "done")

    def test_blocked_summary_for_latest_uuid_is_waiting(self):
        r = classify(row(**summary("blocked")), set(), NOW)
        self.assertEqual(r["status"], "waiting")
        self.assertEqual(r["question"], "Pick option A or B")
        self.assertEqual(r["question_source"], "summary")

    def test_blocked_summary_for_old_uuid_is_done(self):
        r = classify(row(**summary("blocked", uuid_for="uuid-old")), set(), NOW)
        self.assertEqual(r["status"], "done")

    def test_completed_summary_is_done(self):
        r = classify(row(**summary("completed")), set(), NOW)
        self.assertEqual(r["status"], "done")

    def test_interrupted_awaiting_person_is_waiting(self):
        r = classify(row(interruptedAwaitingPerson=True), set(), NOW)
        self.assertEqual(r["status"], "waiting")

    def test_transcript_ask_beats_summary(self):
        tail = {"wrap_up_ask": "Merge it?", "pending_ask": None, "last_question": None}
        r = classify(row(**summary("blocked")), set(), NOW, tail)
        self.assertEqual((r["question"], r["question_source"]), ("Merge it?", "wrap_up"))

    def test_pending_ask_then_text_question_order(self):
        tail = {"wrap_up_ask": None, "pending_ask": "Which file?", "last_question": "Ok?"}
        r = classify(row(**summary("blocked")), set(), NOW, tail)
        self.assertEqual((r["question"], r["question_source"]), ("Which file?", "ask_user"))
        tail = {"wrap_up_ask": None, "pending_ask": None, "last_question": "Ok?"}
        r = classify(row(**summary("blocked")), set(), NOW, tail)
        self.assertEqual((r["question"], r["question_source"]), ("Ok?", "text"))

    def test_archived_and_routine_skipped(self):
        self.assertEqual(classify(row(isArchived=True), set(), NOW)["status"], "skip")
        self.assertEqual(classify(row(scheduledTaskId="task_1"), set(), NOW)["status"], "skip")

    def test_running_marked_working(self):
        r = classify(row(**summary("blocked")), {"local_a"}, NOW)
        self.assertEqual(r["status"], "working")

    def test_plain_chat_is_done(self):
        r = classify(row(), set(), NOW)
        self.assertEqual((r["status"], r["question"]), ("done", None))


class TailInfoTests(unittest.TestCase):
    def test_wrap_up_ask_extracted_exactly(self):
        ask = "Put this chat away?  Also keep \"quotes\" and é intact"
        lines = [
            user_text("do the thing"),
            assistant({"type": "text", "text": "working"}, {"type": "tool_use", "id": "t1", "name": "Bash", "input": {}}),
            tool_result("t1"),
            assistant({"type": "tool_use", "id": "t2", "name": "mcp__ccd_turn__wrap_up", "input": {"recap": "r", "ask": ask}}),
        ]
        self.assertEqual(tail_info(lines)["wrap_up_ask"], ask)

    def test_wrap_up_before_last_user_message_is_ignored(self):
        lines = [
            assistant({"type": "tool_use", "id": "t1", "name": "mcp__ccd_turn__wrap_up", "input": {"ask": "old?"}}),
            user_text("next task"),
            assistant({"type": "text", "text": "done."}),
        ]
        info = tail_info(lines)
        self.assertIsNone(info["wrap_up_ask"])

    def test_pending_ask_user_question(self):
        lines = [
            user_text("go"),
            assistant({"type": "tool_use", "id": "q1", "name": "AskUserQuestion", "input": {"questions": [{"question": "Which db?", "options": []}]}}),
        ]
        self.assertEqual(tail_info(lines)["pending_ask"], "Which db?")

    def test_answered_ask_user_question_not_pending(self):
        lines = [
            user_text("go"),
            assistant({"type": "tool_use", "id": "q1", "name": "AskUserQuestion", "input": {"questions": [{"question": "Which db?"}]}}),
            tool_result("q1"),
            assistant({"type": "text", "text": "thanks"}),
        ]
        self.assertIsNone(tail_info(lines)["pending_ask"])

    def test_last_question_paragraph(self):
        text = "Here is the plan.\n\nShould I go with the first option?\n\nI will wait."
        lines = [user_text("go"), assistant({"type": "text", "text": text})]
        self.assertEqual(tail_info(lines)["last_question"], "Should I go with the first option?")

    def test_garbage_and_empty_lines_tolerated(self):
        info = tail_info(["not json", "", "{}", user_text("hi")])
        self.assertEqual(info, {"wrap_up_ask": None, "pending_ask": None, "last_question": None})


if __name__ == "__main__":
    unittest.main()
