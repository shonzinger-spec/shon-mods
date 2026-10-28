# experiment-ledger

## What it does
Reads the verdict experiment JSONL ledger and presents a summary or one idea's history, including its latest verdict and whether kill-ledger treats it as killed. Large ledgers are read from their last 4 MB, so older rows are not counted in that case.

## Commands it adds
- `/experiments` — summarize the ledger.
- `/experiments <idea>` — show that idea's rows and latest kill status.

## Files it reads and writes
- **Reads:** `~/Trading/_ledger/experiments.jsonl` (or `$VERDICT_LEDGER`) and, when the ledger is absent, `~/.claude/verdict/policy.json` (or `$VERDICT_POLICY`).
- **Writes:** nothing on disk.

## When it runs (hooks/events)
- `session.start`: registers `/experiments`.
- `command.run` for `/experiments`: reads/parses the ledger and returns the requested summary or idea report.

## How to turn it off
- `claude plugin disable experiment-ledger@shon-mods`, or set `"experiment-ledger@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. It is not enabled as of 2026-10-22 (no `enabledPlugins` entry).

## How to test it
```
claude plugin test ./experiment-ledger
```
