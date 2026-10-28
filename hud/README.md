# hud

## What it does
Two sleek pill progress bars: the effort level the effort-router picked for this chat (updates live) and the memory bar.

`effort ◖██high██▍░░◗ ↑ auto   ram ◖████69%███▍░░░◗ 5.1G free · swap 98%`

- Each pill has round caps, a solid fill on a muted track, an edge that moves in 1/8-cell steps, and a centered label (level word, or used `NN%`). Words `effort` and `ram`, source, and `free` are dim. `pane` draws it in a rounded box colored by the memory level.
- Effort pill (width 10): fill `#8B5CF6` violet, track `#2E2A3D`; fill is 20% per level (low 20 ... max 100). ` auto`, ` you set it` or ` forced` is dim; ultracode adds ` + team` in violet. For 90 s after a change a violet arrow shows: `↑` or `↓`.
- Memory pill (width 14): fill by level, ok teal `#14B8A6`, warn amber `#F59E0B`, critical red `#EF4444`; track `#23303A`. Swap is its own segment: dim, amber `#F59E0B` from 85%, red `#EF4444` from 97%. The memory half hides if its data is older than 10 minutes. A missing source hides its half; with neither, nothing is drawn.
- `hint` placement is plain text: `effort ▰▰▰▱▱ high · ram 69% · swap 98%`.
- Motion, only on a change: both fills glide to the new value (10 frames, 40 ms apart). `/hud motion off|on` (saved) turns it off; nothing runs while idle.

## Desktop rendering
On desktop (any surface with `Svg`) the strip is one SVG in the style of savvy-progress: a muted rounded track per bar (120 px effort, 160 px RAM), a dotted fill that thickens toward its head, and a solid tag riding at the head (the level word for effort, the used % for RAM). Effort is violet (#8B5CF6); RAM is teal (#14B8A6), amber (#F59E0B) at warn, red (#EF4444) at critical. The dots twinkle softly; that stops under reduced-motion and with `/hud motion off`. Terminals keep the text pills above; `hint` stays plain text.

## Commands it adds
- `/hud`: shows where the strip sits, whether motion is on, and the one-line help.
- `/hud motion <on|off>`: toggles the change animations (default on).
- `/hud place <footer|band|hint|pane|off>`: moves it and remembers the choice in every new chat. `band` (default) is the row above the prompt, where the bars animate, with any other mod band kept beneath; `footer` is the right of the prompt footer (the app shows the bars there as a still picture, so no animation), `hint` the dim tail of the line under the prompt (terminal only, no colors), `pane` a side pane titled HUD, `off` draws nothing.

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
