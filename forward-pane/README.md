# forward-pane

## What it does
`/forward` opens a live forward-test pane for configured launchd jobs. It shows schedule, running/exit state, stale or missed runs, recent error lines, and ledger trade counts versus targets; problem jobs sort first.

## Commands it adds
- `/forward` — open the forward-test pane.

## Files it reads and writes
- **Reads:** this plugin's `jobs.json`, matching `~/Library/LaunchAgents/*.plist`, `launchctl list`, configured stdout/stderr logs, and configured ledger files.
- **Writes:** nothing on disk.

## When it runs (hooks/events)
- `session.start`: registers `/forward`.
- `command.run` for `/forward`: collects status and opens the pane.
- Once opened, it refreshes every five minutes; its Refresh button also recollects status.

## How to turn it off
- `claude plugin disable forward-pane@shon-mods`, or set `"forward-pane@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. It is enabled as of 2026-10-22.

## How to test it
```
claude plugin test ./forward-pane
```
