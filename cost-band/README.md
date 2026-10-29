# cost-band

## What it does
Shows session cost and API cache-read ratio in the status line. Above the prompt it shows an amber band from the nudge cost (`nudge_usd`, default $15) saying "start a new session (save a handoff first)", and red at the limit (`limit_usd`, default $20). A toast fires once when the session first reaches each level; after `/clear` (or a resume) the next conversation toasts each level again. If the nudge is not below the limit, amber starts at 80% of the limit.

Auto-handoff (0.2.0): on the first finished main-agent turn at or over `handoff_usd` (default $20), it submits one prompt that makes Claude write a handoff (the `context-handoff:handoff-save` skill if available, else a `~/.claude/handoffs/<date>-<topic>.md` or `HANDOFF.md` file), then offer a fresh chat and stop. In Claude Desktop the prompt calls `mcp__ccd_session__start_session`, which shows a card you click once; in the terminal it prints a one-line resume command. It fires once per conversation (re-armed by `/clear` or a resume), never from the 60 s timer, and a subagent's turn never triggers it. If the handoff turn is already covered by an earlier handoff in the same chat (for example session-health at 75% context), the prompt tells Claude to reuse it. If the cap differs from the red limit, a toast announces it.

## Commands it adds
None.

## Files it reads and writes
- **Reads:** Claude's session-usage summary (`cost.usd` and live API token usage) and plugin settings `limit_usd` (default $20), `nudge_usd` (default $15), `handoff_usd` (default $20, 0 or less disables) and `auto_handoff` (default true), from `pluginConfigs["cost-band@shon-mods"].options` in `~/.claude/settings.json`.
- **Writes:** nothing on disk itself; the handoff prompt makes Claude write the handoff file.

## When it runs (hooks/events)
- `session.start`: starts a near-immediate refresh and a 60-second refresh timer.
- `session.end`: forgets which levels were toasted, so a `/clear` (which fires no `session.start`) starts the count over.
- `turn.complete`: refreshes usage after each turn; at the cap, submits the handoff prompt once (main agent only).
- `ui.render` for `AbovePrompt`: renders the amber/red band when applicable.

## How to turn it off
- Handoff only: set `auto_handoff` to false (or `handoff_usd` to 0) in `pluginConfigs["cost-band@shon-mods"].options`.
- `claude plugin disable cost-band@shon-mods`, or set `"cost-band@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. Note: `enabledPlugins` has it set to false as of 2026-10-29, so none of this runs until it is re-enabled.

## How to test it
```
claude plugin test ./cost-band
```

## Install
```
/plugin install cost-band --marketplace <owner>/<repo>
```
