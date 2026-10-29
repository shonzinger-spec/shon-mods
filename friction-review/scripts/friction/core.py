"""Pure functions for the weekly friction review: no file, network or clock access.

Python 3.9 compatible, standard library only.
"""
from __future__ import annotations

import json  # noqa: F401  (parse_line uses it)
import re  # noqa: F401
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

SNIPPET_MAX = 160
PATTERNS = (
    "no_such_tool", "tool_error_<first-token>", "rate_limit_death", "api_connection_error",
    "hook_error", "hook_dropped", "user_correction", "re_asked", "repeated_failed_command",
    "file_not_read",
)


@dataclass(frozen=True)
class ToolUse:
    id: str
    name: str
    input: dict


@dataclass(frozen=True)
class ToolResult:
    tool_use_id: str
    is_error: bool
    text: str


@dataclass(frozen=True)
class Event:
    kind: str  # "user" | "assistant" | "system" | "attachment"
    ts: str = ""  # the record's timestamp string, "" when absent
    session: str = ""
    text: str = ""
    subtype: str = ""
    is_api_error: bool = False
    is_meta: bool = False
    tool_uses: Tuple[ToolUse, ...] = ()
    tool_results: Tuple[ToolResult, ...] = ()
    detail: str = ""


@dataclass(frozen=True)
class Hit:
    pattern: str
    session: str
    ts: str
    example: str  # already redacted, whitespace-collapsed and at most SNIPPET_MAX chars
    key: str = ""


@dataclass
class Ctx:
    """Per-session mutable state; the caller makes a fresh Ctx for every transcript file."""

    tool_uses: Dict[str, ToolUse] = field(default_factory=dict)
    fail_counts: Dict[str, int] = field(default_factory=dict)
    seen_user: Set[str] = field(default_factory=set)


@dataclass(frozen=True)
class Row:
    pattern: str
    count: int
    sessions: int
    example: str


@dataclass(frozen=True)
class Summary:
    rows: Tuple[Row, ...]
    total: int  # hits over all patterns, before the top_n cut
    patterns: int  # distinct patterns, before the top_n cut


@dataclass(frozen=True)
class Unused:
    unused: Tuple[str, ...]
    not_measurable: Tuple[str, ...]


_REDACTED = "[REDACTED]"

