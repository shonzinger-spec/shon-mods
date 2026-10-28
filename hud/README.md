# hud

## What it does
One clean line showing the effort level the effort-router picked for this chat (updates live) next to the memory bar:

`⚡ high ▰▰▰▱▱ auto  │  ▣ RAM ████████▍░░░ 70% · 4.9G free  │  swap 97%`

- Labels and `│` are dim, values bright; swap is its own segment (yellow from 85%, red from 97%, else dim). `pane` draws it in a rounded box colored by the memory level.
- Motion, only on a change: the effort cells fill one by one with a one-time flash of the level word, and the RAM bar slides to its new value. `/hud motion off|on` (saved) turns it off; nothing runs while idle.
- Effort cells fill 1 to 5 for low, medium, high, xhigh, max. Colors: low green, medium cyan, high yellow, xhigh magenta, max red. ` · auto`, ` · you set it` or ` · forced` is dim; ultracode adds ` + team`. For 90 s after a change an arrow shows: `↑ high` or `↓ low`.
- The RAM fill is green (ok), yellow (warn) or red (critical) with a dim track. The memory half hides if its data is older than 10 minutes. A missing source hides its half; with neither, nothing is drawn.

## Commands it adds
- `/hud`: shows where the strip sits, whether motion is on, and the one-line help.
- `/hud motion <on|off>`: toggles the change animations (default on).
- `/hud place <footer|band|hint|pane|off>`: moves it and remembers the choice in every new chat. `footer` (default) is the right of the prompt footer, `band` the row above the prompt, `hint` the dim tail of the line under the prompt (terminal only, no colors), `pane` a side pane titled HUD, `off` draws nothing.

## Why no dragging
Claude Code only lets a mod draw in fixed slots, so free dragging is impossible. The place picker above is the closest thing.

## Files it reads and writes
- **Reads:** `~/.claude/mods-src/effort-router/state/now-<session>.json` and `~/.claude/mods-src/memory-guard/state/now.json`, at session start, each prompt, each finished turn and every 5 s. It reads tiny files only; never runs a command.
- **Writes:** only its saved placement (the plugin store).

## When it runs (hooks/events)
- `session.start`: registers `/hud`, starts the 5-second refresh, opens the pane if chosen.
- `prompt.submit`, `turn.complete`: refresh.
- `ui.render` for `SessionMode`, `AbovePrompt`, `PromptHint`, `Pane`: only the chosen slot draws; the others pass through.

## How to turn it off
- `/hud place off`, or `claude plugin disable hud@shon-mods`.

## How to test it
```
claude plugin test ./hud
```
