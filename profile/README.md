# profile

## What it does
`/profile` changes the `enabledPlugins` set that Claude Code will load in a **new session**. It has focused sets (`trading`, `business`, `coding`, `youtube`, `engineering`, `agent`, plus any learned ones), each combined with the always-on core set. Sidebar section names work through `_aliases` in `profiles.json` (for example `agent stuff`, `youtube automation`, `engineering · EE portfolio`). `/profile all` restores the full enabled-plugin snapshot made on the first switch.

Plugins supplied by the Claude desktop app, rather than by `~/.claude/settings.json` → `enabledPlugins`, are not affected.

## Commands it adds
- `/profile <name>`: select that profile (or alias, multi-word allowed) for the next session.
- `/profile all`: restore the original full enabled-plugin snapshot.
- `/profile` or `/profile list`: show profiles, their plugin counts and ~tokens, and whether the current set matches one.
- `/profile measure`: estimate the current set's fixed prompt overhead from installed skills, commands, agents, and descriptions.
- `/profile measure <profile>`: the same estimate for a named profile (core included), to compare before switching.
- `/profile learn <section> [--force]`: build profile `<section>` from the plugins used in that sidebar section, read from `usage-coach/state/tool-log.jsonl`. Refuses to overwrite an existing profile without `--force`; prints `no tool log yet` if the log is missing.
- `/profile auto`: runs `learn` for every logged section that has no profile yet (skips ones whose plugins are not installed).

## Files it reads and writes
- **Reads:** `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json`, and this mod's `profiles.json`, and (for `learn`/`auto`) `usage-coach/state/tool-log.jsonl`.
- **Writes:** `profiles.json` (`learn`/`auto` only), `~/.claude/settings.json` atomically, a timestamped settings backup under `state/`, and (once only) `state/all.json`.
- **Reads for measurement:** installed plugin directories. Missing local/directory install paths are counted as unknown and skipped.

## When it runs (hooks/events)
- `session.start`: registers `/profile`, then runs `profile.py auto` quietly (30-second limit, errors ignored).
- `command.run` for `profile`: calls the stdlib-only Python helper with a 30-second limit. `list` is the default; `measure`, `learn` and `auto` run those subcommands; every other argument switches profiles.

## How to turn it off
`claude plugin disable profile@shon-mods`, or set `"profile@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`.

## How to test it
```
python3 -m unittest discover -s profile/scripts -p 'test_*.py'
claude plugin test profile
```
