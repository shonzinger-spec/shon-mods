# memory-guard

## What it does
Early warning for the 16 GB Mac running out of memory, plus a safe way to free some. Every 60 s one shell call reads macOS memory pressure, swap, total RAM and free-memory percentage (`sysctl` + `memory_pressure -Q`, about 10 ms). It shows `mem warn · swap 38.6/39.9G · Google Chrome 52G` in the status line and a 12-cell memory bar `RAM ████████▍░░░ 70% · 4.9G free · swap 97%` (RAM used; fill green ok, yellow warn, red critical, dim track) at the right of the prompt footer. Level is warn at pressure "warn" or swap >= `swapWarnPct` (85), critical at pressure "critical" or swap >= `swapCriticalPct` (97). When the level rises, or stays above ok for `cooldownMin` minutes, it runs one scan, names the top users in a toast, and at critical also sends a notification. Alerts are shared across open chats through `state/alert.json`.

At warn or critical a band above the prompt lists the top 4 memory users from the last scan with two buttons: "Not now" (hides it until the level rises or `cooldownMin` passes) and "Let Claude clean it". It cannot hide macOS's own out-of-memory dialog.

## Commands it adds
- `/mem`: runs the expensive scan (`top` + `ps`, about 5 s under pressure) and prints level, swap, the top 12 users (GB, process count), and per Claude chat its own memory plus its MCP servers. Read-only.
- `/mem clean`: same flow as the "Let Claude clean it" button. Fresh scan, then you pick which listed apps to quit (multi-select), then confirm "Quit them" / "Cancel", then each app is asked to quit with `osascript ... to quit` (apps may prompt to save).
- `/mem clean --dry-run`: fresh scan, prints what would be offered and what is never offered; asks nothing, quits nothing.

## Safety rules for cleanup
- Only apps whose bundle is under `/Applications/` or `~/Applications/` can be offered (so launchd jobs, python, node, `/System` and `/Library` bundles never are). At most 4, largest first. Chrome is labeled "(tabs restore on reopen)".
- Never offered: Claude (desktop), any claude chat or its MCP servers, any app that hosts a chat or has a process started by one, any app with any process whose command contains `~/Trading`, TradingView, terminals (Terminal, iTerm, iTerm2, Ghostty, Warp, kitty, Alacritty, WezTerm, Hyper, Tabby), editors and agent apps (Visual Studio Code, Cursor, Codex, Antigravity, Devin, OpenCode, Atlarix, Amp, Zed, Windsurf, Xcode, Android Studio, JetBrains IDEs, Sublime Text, Nova, BBEdit), Finder, Dock, SystemUIServer, ControlCenter, loginwindow, and anything outside `/Applications` or `~/Applications`. Apps are quit by their exact bundle path with AppleScript `quit`, so each can ask to save; an app that doesn't answer in 20 s is logged and skipped.
- Two explicit answers are needed (pick, then "Quit them"); anything that is not an exact label is ignored. Candidates are re-scanned right before quitting, and names must match `[A-Za-z0-9 .()&+_-]`.
- Graceful quit only: no kill signals, no sudo, no purge.

## Files it reads and writes
- **Reads:** `config.json` (`intervalSec`, `swapWarnPct`, `swapCriticalPct`, `cooldownMin`), `state/alert.json`; runs `sysctl`, `memory_pressure -Q`, and `top` and `ps` on `/mem`, alerts and cleanup.
- **Writes:** `state/alert.json` (last alert level and time), `state/log.jsonl` (one row per level change or alert) and `state/actions.jsonl` (one row per cleanup step: dry-run, offered, picked, cancelled, quit with exit code and stderr), all under `~/.claude/mods-src/memory-guard/`.
- **Quits apps** (only after your confirmation) via `osascript`.

## When it runs (hooks/events)
- `session.start`: registers `/mem`, starts one 60-second timer per module load and an immediate first tick.
- `ui.render` for `SessionMode`: the RAM bar (filled cells in the level color, dim track) with used %, free GB and swap % after the existing mode labels.
- `ui.render` for `AbovePrompt`: the warn/critical band with the two buttons (skipped during a survey).
- `command.run` for `mem`: the report, or the cleanup flow for `clean`.

## How to turn it off
- `claude plugin disable memory-guard@shon-mods`, or `./uninstall.sh` (asks before deleting `state/`).

## How to test it
```
claude plugin test ./memory-guard
```