_SECRET_RES = (
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{8,}"),
    re.compile(r"sk-(?:ant-)?[A-Za-z0-9_-]{16,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"(?:AKIA|ASIA)[A-Z0-9]{16}"),
    re.compile(r"xox[abprs]-[A-Za-z0-9-]+"),
    re.compile(r"eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"),
)
_HEX_RE = re.compile(r"(?<![A-Za-z0-9_-])[0-9a-fA-F]{32,}(?![A-Za-z0-9_-])")
_LONG_RE = re.compile(r"[A-Za-z0-9_-]{40,}")
_KV_RE = re.compile(
    r"(?i)([A-Za-z0-9_-]*(?:api[_-]?key|secret|token|password|passwd|authorization|credential)[A-Za-z0-9_-]*)"
    r"([\"']?\s*[:=]\s*)"
    r"(\"[^\"]*\"|'[^']*'|\S+)"
)


def _redact_hex(m: "re.Match[str]") -> str:
    text = m.group(0)
    if len(set(text)) > 1:
        return _REDACTED
    return text


def _redact_long(m: "re.Match[str]") -> str:
    text = m.group(0)
    if any(c.isdigit() for c in text) and any(c.isalpha() for c in text):
        return _REDACTED
    return text


def _redact_kv(m: "re.Match[str]") -> str:
    return m.group(1) + _REDACTED


def redact(s: str) -> str:
    """Replace secret-looking substrings of s with the literal text [REDACTED].

    Must catch: sk-... API keys (sk-ant-... too, 16+ chars after sk-), GitHub tokens
    (ghp_/gho_/ghu_/ghs_/ghr_ + 20+ alphanumerics, github_pat_...), AWS ids (AKIA or ASIA +
    16 uppercase alphanumerics), Slack tokens (xox[abprs]-...), JWTs (eyJ... three dot parts),
    "Bearer <token>" (case-insensitive, token 8+ chars of [A-Za-z0-9._~+/=-]), hex runs of 32+
    chars, any 40+ char run of [A-Za-z0-9_-] that has both a digit and a letter, and key/value
    pairs whose key contains api_key / apikey / api-key / secret / token / password / passwd /
    authorization / credential (the key may be followed by a closing quote, then optional spaces, then the separator : or =; the value is a quoted string or a non-space run;
    the key is kept and the value becomes [REDACTED], e.g. 'password: hunter2' ->
    'password=[REDACTED]' or 'password: [REDACTED]', either is fine as long as the value is gone).
    Ordinary words such as 'task-list', 'risk-free', paths and sentences must be left unchanged.
    Must be idempotent: redact(redact(s)) == redact(s). Never raises; redact("") == "".
    """
    if not s:
        return s
    try:
        out = s
        for pattern in _SECRET_RES:
            out = pattern.sub(_REDACTED, out)
        out = _KV_RE.sub(_redact_kv, out)
        out = _HEX_RE.sub(_redact_hex, out)
        out = _LONG_RE.sub(_redact_long, out)
        return out
    except Exception:
        return s


def example_text(s: str) -> str:
    """Redact s, collapse every whitespace run (newlines included) to one space, strip, and cut to
    at most SNIPPET_MAX (160) characters; if it was cut, the result ends with '...' and is still
    at most 160 characters long in total."""
    text = re.sub(r"\s+", " ", redact(s)).strip()
    if len(text) > SNIPPET_MAX:
        text = text[: SNIPPET_MAX - 3] + "..."
    return text


def _join_text(blocks: object) -> str:
    if not isinstance(blocks, list):
        return ""
    parts = []
    for block in blocks:
        if isinstance(block, dict) and block.get("type") == "text":
            value = block.get("text")
            if isinstance(value, str):
                parts.append(value)
    return "\n".join(parts)


def _as_str(value: object) -> str:
    return value if isinstance(value, str) else ""


def parse_line(line: str, default_session: str = "") -> Optional[Event]:
    """Parse one transcript JSONL line. TOTAL: never raises, whatever the input.

    Returns None for blank lines, invalid JSON, JSON that is not an object, and records whose
    "type" is not one of user / assistant / system / attachment. Otherwise an Event:
    - kind = record["type"]; ts = record.get("timestamp") if a str else ""; session =
      record.get("sessionId") if a non-empty str else default_session; is_meta = bool(record.get("isMeta")).
    - user: message.content is a str -> text = that str. If it is a list: text = the "text" fields
      of its {"type":"text"} blocks joined with "\\n"; each {"type":"tool_result"} block becomes a
      ToolResult(tool_use_id, is_error=block.get("is_error") is True, text) where text is block
      content if a str, else the "text" fields of its text blocks joined with "\\n".
    - assistant: message.content list: text blocks joined with "\\n" -> text; {"type":"tool_use"}
      blocks -> ToolUse(id, name, input) (input {} when not a dict); is_api_error =
      bool(record.get("isApiErrorMessage")) or record.get("error") is truthy.
    - system: subtype = record["subtype"] (str, else ""); text = record["error"]["formatted"] when
      that is a str, else "". is_api_error False.
    - attachment: subtype = record["attachment"]["type"]; detail = the attachment's "stderr" if a
      non-empty str, else its "command" if a non-empty str, else its "hookName" if a str, else "".
    Any field of the wrong type is treated as absent (message not a dict, content an int, ...).
    """
    try:
        record = json.loads(line)
    except Exception:
        return None
    if not isinstance(record, dict):
        return None
    kind = record.get("type")
    if kind not in ("user", "assistant", "system", "attachment"):
        return None

    ts = _as_str(record.get("timestamp"))
    session = record.get("sessionId")
    if not (isinstance(session, str) and session):
        session = default_session
    is_meta = bool(record.get("isMeta"))

    text = ""
    subtype = ""
    is_api_error = False
    detail = ""
    tool_uses: Tuple[ToolUse, ...] = ()
    tool_results: Tuple[ToolResult, ...] = ()

    message = record.get("message")
    if not isinstance(message, dict):
        message = {}
    content = message.get("content")

    if kind == "user":
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            text = _join_text(content)
            results = []
            for block in content:
                if not isinstance(block, dict) or block.get("type") != "tool_result":
                    continue
                tool_use_id = _as_str(block.get("tool_use_id"))
                is_error = block.get("is_error") is True
                raw = block.get("content")
                if isinstance(raw, str):
                    result_text = raw
                else:
                    result_text = _join_text(raw)
                results.append(ToolResult(tool_use_id, is_error, result_text))
            tool_results = tuple(results)

    elif kind == "assistant":
        if isinstance(content, list):
            text = _join_text(content)
            uses = []
            for block in content:
                if not isinstance(block, dict) or block.get("type") != "tool_use":
                    continue
                block_input = block.get("input")
                uses.append(ToolUse(
                    _as_str(block.get("id")),
                    _as_str(block.get("name")),
                    block_input if isinstance(block_input, dict) else {},
                ))
            tool_uses = tuple(uses)
        is_api_error = bool(record.get("isApiErrorMessage")) or bool(record.get("error"))

    elif kind == "system":
        subtype = _as_str(record.get("subtype"))
        error = record.get("error")
        if isinstance(error, dict):
            text = _as_str(error.get("formatted"))

    elif kind == "attachment":
        attachment = record.get("attachment")
        if not isinstance(attachment, dict):
            attachment = {}
        subtype = _as_str(attachment.get("type"))
        stderr = attachment.get("stderr")
        command = attachment.get("command")
        hook_name = attachment.get("hookName")
        if isinstance(stderr, str) and stderr:
            detail = stderr
        elif isinstance(command, str) and command:
            detail = command
        elif isinstance(hook_name, str):
            detail = hook_name

    return Event(
        kind=kind, ts=ts, session=session, text=text, subtype=subtype,
        is_api_error=is_api_error, is_meta=is_meta, tool_uses=tool_uses,
        tool_results=tool_results, detail=detail,
    )


_CORRECTION_PHRASES = (
    "try again", "is everything finished", "that's not what i", "that is not what i",
    "that's wrong", "that is wrong", "you forgot", "you didn't", "still not working",
    "still broken", "doesn't work", "didn't work",
)
_RATE_LIMIT_RE = re.compile(
    r"rate.?limit|usage limit|limit (?:reached|exceeded)|exceed.{0,40}limit",
    re.IGNORECASE,
)
_HOOK_DROPPED = ("hook_error_during_execution", "hook_stopped_continuation", "hook_blocking_error")


def _hit(pattern: str, event: Event, example: str, key: str = "") -> Hit:
    return Hit(pattern=pattern, session=event.session, ts=event.ts, example=example, key=key)


def _error_token(msg: str) -> str:
    words = msg.split()
    token = words[0].lower() if words else ""
    token = re.sub(r"[^a-z0-9]+", "_", token).strip("_")[:20]
    return token or "unknown"


def classify(event: Event, ctx: Ctx) -> List[Hit]:
    """Return the friction Hits for one event, in order, and update ctx. Never raises.

    Always (assistant events): record each of event.tool_uses in ctx.tool_uses by id.

    user events (not is_meta):
    - for every ToolResult with is_error True (tool results that are not errors are ignored):
      let msg = r.text with any <...> tags removed and whitespace collapsed/stripped.
        * "No such tool available" in msg -> pattern "no_such_tool"
        * elif "File has not been read yet" in msg -> "file_not_read"
        * else -> "tool_error_" + token, token = msg's first whitespace-separated word, lowercased,
          every run of chars outside [a-z0-9] replaced by "_", leading/trailing "_" stripped, cut to
          20 chars; token "" -> "unknown". ("Exit code 143 ..." -> "tool_error_exit";
          "PreToolUse:Bash hook error" -> "tool_error_pretooluse_bash").
      example = example_text(msg).
      Additionally, if ctx.tool_uses[r.tool_use_id] is a "Bash" use with a non-empty str
      input["command"]: increment ctx.fail_counts[command]; when the count becomes exactly 3, also
      emit Hit("repeated_failed_command", key=command, example=example_text(command)). (The 4th and
      later failures emit nothing more.) This applies to every erroring result, whatever its pattern.
    - typed text: let t = event.text.strip(). Only if t is non-empty and len(t) <= 400:
        * "user_correction" (at most once per event) when t.lower() contains any of: "try again",
          "is everything finished", "that's not what i", "that is not what i", "that's wrong",
          "that is wrong", "you forgot", "you didn't", "still not working", "still broken",
          "doesn't work", "didn't work". example = example_text(t).
        * "re_asked": norm = lowercase t with chars outside [a-z0-9 ] removed (after lowercasing),
          whitespace collapsed, stripped. If len(norm) >= 12: if norm is already in ctx.seen_user
          emit Hit("re_asked", example=example_text(t)); then add norm to ctx.seen_user.
        (user_correction hit comes before the re_asked hit.)

    assistant events: if (event.is_api_error or event.text starts with "API Error") and event.text
    matches, case-insensitively, rate.?limit | usage limit | limit (reached|exceeded) |
    exceed.{0,40}limit  -> Hit("rate_limit_death", example=example_text(event.text)).

    system events: subtype == "api_error" -> Hit("api_connection_error", example=example_text(event.text)).

    attachment events: subtype "hook_non_blocking_error" -> "hook_error"; subtype in
    ("hook_error_during_execution", "hook_stopped_continuation", "hook_blocking_error") ->
    "hook_dropped"; example = example_text(event.detail). Other subtypes -> no hit.

    Every Hit carries session=event.session and ts=event.ts.
    """
    hits: List[Hit] = []
    try:
        if event.kind == "assistant":
            for tool_use in event.tool_uses:
                ctx.tool_uses[tool_use.id] = tool_use

        if event.kind == "user":
            if not event.is_meta:
                for result in event.tool_results:
                    if not result.is_error:
                        continue
                    raw = result.text if isinstance(result.text, str) else ""
                    msg = re.sub(r"<[^>]*>", "", raw)
                    msg = re.sub(r"\s+", " ", msg).strip()
                    if "No such tool available" in msg:
                        pattern = "no_such_tool"
                    elif "File has not been read yet" in msg:
                        pattern = "file_not_read"
                    else:
                        pattern = "tool_error_" + _error_token(msg)
                    hits.append(_hit(pattern, event, example_text(msg)))

                    tool_use = ctx.tool_uses.get(result.tool_use_id)
                    if tool_use is not None and tool_use.name == "Bash" and isinstance(tool_use.input, dict):
                        command = tool_use.input.get("command")
                        if isinstance(command, str) and command:
                            count = ctx.fail_counts.get(command, 0) + 1
                            ctx.fail_counts[command] = count
                            if count == 3:
                                hits.append(_hit(
                                    "repeated_failed_command", event,
                                    example_text(command), key=command,
                                ))

                t = event.text.strip()
                if t and len(t) <= 400:
                    lowered = t.lower()
                    if any(phrase in lowered for phrase in _CORRECTION_PHRASES):
                        hits.append(_hit("user_correction", event, example_text(t)))

                    norm = re.sub(r"[^a-z0-9 ]", "", lowered)
                    norm = re.sub(r"\s+", " ", norm).strip()
                    if len(norm) >= 12:
                        if norm in ctx.seen_user:
                            hits.append(_hit("re_asked", event, example_text(t)))
                        ctx.seen_user.add(norm)

        elif event.kind == "assistant":
            text = event.text if isinstance(event.text, str) else ""
            if (event.is_api_error or text.startswith("API Error")) and _RATE_LIMIT_RE.search(text):
                hits.append(_hit("rate_limit_death", event, example_text(text)))

        elif event.kind == "system":
            if event.subtype == "api_error":
                hits.append(_hit("api_connection_error", event, example_text(event.text)))

        elif event.kind == "attachment":
            if event.subtype == "hook_non_blocking_error":
                hits.append(_hit("hook_error", event, example_text(event.detail)))
            elif event.subtype in _HOOK_DROPPED:
                hits.append(_hit("hook_dropped", event, example_text(event.detail)))
    except Exception:
        pass
    return hits


def aggregate(hits: Iterable[Hit], *, top_n: int = 20) -> Summary:
    """Group hits by pattern. Row.count = hits of the pattern, Row.sessions = distinct non-empty
    session ids among them (a hit with session "" is not counted, so such a pattern may report 0), Row.example = the example of the
    first hit of that pattern in input order. Rows are ordered by count descending, then sessions
    descending, then pattern name ascending (so ties are deterministic), and cut to the first top_n.
    Summary.total = number of hits overall and Summary.patterns = number of distinct patterns, both
    counted before the cut. No hits -> Summary((), 0, 0)."""
    counts: Dict[str, int] = {}
    sessions: Dict[str, Set[str]] = {}
    examples: Dict[str, str] = {}
    total = 0
    for hit in hits:
        total += 1
        if hit.pattern not in counts:
            counts[hit.pattern] = 0
            sessions[hit.pattern] = set()
            examples[hit.pattern] = hit.example
        counts[hit.pattern] += 1
        if hit.session:
            sessions[hit.pattern].add(hit.session)

    rows = [
        Row(pattern, counts[pattern], len(sessions[pattern]), examples[pattern])
        for pattern in counts
    ]
    rows.sort(key=lambda row: (-row.count, -row.sessions, row.pattern))
    return Summary(tuple(rows[:top_n]), total, len(counts))


def find_unused(installed: Mapping[str, Mapping[str, object]], invocations_30d: Mapping[str, int]) -> Unused:
    """installed maps a plugin name to {"skills": int, "agents": int, "mcp": int, "is_mod": bool,
    "hooks": int} (missing keys mean 0 / False). A plugin is NOT MEASURABLE when is_mod is true,
    it declares hooks (they run every session, so 0 invocations proves nothing), or
    skills + agents + mcp == 0 (hook-only). Every other plugin is UNUSED when
    invocations_30d.get(name, 0) == 0. Both result tuples are sorted alphabetically."""
    unused: List[str] = []
    not_measurable: List[str] = []
    for name, info in installed.items():
        details = info if hasattr(info, "get") else {}
        skills = details.get("skills", 0)
        agents = details.get("agents", 0)
        mcp = details.get("mcp", 0)
        skills = skills if isinstance(skills, int) else 0
        agents = agents if isinstance(agents, int) else 0
        mcp = mcp if isinstance(mcp, int) else 0
        is_mod = bool(details.get("is_mod", False))
        hooks = details.get("hooks", 0)
        has_hooks = hooks is True or (isinstance(hooks, int) and hooks > 0)
        if is_mod or has_hooks or (skills + agents + mcp) == 0:
            not_measurable.append(name)
        elif invocations_30d.get(name, 0) == 0:
            unused.append(name)
    return Unused(tuple(sorted(unused)), tuple(sorted(not_measurable)))


def render_markdown(summary: Summary, unused: Unused, skipped: Sequence[Tuple[str, int]], meta: Mapping[str, object]) -> str:
    """Render the report exactly as the golden file tests/fixtures/report_golden.md shows.
    meta has "date" (YYYY-MM-DD str), "days" (int) and "files" (int, files scanned).
    skipped is a list of (label, size_in_bytes). Cells of the table: '|' becomes '\\|', newlines
    become spaces. Sizes print as f"{bytes / 1048576:.1f} MB". The text ends with one newline."""
    def cell(value: object) -> str:
        text = str(value).replace("|", "\\|")
        return text.replace("\r\n", " ").replace("\r", " ").replace("\n", " ")

    lines: List[str] = [
        "# Friction review %s" % meta.get("date", ""),
        "",
        "Window: last %s days. Files scanned: %s." % (meta.get("days", 0), meta.get("files", 0)),
        "",
        "## Patterns",
        "",
    ]

    if summary.rows:
        lines.append("%d hits across %d patterns." % (summary.total, summary.patterns))
        lines.append("")
        lines.append("| Pattern | Count | Sessions | Example |")
        lines.append("|---|---|---|---|")
        for row in summary.rows:
            lines.append("| %s | %d | %d | %s |" % (
                cell(row.pattern), row.count, row.sessions, cell(row.example),
            ))
    else:
        lines.append("No patterns found.")
    lines.append("")

    lines.append("## Skipped (>50 MB)")
    lines.append("")
    if skipped:
        for label, size in skipped:
            lines.append("- %s (%.1f MB)" % (label, size / 1048576))
    else:
        lines.append("None.")
    lines.append("")

    lines.append("## Unused plugins")
    lines.append("")
    lines.append("Plugins with skills, agents or MCP tools and 0 invocations in the last 30 days:")
    lines.append("")
    if unused.unused:
        for name in unused.unused:
            lines.append("- %s" % name)
    else:
        lines.append("None.")
    lines.append("")

    lines.append("Not measurable (plugins with hooks, and shon-mods):")
    lines.append("")
    if unused.not_measurable:
        for name in unused.not_measurable:
            lines.append("- %s" % name)
    else:
        lines.append("None.")

    return "\n".join(lines) + "\n"
