# bad-data

## What it does
Warns when a Read, Bash, Write, Edit, or NotebookEdit touches a configured known-defective data file. It shows a toast and adds the defect, safe use, unsafe use, and alternative to Claude's context; it never blocks a call.

## Commands it adds
- `/bad-data` — reload `bad-data.json` and list its configured defects.

## Files it reads and writes
- **Reads:** this plugin's `bad-data.json`.
- **Writes:** nothing on disk.
- It examines tool-call paths, commands, and newly written code; search/list shell commands and documentation-file writes are skipped.

## When it runs (hooks/events)
- `session.start`: registers `/bad-data` and loads the defect list.
- `tool.call`: warns after a matching successful call. Each defect is toasted once per session; read/shell context is added once, while code writes are reported each time.
- `command.run` for `/bad-data`: reloads and displays the list.

## How to turn it off
- `claude plugin disable bad-data@shon-mods`, or set `"bad-data@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. It is enabled as of 2026-10-22.

## How to test it
```
claude plugin test ./bad-data
```
