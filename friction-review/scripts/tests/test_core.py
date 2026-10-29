import json
import os
from collections import Counter

import pytest

from friction.core import (
    Ctx, Event, Hit, Row, Summary, ToolResult, ToolUse, Unused,
    aggregate, classify, example_text, find_unused, parse_line, redact, render_markdown,
)

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def fixture_lines(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        return f.read().split("\n")


def line(**kw):
    return json.dumps(kw)


def ev(kind, **kw):
    return Event(kind=kind, session=kw.pop("session", "s1"), ts=kw.pop("ts", "2026-10-28T10:00:00.000Z"), **kw)


def patterns(hits):
    return [h.pattern for h in hits]


# ---- parse_line -------------------------------------------------------------

def test_parse_line_skips_garbage():
    lines = fixture_lines("garbage.jsonl")
    results = [parse_line(l) for l in lines]  # must not raise
    assert results[0] is None  # blank
    assert results[1] is None  # not json
    assert results[2] is None  # list
    assert results[3] is None  # string
    assert results[4] is None  # number
    assert results[5] is None  # unknown type
    for r in results[6:]:
        assert r is None or isinstance(r, Event)
    assert parse_line('{"type": "user"}').kind == "user"
    assert parse_line('{"type": "user", "message": 5}').text == ""
    assert parse_line('{"type": "assistant", "message": {"content": 7}}').tool_uses == ()


def test_parse_line_user_string_and_list():
    e = parse_line(line(type="user", sessionId="s9", timestamp="2026-10-28T10:00:00.000Z",
                        message={"role": "user", "content": "hello there"}))
    assert (e.kind, e.text, e.session, e.ts) == ("user", "hello there", "s9", "2026-10-28T10:00:00.000Z")
    assert e.tool_results == ()

    e = parse_line(line(type="user", message={"content": [
        {"type": "text", "text": "one"},
        {"type": "text", "text": "two"},
        {"type": "tool_result", "tool_use_id": "t1", "is_error": True, "content": "boom"},
        {"type": "tool_result", "tool_use_id": "t2", "content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]},
    ]}), default_session="fallback")
    assert e.text == "one\ntwo"
    assert e.session == "fallback"
    assert e.tool_results == (ToolResult("t1", True, "boom"), ToolResult("t2", False, "a\nb"))


def test_parse_line_assistant_system_attachment():
    e = parse_line(line(type="assistant", isApiErrorMessage=True, message={"content": [
        {"type": "text", "text": "API Error: x"},
        {"type": "tool_use", "id": "u1", "name": "Bash", "input": {"command": "ls"}},
        {"type": "tool_use", "id": "u2", "name": "Odd", "input": "nope"},
    ]}))
    assert e.is_api_error is True and e.text == "API Error: x"
    assert e.tool_uses == (ToolUse("u1", "Bash", {"command": "ls"}), ToolUse("u2", "Odd", {}))
    e = parse_line(line(type="system", subtype="api_error", error={"formatted": "Connection error"}))
    assert (e.kind, e.subtype, e.text) == ("system", "api_error", "Connection error")
    e = parse_line(line(type="attachment", attachment={"type": "hook_non_blocking_error", "stderr": "bad", "command": "c"}))
    assert (e.kind, e.subtype, e.detail) == ("attachment", "hook_non_blocking_error", "bad")
    e = parse_line(line(type="attachment", attachment={"type": "hook_stopped_continuation", "hookName": "H"}))
    assert e.detail == "H"


# ---- classify ---------------------------------------------------------------

def user_result(text, tool_use_id="x1", is_error=True):
    return ev("user", tool_results=(ToolResult(tool_use_id, is_error, text),))


def test_classify_no_such_tool():
    hits = classify(user_result("<tool_use_error>No such tool available: Write</tool_use_error>"), Ctx())
    assert patterns(hits) == ["no_such_tool"]
    assert hits[0].example == "No such tool available: Write"
    assert hits[0].session == "s1" and hits[0].ts == "2026-10-28T10:00:00.000Z"
    assert patterns(classify(user_result("No such tool available: Write", is_error=False), Ctx())) == []


def test_classify_file_not_read_and_tool_error_token():
    assert patterns(classify(user_result("File has not been read yet. Read it first."), Ctx())) == ["file_not_read"]
    assert patterns(classify(user_result("Exit code 143\nCommand timed out"), Ctx())) == ["tool_error_exit"]
    assert patterns(classify(user_result("PreToolUse:Bash hook error: blocked"), Ctx())) == ["tool_error_pretooluse_bash"]
    assert patterns(classify(user_result("***"), Ctx())) == ["tool_error_unknown"]


def test_classify_rate_limit_text():
    text = "API Error: This request would exceed your account's rate limit."
    hits = classify(ev("assistant", text=text, is_api_error=True), Ctx())
    assert patterns(hits) == ["rate_limit_death"]
    assert patterns(classify(ev("assistant", text="You have hit your usage limit", is_api_error=True), Ctx())) == ["rate_limit_death"]
    assert patterns(classify(ev("assistant", text="We should add a rate limit to the API."), Ctx())) == []
    assert patterns(classify(ev("assistant", text="API Error: overloaded", is_api_error=True), Ctx())) == []


def test_classify_api_error_system_row():
    hits = classify(ev("system", subtype="api_error", text="Connection error. Retrying in 2 seconds"), Ctx())
    assert patterns(hits) == ["api_connection_error"]
    assert hits[0].example == "Connection error. Retrying in 2 seconds"
    assert classify(ev("system", subtype="compact_boundary"), Ctx()) == []


def test_classify_hook_non_blocking_error():
    hits = classify(ev("attachment", subtype="hook_non_blocking_error", detail="hook exploded"), Ctx())
    assert patterns(hits) == ["hook_error"] and hits[0].example == "hook exploded"
    for sub in ("hook_error_during_execution", "hook_stopped_continuation", "hook_blocking_error"):
        assert patterns(classify(ev("attachment", subtype=sub, detail="d"), Ctx())) == ["hook_dropped"]
    assert classify(ev("attachment", subtype="hook_success"), Ctx()) == []


def test_classify_user_correction_phrases():
    for t in ("try again", "Is everything finished?", "No, that's not what I asked", "you forgot the tests", "still broken"):
        assert patterns(classify(ev("user", text=t), Ctx())) == ["user_correction"], t
    assert classify(ev("user", text="please add a button"), Ctx()) == []
    assert classify(ev("user", text="try again " + "x" * 500), Ctx()) == []  # long pastes are not corrections
    assert classify(ev("user", text="try again", is_meta=True), Ctx()) == []


def test_classify_reasked_question():
    ctx = Ctx()
    assert classify(ev("user", text="Why is the build slow?"), ctx) == []
    hits = classify(ev("user", text="why is the build   slow"), ctx)
    assert patterns(hits) == ["re_asked"]
    assert classify(ev("user", text="ok"), ctx) == [] and classify(ev("user", text="ok"), ctx) == []
    assert classify(ev("user", text="a different question"), ctx) == []


def test_repeated_failed_command_needs_3():
    ctx = Ctx()
    classify(ev("assistant", tool_uses=tuple(ToolUse("b%d" % i, "Bash", {"command": "make test"}) for i in range(5))), ctx)
    out = []
    for i in range(5):
        out.append(patterns(classify(user_result("Exit code 2", "b%d" % i), ctx)))
    assert out[0] == ["tool_error_exit"] and out[1] == ["tool_error_exit"]
    assert out[2] == ["tool_error_exit", "repeated_failed_command"]
    assert out[3] == ["tool_error_exit"] and out[4] == ["tool_error_exit"]
    # a different command has its own count; non-Bash tools never count
    ctx = Ctx()
    classify(ev("assistant", tool_uses=(ToolUse("a", "Bash", {"command": "one"}), ToolUse("b", "Bash", {"command": "two"}),
                                          ToolUse("c", "Edit", {"command": "one"}))), ctx)
    for tid in ("a", "b", "c", "a", "b", "c"):
        assert "repeated_failed_command" not in patterns(classify(user_result("Exit code 1", tid), ctx))


def test_classify_fixture_session_counts():
    ctx, hits = Ctx(), []
    for l in fixture_lines("session_a.jsonl"):
        e = parse_line(l)
        if e:
            hits.extend(classify(e, ctx))
    assert Counter(patterns(hits)) == Counter({
        "user_correction": 3, "re_asked": 1, "tool_error_exit": 3, "repeated_failed_command": 1,
        "no_such_tool": 1, "file_not_read": 1, "rate_limit_death": 1, "api_connection_error": 1,
        "hook_error": 1, "hook_dropped": 1,
    })
    assert all(h.session == "sess-a" for h in hits)


# ---- redact / example_text --------------------------------------------------

def test_redact_sk_ghp_akia_bearer_longhex_kv():
    # secret-shaped values are assembled at run time so no key-shaped literal sits in the repo
    sk = "sk-" + "ab12" * 8
    sk_ant = "sk-ant-" + "Zy9_" * 8
    ghp = "ghp_" + "A1b2" * 9
    pat = "github_pat_" + "Q7" * 15
    akia = "AKIA" + "ABCD1234EFGH5678"
    slack = "xoxb-" + "1234567890-" * 2 + "abcdef"
    hexrun = "deadbeef" * 5
    jwt = "eyJ" + "a" * 12 + "." + "b" * 12 + "." + "c" * 12
    longmix = "Ab3" * 15
    cases = [sk, sk_ant, ghp, pat, akia, slack, hexrun, jwt, longmix]
    for secret in cases:
        out = redact("before %s after" % secret)
        assert secret not in out, secret
        assert "[REDACTED]" in out and out.startswith("before ") and out.endswith(" after")
    out = redact("Authorization: Bearer abcdefgh12345678")
    assert "abcdefgh12345678" not in out
    out = redact("curl -H 'bearer " + "T0kenValue" * 2 + "' x")
    assert "T0kenValue" not in out
    for text, secret in (("password: hunter2", "hunter2"), ("API_KEY=plainvalue1", "plainvalue1"),
                         ('{"client_secret": "s3cretvalue"}', "s3cretvalue"), ("my_token = 'abc def'", "abc def")):
        out = redact(text)
        assert secret not in out and "[REDACTED]" in out, text
    for plain in ("No such tool available: Write", "task-list and risk-free code", "/Users/x/.claude/mods-wt/friction-review/scripts",
                  "commit 1a2b3c4 fixed it", "session 2e36b6ca-0000-4000-8000-123456789abc", ""):
        assert redact(plain) == plain, plain
    once = redact("x " + sk + " password=abc " + hexrun)
    assert redact(once) == once


def test_example_truncated_160():
    long = "word " * 100
    out = example_text(long)
    assert len(out) <= 160 and out.endswith("...")
    exactly = "a" * 160
    assert example_text(exactly) == exactly
    assert example_text("  two\n\nlines\t here  ") == "two lines here"
    assert "sk-" not in example_text("use sk-" + "ab12" * 8 + " now")


# ---- aggregate / find_unused / render --------------------------------------

def h(pattern, session, example="e"):
    return Hit(pattern=pattern, session=session, ts="", example=example)


def test_aggregate_counts_and_sessions_and_order():
    hits = [h("b", "s1", "first-b"), h("a", "s1"), h("b", "s2", "second-b"), h("b", "s2"), h("c", "s3"), h("a", "s2")]
    s = aggregate(hits, top_n=20)
    assert s.total == 6 and s.patterns == 3
    assert s.rows == (Row("b", 3, 2, "first-b"), Row("a", 2, 2, "e"), Row("c", 1, 1, "e"))
    cut = aggregate(hits, top_n=2)
    assert [r.pattern for r in cut.rows] == ["b", "a"] and cut.total == 6 and cut.patterns == 3
    assert aggregate([], top_n=5) == Summary((), 0, 0)
    assert aggregate([h("z", "")], top_n=5).rows == (Row("z", 1, 0, "e"),)


def test_aggregate_ties_stable():
    one = [h("zeta", "s1"), h("alpha", "s1"), h("mid", "s1"), h("mid", "s2")]
    two = list(reversed(one))
    assert [r.pattern for r in aggregate(one).rows] == ["mid", "alpha", "zeta"]
    assert [r.pattern for r in aggregate(two).rows] == ["mid", "alpha", "zeta"]
    # same count, more sessions wins; then name
    hits = [h("p", "s1"), h("p", "s1"), h("q", "s1"), h("q", "s2")]
    assert [r.pattern for r in aggregate(hits).rows] == ["q", "p"]


def test_find_unused_30d():
    installed = {
        "alpha": {"skills": 3, "agents": 0, "mcp": 0, "is_mod": False},
        "beta": {"skills": 0, "agents": 1, "mcp": 0},
        "gamma": {"skills": 0, "agents": 0, "mcp": 2},
        "used": {"skills": 5, "agents": 0, "mcp": 0},
    }
    r = find_unused(installed, {"used": 4, "other": 9, "gamma": 1})
    assert r == Unused(unused=("alpha", "beta"), not_measurable=())
    assert find_unused({}, {}) == Unused((), ())


def test_find_unused_ignores_hook_only():
    installed = {
        "hooks-only": {"skills": 0, "agents": 0, "mcp": 0, "is_mod": False},
        "my-mod": {"skills": 2, "agents": 0, "mcp": 0, "is_mod": True},
        "idle": {"skills": 1, "agents": 0, "mcp": 0, "is_mod": False},
        "a-empty": {},
    }
    r = find_unused(installed, {})
    assert r.unused == ("idle",)
    assert r.not_measurable == ("a-empty", "hooks-only", "my-mod")


def test_render_markdown_golden():
    summary = Summary(rows=(
        Row("no_such_tool", 45, 4, "No such tool available: Write"),
        Row("user_correction", 20, 3, "try again | now"),
        Row("file_not_read", 6, 2, "File has not been read yet."),
    ), total=71, patterns=3)
    unused = Unused(unused=("alpha", "beta"), not_measurable=("gamma",))
    md = render_markdown(summary, unused, [("proj-a/big.jsonl", 60 * 1048576)], {"date": "2026-10-29", "days": 7, "files": 12})
    with open(os.path.join(FIX, "report_golden.md"), encoding="utf-8") as f:
        assert md == f.read()
    empty = render_markdown(Summary((), 0, 0), Unused((), ()), [], {"date": "2026-10-29", "days": 7, "files": 0})
    with open(os.path.join(FIX, "report_golden_empty.md"), encoding="utf-8") as f:
        assert empty == f.read()


def test_find_unused_plugin_with_hooks_not_measurable():
    installed = {
        "caveman": {"skills": 3, "agents": 3, "mcp": 0, "is_mod": False, "hooks": 1},
        "plugin-dev": {"skills": 7, "hooks": 0},
        "old-style": {"skills": 2},
    }
    r = find_unused(installed, {})
    assert r.not_measurable == ("caveman",)
    assert r.unused == ("old-style", "plugin-dev")


def test_find_unused_plugin_with_hooks_and_invocations_not_unused():
    r = find_unused({"superpowers": {"skills": 5, "hooks": True}}, {"superpowers": 4})
    assert "superpowers" not in r.unused
