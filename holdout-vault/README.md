# holdout-vault

## What it does
Protects confirmed sealed holdouts in `vault.json`. Opening one asks the user because a successful read burns it; writes, deletions, moves, and shell modifications to a sealed holdout are refused. `/burn` explicitly spends a holdout.

## Commands it adds
- `/burn <slug>` — mark a confirmed holdout as burned so it can be opened.

## Files it reads and writes
- **Reads:** this plugin's `vault.json`, configured sealed paths (including realpaths), the current working directory, and the configured burn ledger.
- **Writes:** appends one `BURNED` JSONL record to the configured ledger (default `~/Trading/_ledger/holdout_burns.jsonl`) after a successful first read, or through `/burn`.
- It parses read/write tools and shell commands, including paths in redirects, heredocs, and some Desktop Commander calls.

## When it runs (hooks/events)
- `session.start`: loads the vault and registers `/burn`.
- `tool.check`: asks for person approval before a read or shell call can open an unburned holdout.
- `tool.call`: denies holdout writes; after a successful open, records the burn and adds a toast/context note.
- `command.run` for `/burn`: burns the named confirmed holdout.

## How to turn it off
- `claude plugin disable holdout-vault@shon-mods`, or set `"holdout-vault@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. It is not enabled as of 2026-10-22 (no `enabledPlugins` entry).

## How to test it
```
claude plugin test ./holdout-vault
```
