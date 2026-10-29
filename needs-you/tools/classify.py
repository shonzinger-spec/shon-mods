"""Pure classification of one desktop chat. Stdlib only, no I/O."""
import json
import re

LIMIT_RE = re.compile(r"hit your (session|weekly|.*) limit", re.I)


def tail_info(lines):
    """Read transcript JSONL lines (strings, oldest first) and return
    {'wrap_up_ask': str|None, 'pending_ask': str|None, 'last_question': str|None}
    for the final assistant turn only (rows after the last real user message;
    a user row made only of tool_result blocks is not a real message).
    wrap_up_ask: the 'ask' input of the last tool_use whose name ends with 'wrap_up'.
    pending_ask: question text of the last AskUserQuestion tool_use that has no later tool_result.
    last_question: last paragraph (blank-line separated) ending in '?' of the last assistant text.
    Tolerates unparseable lines and missing keys."""
    rows = []
    for line in lines:
        if not isinstance(line, str) or not line.strip():
            continue
        try:
            row = json.loads(line)
        except (ValueError, TypeError):
            continue
        if isinstance(row, dict):
            rows.append(row)

    def blocks_of(row):
        msg = row.get("message")
        if not isinstance(msg, dict):
            return None
        content = msg.get("content")
        return content if isinstance(content, list) else None

    def is_real_user(row):
        if row.get("type") != "user":
            return False
        msg = row.get("message")
        if not isinstance(msg, dict):
            return False
        content = msg.get("content")
        if isinstance(content, str):
            return True
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") != "tool_result":
                    return True
        return False

    start = 0
    for i, row in enumerate(rows):
        if is_real_user(row):
            start = i + 1
    turn = rows[start:]

    wrap_up_ask = None
    pending_ask = None
    last_question = None

    tool_uses = []
    results = []
    for i, row in enumerate(turn):
        blocks = blocks_of(row)
        if not blocks:
            continue
        for block in blocks:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                tool_uses.append((i, block))
            elif block.get("type") == "tool_result":
                tid = block.get("tool_use_id")
                if isinstance(tid, str):
                    results.append((i, tid))

    for i, block in tool_uses:
        name = block.get("name")
        inp = block.get("input")
        if isinstance(name, str) and name.endswith("wrap_up") and isinstance(inp, dict):
            ask = inp.get("ask")
            if isinstance(ask, str) and ask:
                wrap_up_ask = ask

    for i, block in tool_uses:
        if block.get("name") != "AskUserQuestion":
            continue
        tid = block.get("id")
        if not isinstance(tid, str) or not tid:
            continue
        answered = any(ridx > i and rtid == tid for ridx, rtid in results)
        if answered:
            continue
        inp = block.get("input")
        if not isinstance(inp, dict):
            continue
        questions = inp.get("questions")
        if not isinstance(questions, list) or not questions:
            continue
        first = questions[0]
        if not isinstance(first, dict):
            continue
        text = first.get("question")
        if isinstance(text, str) and text:
            pending_ask = text

    for row in reversed(turn):
        if row.get("type") != "assistant":
            continue
        blocks = blocks_of(row)
        if not blocks:
            continue
        texts = [
            b.get("text")
            for b in blocks
            if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str)
        ]
        if not texts:
            continue
        joined = "\n\n".join(texts)
        paragraphs = [p.strip() for p in re.split(r"\n[ \t]*\n", joined)]
        for para in reversed(paragraphs):
            if para and para.rstrip(" *_").endswith("?"):
                last_question = para
                break
        break

    return {
        "wrap_up_ask": wrap_up_ask,
        "pending_ask": pending_ask,
        "last_question": last_question,
    }


def classify(row, running_ids, now_ms, transcript_tail=None):
    """Classify one chat row (the app's per-chat json fields) into
    {'status': 'skip'|'working'|'stalled'|'waiting'|'done',
     'kind': 'limit'|'error'|'unanswered'|None, 'question': str|None,
     'question_source': 'wrap_up'|'ask_user'|'text'|'summary'|None}.
    See test_classify.py for the exact rules."""
    def as_int(value):
        if isinstance(value, bool) or not isinstance(value, int):
            return None
        return value

    def as_text(value):
        if isinstance(value, str) and value:
            return value
        return None

    def result(status, kind=None, question=None, question_source=None):
        return {
            "status": status,
            "kind": kind,
            "question": question,
            "question_source": question_source,
        }

    if row.get("isArchived") or row.get("scheduledTaskId"):
        return result("skip")

    session_id = row.get("sessionId")
    if session_id in running_ids:
        return result("working")

    error = row.get("error")
    error_at = as_int(row.get("errorAt"))
    last_activity = as_int(row.get("lastActivityAt"))
    fresh = error_at is not None and last_activity is not None and error_at >= last_activity - 10000

    if isinstance(error, str) and error and LIMIT_RE.search(error) and fresh:
        return result("stalled", "limit")

    if isinstance(error, str) and error and not LIMIT_RE.search(error) and fresh:
        return result("stalled", "error")

    latest_user = as_int(row.get("latestUserFrameAt"))
    last_edge = as_int(row.get("lastTurnEdgeAt"))
    if latest_user is not None and last_edge is not None and latest_user > last_edge + 60000:
        return result("stalled", "unanswered")

    summary = row.get("postTurnSummary")
    summary_uuid = row.get("postTurnSummaryFor")
    last_assistant = row.get("lastAssistantUuid")
    blocked = (
        as_text(summary_uuid) is not None
        and as_text(last_assistant) is not None
        and summary_uuid == last_assistant
        and isinstance(summary, dict)
        and summary.get("status_category") == "blocked"
        and as_text(summary.get("needs_action")) is not None
    )

    if blocked or row.get("interruptedAwaitingPerson"):
        question = None
        source = None
        if isinstance(transcript_tail, dict):
            for key, label in (
                ("wrap_up_ask", "wrap_up"),
                ("pending_ask", "ask_user"),
                ("last_question", "text"),
            ):
                text = as_text(transcript_tail.get(key))
                if text is not None:
                    question, source = text, label
                    break
        if question is None and isinstance(summary, dict):
            text = as_text(summary.get("needs_action"))
            if text is not None:
                question, source = text, "summary"
        return result("waiting", None, question, source)

    return result("done")
