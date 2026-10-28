# chat-tidy

## What it does
Keeps the Claude desktop sidebar tidy. Once a day it archives chats that have been idle 14+ days, after backing up every raw transcript to the second brain. Fully automatic; a toast says what happened: `chat-tidy: archived N idle chats (14+ days); all backed up. Restore from the sidebar's Archived filter.` No toast when nothing was archived.

## Safety rules
- Idle limit 14 days (`config.json` `idleDays`, or `/tidy days <n>`, minimum 3). At most 25 chats per run, oldest first.
- Never archived: pinned, running, already archived, this chat itself, a chat whose child chat is running or recently active. A chat the app refuses to archive (still working, pinned, open on screen) is logged as skipped.
- If this chat's id cannot be read, the run is skipped.
- Backup first or nothing: `python3 ~/second-brain/archive/chats/tools/backup_raw.py` must exit 0 (copies raw transcripts, no model). If it fails, nothing is archived and a toast says so.
- Reversible: archiving only hides the chat; transcripts stay. Never deletes anything.

## Commands it adds
- `/tidy`: dry run. Lists what would be archived (title, idle days) and counts protected chats. Touches nothing, no backup.
- `/tidy now`: runs immediately, ignoring the 20 h gate; returns the summary.
- `/tidy days <n>`: sets the idle limit (n >= 3), kept in the plugin store.

## When it runs
`session.start` and a 60-minute timer; it runs when `state/last-run.json` is missing or older than 20 h. The run is claimed (last-run.json written) before work starts, so parallel chats do not double-run.

## Files it reads and writes
- **Reads:** `config.json` (`idleDays`, `maxPerRun`), `state/last-run.json`.
- **Writes:** `state/last-run.json`, `state/runs.jsonl` (one row per archived/skipped chat and per run), `~/second-brain/archive/chats/archive-log.md` (a `## <time>` section per run), all under `~/.claude/mods-src/chat-tidy/` except the log.
- **App calls:** `ccd_session_mgmt` `get_session`, `list_sessions`, `archive_session`.

## How to restore
Sidebar filter -> Archived -> unarchive, or ask any chat to unarchive it. Raw transcripts are also in the second brain backup.

## How to turn off
`claude plugin disable chat-tidy@shon-mods`.

## How to test it
```
claude plugin test ./chat-tidy
```

## How it finds chats (and why)
The app's chat-list tool can only return the newest ~40 chats in one answer (169 open chats came back as a size error), so the oldest, idle ones were invisible to it. chat-tidy reads the app's own per-chat files instead, read-only, with `tools/scan_sessions.py` (`~/Library/Application Support/Claude/claude-code-sessions/*/*/local_*.json`: title, last activity, parent, auto-archive exemption). It falls back to the tool if the scan fails. Right before archiving each chat it asks the app about that one chat again (`get_session`) and skips it if it is now running, pinned, already archived or active within the idle window. Chats the app marks exempt from auto-archive, or waiting on you, are never picked.

Only one chat runs a tidy at a time (an atomic `state/run.lock`, stale after 2 h); a failed backup is logged with its exit code and error text in `state/runs.jsonl`.
