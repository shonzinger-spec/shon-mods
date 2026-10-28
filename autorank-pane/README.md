# autorank-pane

## What it does
`/autorank` opens a pane summarizing AutoRank outreach: follow-ups due, lapsed gaps, queued first touches, Gmail status, and live leads. It uses AutoRank's cadence and suppression code; it does not send email.

## Commands it adds
- `/autorank` — open and refresh the AutoRank pane.

## Files it reads and writes
- **Reads:** `~/AutoRank/logs/sent-*.json`, `logs/do-not-send.json`, newest `logs/queued-*.json` or `carry-*.json`, `HANDOFF.md`, and AutoRank's `src/outreach/sequence.js` and `suppression.js`.
- **Writes:** nothing on disk.

## When it runs (hooks/events)
- `session.start`: registers `/autorank`.
- `command.run` for `/autorank`: collects the status and opens the pane. Its Refresh button recollects it.

## How to turn it off
- `claude plugin disable autorank-pane@shon-mods`, or set `"autorank-pane@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. It is enabled as of 2026-10-22.

## How to test it
```
claude plugin test ./autorank-pane
```
