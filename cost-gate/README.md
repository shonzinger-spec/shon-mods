# cost-gate

## What it does
Warns, without blocking, when a Write, Edit, or MultiEdit adds a zero/negative trading cost to a non-test Python file under a trading root. For NQ/MNQ files, it also warns if configured point costs are below the measured round-trip floor; `# cost-ok` suppresses a reviewed line.

## Commands it adds
- `/costs` — show measured round-trip costs and whether the verdict `cost_gate` policy is on.

## Files it reads and writes
- **Reads:** `bad-data/bad-data.json` (or `$VERDICT_COSTS`) for measured costs; `~/.claude/verdict/policy.json` (or `$VERDICT_POLICY`) for policy; `~/Trading` links and fixed trading-root paths; edited files after an Edit/MultiEdit.
- **Writes:** nothing on disk.

## When it runs (hooks/events)
- `session.start`: registers `/costs`, finds trading roots, and loads costs.
- `tool.call`: after a successful Write, Edit, or MultiEdit, scans relevant Python content and adds a warning toast/context for findings.
- `command.run` for `/costs`: reloads and displays the cost/policy data.

## How to turn it off
- `claude plugin disable cost-gate@shon-mods`, or set `"cost-gate@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. It is not enabled as of 2026-10-22 (no `enabledPlugins` entry).

## How to test it
```
claude plugin test ./cost-gate
```
