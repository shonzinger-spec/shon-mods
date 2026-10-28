# folder-guard

## What it does
Refuses creation of a new loose file or folder in `~`, `~/Desktop`, or `~/Documents`. It suggests `~/Trading`, `~/YouTube`, `~/AutoRank-Business`, `~/Career`, or `~/Engineering` from the path/content; existing items, existing project folders, and dot-folders pass. Hub rule: creating exactly `~/<hub>` for one of those five folders is allowed (`~/Engineering2` and `~/notes.txt` are still refused).

## Commands it adds
None.

## Files it reads and writes
- **Reads:** the current session working directory, `$HOME`, and filesystem existence for the proposed top-level item. It parses Bash paths, redirects, `touch`, `mkdir`, `cp`, and `mv` destinations.
- **Writes:** nothing itself; it may deny a Write, NotebookEdit, or Bash call before that tool writes.

## When it runs (hooks/events)
- `session.start`: records `$HOME`.
- `tool.call`: checks Write, NotebookEdit, and Bash creation targets before the call, denying a newly loose item in a guarded folder.

## How to turn it off
- `claude plugin disable folder-guard@shon-mods`, or set `"folder-guard@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. It is enabled as of 2026-10-22.

## How to test it
```
claude plugin test ./folder-guard
```
