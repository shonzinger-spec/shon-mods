# cost-band

## What it does
Shows session cost and API cache-read ratio in the status line. Above the prompt it shows an amber band from the nudge cost (`nudge_usd`, default $15) saying "start a new session (save a handoff first)", and red at the limit (`limit_usd`, default $20). A toast fires once when the session first reaches each level; after `/clear` (or a resume) the next conversation toasts each level again. If the nudge is not below the limit, amber starts at 80% of the limit.

## Commands it adds
None.

## Files it reads and writes
- **Reads:** Claude's session-usage summary (`cost.usd` and live API token usage) and plugin settings `limit_usd` (default $20) and `nudge_usd` (default $15), from `pluginConfigs["cost-band@shon-mods"].options` in `~/.claude/settings.json`.
- **Writes:** nothing on disk.

## When it runs (hooks/events)
- `session.start`: starts a near-immediate refresh and a 60-second refresh timer.
- `session.end`: forgets which levels were toasted, so a `/clear` (which fires no `session.start`) starts the count over.
- `turn.complete`: refreshes usage after each turn.
- `ui.render` for `AbovePrompt`: renders the amber/red band when applicable.

## How to turn it off
- `claude plugin disable cost-band@shon-mods`, or set `"cost-band@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. Enabled in `enabledPlugins` as of 2026-10-27.

## How to test it
```
claude plugin test ./cost-band
```
