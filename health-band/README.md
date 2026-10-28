# health-band

## What it does
Shows a band above the prompt with two parts:
- **Gauges (always drawn):** `LSE 312/15000` (requests in `~/.lse_calls.log` dated today, local time; yellow above 10,000, red above 14,000) · helper-agent jobs started today or still running, from the dispatch.sh logs (`Codex ok 2 · Cline running 1 · opencode failed 1`) · `overhead ~91.3k tok/turn`, the fixed per-turn context of plugin skills/commands/agents (the `/profile measure` count) plus `~/.claude/skills`, at ~4 characters a token. A gauge whose source can't be read shows "unavailable".
- **Issues (only when checks find problems):** API credit errors in launchd logs, a missing/rejected LSE key, stale/unreadable live feeds, or stale/non-zero forward jobs. Hide hides the issue rows until a red condition worsens; the gauges stay.

It draws no context or 5-hour usage item (the app bar shows those) and no weekly reset countdown. Bands of other mods beneath it still draw.

## Commands it adds
- `/healthband` — rerun all checks, show every issue, and unhide the band.

## Files it reads and writes
- **Reads:** this plugin's `health.json`, matching `~/Library/LaunchAgents/*.plist` and their log tails, `~/.lse_key`, `~/.lse_calls.log`, `~/Trading/_scratch/agent-pipeline/logs/<agent>-<date>-<time>-<pid>.log`, configured feed files, forward-job configuration/state through `forward_status.py`, and the profile mod's `profile.py measure` plus `~/.claude/skills/*/SKILL.md` for the overhead gauge.
- **Writes:** nothing on disk.

## When it runs (hooks/events)
- `session.start`: registers `/healthband`, schedules an initial check, then checks every five minutes.
- `command.run` for `/healthband`: reruns the checks.
- `ui.render` for `AbovePrompt`: renders issues with Recheck and Hide, then the gauge row, then whatever band sits beneath.

## How to turn it off
- `claude plugin disable health-band@shon-mods`, or set `"health-band@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. It is enabled as of 2026-10-22.

## How to test it
```
claude plugin test ./health-band
python3 -m unittest discover -s ./health-band/scripts
```
