# brain-sync

A side pane that answers one question: **is every Claude chat saved in the second brain?**
It checks every chat once a minute, pops open when one fails to save, and reruns the save until it lands.

`/brain` opens the pane. It also opens by itself when a session starts.

## What "saved" means
A chat is saved when all three stages hold for its *current* transcript:

| Stage | Checked against |
| --- | --- |
| Backed up | `~/second-brain/archive/chats/_raw/MANIFEST.tsv` has the transcript's sha256 |
| Note | `notes_state.json` has that sha256 and the note file exists |
| Melxis | `~/second-brain/melxis_sync/state.json` has the note at `ok` with the note's current hash |

A chat still in use (idle under 6 h and not archived in the app) is **live**: the pipeline waits for it
on purpose. A finished chat that is not saved is **not saved yet**. These are the same rules the nightly
jobs use, so the pane never disagrees with them.

## The auto-rerun
When something is not saved, the checker reruns your existing launchd jobs (no new save logic):
`com.secondbrain.chatarchive` for a missing backup or note, then `com.secondbrain.melxissync` for a missing mel.
One job at a time, never while one runs, with backoff (now, +10, +20, +40, +80 min), then every 60 min until it lands; it never gives up.
The count resets when the failures shrink or new ones appear.
Both jobs are keyed by chat id, so a rerun never makes a second note or mel.

## Files
- `scripts/sync_status.py` — the checker. `python3 scripts/sync_status.py` prints one line;
  `--json` the full status; `--heal` also reruns; `--force` skips the backoff wait and reruns now.
  Writes only `~/second-brain/archive/chats/monitor_state.json` (hash cache + retry state).
- `hooks/register.tsx`, `hooks/lib.ts` — the pane and its bars.

## Settings (constants)
- check interval: `EVERY_MS` in `hooks/register.tsx` (60 s)
- retry cap and backoff: `CAP`, `BACKOFF_MIN` in `scripts/sync_status.py`
- paths: `BRAIN_ARCHIVE`, `BRAIN_MELXIS_STATE` env vars override the defaults

## Install
Listed in the `shon-mods` marketplace (`~/.claude/mods-src`); enabled as `brain-sync@shon-mods`.

## Tests
```
python3 -m pytest scripts/test_sync_status.py
claude plugin test ~/.claude/mods-src/brain-sync
```
