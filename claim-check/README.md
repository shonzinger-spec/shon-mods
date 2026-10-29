# claim-check

## What it does
Checks PF/profit factor, Sharpe, win-rate, and t-stat numbers in the main assistant reply against numeric values seen in the user's prompts, tool results, and context other hooks injected beside them, this conversation. It warns once per turn for unbacked precision. It also gates done-claims: if the reply says tests/checks pass, is verified, or (after files were edited) is done/fixed/implemented, but no test or check command ran this turn, the last check failed, or files changed after the last green check, it toasts and appends a transcript line. It never changes or blocks the reply.

## Commands it adds
- `/claims` — report the last reply's checked metrics, backing status, and nearest corpus number, plus the done-claim gate verdict for that reply if one fired.

## Files it reads and writes
- **Reads:** session prompts, tool results, and the final assistant reply through the Claude session API; optional `config.json` in the plugin folder: `{ "extra_check_patterns": ["verify-all"] }`, case-insensitive regex sources that also count as check commands (invalid ones are skipped).
- **Writes:** nothing on disk. Prompts and tool results are re-read from the transcript at every check (so a resume or reload loses none); injected hook context, this turn's check/edit log and the last report live in memory and reset on session start and on `/clear` or resume.

## When it runs (hooks/events)
- `session.start`: clears in-memory state and registers `/claims`.
- `session.end`: clears in-memory state, so after `/clear` the old conversation backs nothing.
- `prompt.submit`: adds user text and any hook context beside it to the numeric corpus, and resets the turn log.
- `tool.call`: adds returned tool-result text and any hook context after it to the corpus; records Bash test/lint/typecheck runs (green or red) and file edits (not `.md`/`.txt`), subagents included, in the turn log.
- `turn.complete`: for a main-agent answer only, checks the reply (inline metrics, markdown emphasis and table columns) against the transcript plus the in-memory corpus, and toasts once if any metric is unbacked; then runs the done-claim gate against the turn log (toast + transcript line).

## How to turn it off
- `claude plugin disable claim-check@shon-mods`, or set `"claim-check@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. It is not enabled as of 2026-10-22 (no `enabledPlugins` entry).

## How to test it
```
claude plugin test ./claim-check
```
