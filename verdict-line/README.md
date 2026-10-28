# verdict-line

## What it does
It shows the current test's verdict in the status line, for example:
`🟢 PASS <test> · GROSS · PF 1.42 · t 2.31 · SPA p 0.030 · n 214 · failed: … · blocked: … · 3h ago`
Each time it draws, it re-checks the verdict against the current policy rules, the measured costs and the experiment ledger. This uses a TS port of `apply_policy()` from `~/Trading/_scratch/verdict.py`. Because of the re-check, a hand-edited PASS cannot show, and `GROSS` and `blocked: <rules>` appear when they apply.

## Commands it adds
None.

## Files it reads and writes
- **Reads** (each path can be overridden by an env var):
  - `~/.claude/verdict/latest.json` (`VERDICT_PATH`): written by `write_verdict()` in `~/Trading/_scratch/verdict.py`. Schema must be `verdict/1` or `verdict/2`.
  - `~/.claude/verdict/policy.json` (`VERDICT_POLICY`): rule switches `cost_gate`, `variant_counter`, `null_first`, plus `variant_limit` and `rc_alpha`. A missing or broken file means all rules are off.
  - `~/.claude/mods-src/bad-data/bad-data.json` (`VERDICT_COSTS`): its `costs` section gives the measured round-trip cost (`rt_pts`) per symbol.
  - `~/Trading/_ledger/experiments.jsonl` (`VERDICT_LEDGER`): used to count distinct variants per idea.
- **Writes:** nothing on disk. It only sets `$.ui.status`.
- **Display rules:**
  - The line is hidden if there is no file, the schema is unknown, or the verdict is older than 7 days.
  - A verdict is only ever downgraded (PASS → INCONCLUSIVE), never upgraded.
  - `GROSS` shows for `verdict/2` files whose costs are missing or below the measured floor, and for `verdict/1` files only while `cost_gate` is on.

## When it runs (hooks/events)
- `session.start`: draws once, then starts a 30-second timer (`$.clock.every(30000)`) that redraws.
- `turn.complete`: redraws.
- Both hooks have a `.catch` pass-through, and `refresh()` swallows its own errors, so the status line never breaks a turn.

## How to turn it off
- `claude plugin disable verdict-line@shon-mods`, or set `"verdict-line@shon-mods": false` in `~/.claude/settings.json`. It is enabled as of 2026-10-22.
- To hide the line without disabling the mod: remove `~/.claude/verdict/latest.json` (the line also hides by itself after 7 days).

## How to test it
```
claude plugin test ./verdict-line
```
(53 tests in `hooks/verdict-line.test.ts` and `hooks/policy.test.ts`. `policy_cases.ts` holds the shared cases, which the comment in `policy.ts` says are owned by the Python side.)

`hooks/policy.ts` is byte-for-byte identical to the copies in null-first and variant-counter. If you change one, change all three.
