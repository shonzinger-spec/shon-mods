# one-chat-guard

## What it does
Keeps one chat per task. When a new chat looks like the same task as a chat you already have open, a band appears above the prompt: `Looks like the same task as "<title>" (idle 2h). [Open it] [Keep this chat]`. It never blocks, edits or delays your prompt.

## When it checks
Each chat checks twice at most, never again:
1. At your first real prompt (slash commands and plugin-sent prompts are skipped): same folder and a similar first prompt.
2. After the first finished turn, once the chat has its auto title: same title as an open chat.

## What counts as a match
- Same title after ignoring case, punctuation and a "Fork of" prefix (any folder), score 1.0.
- Or same folder and the first prompts share at least 55% of their content words (Jaccard, stopwords removed, each prompt needs 6+ content words).
- Never offered: archived chats, routines, this chat itself, a chat it spawned or was spawned by.
- At most 3 candidates, newest activity first; the band shows the newest and "(+N more)".

## Buttons
- **Open it**: switches to that chat through the app (`ccd_window` `open_session_in`). If the app refuses, a toast names the chat and the band stays.
- **Keep this chat**: hides the band for the session and remembers the pair (`$.store` key `kept`) so the same two chats are never asked about again.

## Config (`config.json`)
`enabled` (true), `minJaccard` (0.55), `ignoreTitles` (titles that never count as a match, e.g. "New chat").

## Privacy
Reads only the app's own chat metadata files and, for open chats in the same folder, the first user message of the transcript. The new chat's prompt goes to the lookup script on stdin (never written to disk, never in the process list). The cache `state/firstprompts.json` keeps only content words per chat, and the script prints only titles and ids. Nothing leaves the machine.

## Tune it on your own chats
`python3 tools/find_similar.py --dry-run --ignore-title "New chat"` prints every pair of open chats it would flag, so thresholds can be checked before relying on the band.

## Files
`hooks/register.tsx` (band + checks), `hooks/lib.ts` (title normalisation, check gating, pair memory), `tools/match.py` (pure matching), `tools/find_similar.py` (read-only file lookup), `types/index.d.ts` (state contract).

## Tests
`python3 -m unittest discover one-chat-guard/tools` and `claude plugin test one-chat-guard`.

## How to turn off
Set `"enabled": false` in `config.json`, or `claude plugin disable one-chat-guard@shon-mods`.
