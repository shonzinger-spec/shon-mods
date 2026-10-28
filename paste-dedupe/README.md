# paste-dedupe

## What it does
When a prompt repeats a run of 8 or more lines (300+ non-space characters) that an earlier prompt in this session already sent, the repeated run is replaced before Claude reads it:

`[same as message 2: 140 lines identical to a paste there, starting "2026-10-27 07:00:00 INFO ..."]`

New text around the repeat is kept, and a paste that is only partly new keeps its new lines. "Message N" counts the person's prompts since the session (or the mod) started. A toast says how many lines were replaced.

Left alone: slash commands, app-injected blocks (system reminders, notifications, command bodies), and prompts from notifications, peers or schedules (these are neither rewritten nor counted). Trailing spaces are ignored when comparing lines.

Before each prompt the mod checks the transcript and forgets every earlier prompt it no longer holds, so a marker never points at a message removed by a rewind, an edit, or `/clear` (which fires no session start); "message N" then counts the prompts still there. History also resets on a session start (startup, resume) and after a compaction.

A very long paste that nearly repeats many earlier ones stops looking after a fixed amount of comparison work (about 50-100 ms); the rest of it is sent as typed.

## Commands it adds
None.

## Files it reads and writes
Nothing on disk. Earlier prompts are kept in memory (oldest dropped past 20,000 lines). Reads the session transcript (`$.session.messages()`) before each prompt.

## When it runs (hooks/events)
- `prompt.submit`: drops earlier prompts the transcript no longer holds, then replaces repeated runs.
- `session.start`, `session.compact`: forget earlier prompts.

## How to turn it off
`claude plugin disable paste-dedupe@shon-mods`, or set `"paste-dedupe@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`.

## How to test it
```
claude plugin test ./paste-dedupe
```
