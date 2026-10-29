# needs-you

## What it does
`/needs-you` opens a pane of every open desktop chat that needs you: **Stalled** (hit a usage limit, ended with an error, or your last message got no reply) first, then **Waiting on you** (with the question the chat asked). Working and finished chats are shown only as counts. The status line shows `N waiting, M stalled` after each scan.

If the pane cannot be drawn (window too narrow), `/needs-you` answers with the same list as text, one `[#<sessionId>]` link per chat.

## Resume after a usage limit
A chat whose last turn was cut off by the usage limit shows its reset time ("resets 3:10pm"). Once the reset passes, its row gets a **Continue** button, and `/needs-you resume` lists the ready chats (numbered) while `/needs-you resume <n>` continues one.
- The message sent is only: "Your last turn was cut off by the usage limit. Continue from where you left off; check state before repeating any step." The original prompt is never re-sent (the cut-off turn may already have run tools, so a re-send could repeat side effects).
- Once per limit error per chat (`sessionId:errorAt` in `sent.json`). Never to this chat, a running chat, an archived chat or a routine chat. A send counts only when the app reports it as delivered or queued. A failed send records nothing, so the chat stays listed as stalled.
- Default: notify only. A single toast says which chats can continue once their reset has passed.
- `/needs-you auto on` (persisted, off by default; `/needs-you auto off`, `/needs-you auto`) sends by itself 5 minutes after the reset. It spends your fresh usage window, hence off by default. A once-a-minute timer with a lock directory means only one open chat acts. A refused send is retried after 15 minutes. Auto mode only resumes a chat whose reset passed at most 6 hours ago (an older stall is stale context); the pane's Continue button and `/needs-you resume` still offer older ones.
- Reset text is parsed from the app's error line by `tools/parse_reset.py` (session, weekly, with or without a date, in the zone the text names). A rate-limit error has no reset time, so it is shown but never resumed.

**Live status: unverified.** `ccd_session_mgmt send_message` to an idle chat was only exercised against a mocked app call (a real chat was not probed, per the build rules). If the app does not start a turn on an idle chat, the Continue button will report success but nothing will run; test once with a throwaway chat before turning auto on. The app may also ask for approval when one chat messages another.

## Where the question comes from
Best source first: the `ask` of the chat's last `wrap_up` call in its final turn (exact), a pending `AskUserQuestion`, the last question paragraph of the final assistant text, then the app's own `needs_action` summary. A summary is not verbatim, so the pane marks it "(app summary, not verbatim)".

## Safety
Scanning is read-only and local: no network, no archiving. The only send is the optional continue message below, to a local app chat. State is written only under `~/.claude/mods-src/needs-you/state/` (`sent.json`, `notified.json`, `runs.jsonl`, lock and last-run files). It reads the app's per-chat files (`~/Library/Application Support/Claude/claude-code-sessions/*/*/local_*.json`) and, only for a chat that looks blocked, the last 400 KB of its transcript. Archived chats and routine (scheduled-task) chats are skipped; this chat is left out of the lists. One `list_sessions` call (limit 60) marks which chats are running.

## Pane buttons
- **Refresh**: rescans (the pane also rescans every 5 minutes, only while it is open).
- A button per stalled or waiting chat: asks the app to focus it (`ccd_window open_session_in`). The app only focuses chats this chat started, so for any other chat it answers with a toast naming the chat to open from the sidebar. Live behaviour of this button is unverified.

## Limits
- The app's chat-file layout is private and may change; the scanner tolerates missing keys and treats unknown chats as done.
- About half of older chats have no turn summary, so they show as done.

## Files
`tools/classify.py` (pure rules), `tools/parse_reset.py` (limit text to reset time), `tools/scan_chats.py` (reads files, prints JSON), `hooks/lib.ts` (sort and format), `hooks/limit.ts` (who is due, command parsing), `hooks/register.tsx` (command, pane, timers, send).

## Turn off
`claude plugin disable needs-you@shon-mods`.

## Tests
```
python3 -m unittest discover needs-you/tools
claude plugin test needs-you
claude plugin validate needs-you
```
