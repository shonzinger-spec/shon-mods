# friction-review

A weekly look at what keeps going wrong in your Claude Code sessions, plus a list of plugins you installed but never use.

## Parts

- `scripts/friction/scan.py` reads the last 7 days of `~/.claude/projects/*/*.jsonl` (top-level transcripts only, one file at a time, files over 50 MB skipped and listed), counts the friction patterns, and writes `~/.claude/friction-review/reports/YYYY-MM-DD.md` and `latest.json` (outside this repo). The same pass counts plugin invocations over 30 days for the "Unused plugins" section. Standard library only, Python 3.9, no network.
- `scripts/friction/core.py` is the pure part (parse, classify, redact, aggregate, render). Every report example is secret-redacted and cut to 160 characters.
- `scripts/friction/notify.py` shows a dialog with the text "These are the common things holding us back this week. If we make a mod for them, we can make sure we never run into them again." and buttons Later / Open report (gives up after 5 minutes). Opened only when patterns were found. A banner cannot be clicked, so it is a dialog.
- `scripts/com.shonmods.friction-review.plist.template` and `scripts/install.sh`: launchd job `com.shonmods.friction-review`, Fridays 17:00 local (runs on wake if the Mac slept). `install.sh` fills `__MOD_DIR__` and `__HOME__`, writes `~/Library/LaunchAgents/`, and loads it. `install.sh --no-load` writes only, `--uninstall` removes. Nothing here runs it for you.
- `hooks/` is the mod: an amber band above the prompt while the newest report has patterns and is unread, `/friction` (prints the top patterns and the report path, marks it read in `~/.claude/friction-review/read.json`), and, only while unread, one session instruction to offer reading the report and drafting fix-mod specs (never to build without approval).

## Patterns

`no_such_tool`, `tool_error_<first word>`, `rate_limit_death`, `api_connection_error`, `hook_error` (non-blocking hook errors), `hook_dropped` (stopped continuation, hook errors during execution; best effort), `user_correction`, `re_asked`, `repeated_failed_command` (same Bash command failing 3 times in a session), `file_not_read`.

Unused plugins: enabled plugins with skills, agents or MCP tools and 0 invocations in 30 days. Hook-only plugins and the shon-mods marketplace are listed as not measurable. Bare skills in `~/.claude/skills` are not covered.

## Run and test

    python3 scripts/friction/scan.py --days 7 --no-notify [--out DIR] [--projects DIR] [--now ISO]
    cd scripts && python3 -m pytest tests -q
    claude plugin test friction-review
