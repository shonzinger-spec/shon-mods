# null-first

## What it does
It watches the latest verdict file. When a new verdict that is not a FAIL fails rule 14 (null_first: "a PASS counts only when a null test ran and lost"), it shows one toast for that verdict.
Rule 14: for `flip`, the null PF must be < 1.0 and < the real PF. For `random_entry`, `null_pct` must be ≥ 95, or, when there is no pct, the null PF must be < the real PF.
`/nulls` lists experiment-ledger rows with their null test and the rule result. Ledger rows written before `verdict.py` recorded `null_pct` cannot be judged for `random_entry` (the pct decides the rule): such a row shows `null-first FAIL` when its `blocked_by` lists `null_first`, else `null-first unknown`. The mod only warns: blocking is done by `verdict.py` / verdict-line, and only when the policy switch is on.

## Commands it adds
- `/nulls`: shows whether the rule is on or off, the latest verdict's null result, and the last 15 ledger rows.
- `/nulls <idea>`: shows every ledger row for that idea (case-insensitive, at most 100).

## Files it reads and writes
- **Reads** (each path can be overridden by an env var):
  - `~/.claude/verdict/latest.json` (`VERDICT_PATH`)
  - `~/.claude/verdict/policy.json` (`VERDICT_POLICY`): read only by `/nulls` to show on/off.
  - `~/Trading/_ledger/experiments.jsonl` (`VERDICT_LEDGER`)
- **Writes:** no files. Uses `$.store` key `seen` (up to the 200 most recent verdict keys `idea|variant|written_at`), so the same verdict never toasts twice, even across sessions.
- **Skips:** verdicts with a schema other than `verdict/1` or `verdict/2`, FAIL verdicts, and verdicts older than 7 days.
- The rule logic is in `hooks/policy.ts`, which is byte-for-byte identical to the copies in verdict-line and variant-counter (a TS port of `apply_policy()` in `~/Trading/_scratch/verdict.py`).

## When it runs (hooks/events)
- `session.start`: registers `/nulls`, checks once, and starts a 30-second timer (`$.clock.every(30000)`) that runs the check again.
- `turn.complete`: checks again.
- `command.run` for `nulls`.

## How to turn it off
- Not enabled as of 2026-10-22 (not in `enabledPlugins`). If you enabled it, use `claude plugin disable null-first@shon-mods` or set `"null-first@shon-mods": false` in `~/.claude/settings.json`.
- The rule's **blocking** is controlled separately by `"null_first"` in `~/.claude/verdict/policy.json` (currently `false`). That switch does not affect the toast.

## How to test it
```
claude plugin test ./null-first
```
(51 tests in `hooks/null-first.test.ts`, including the shared `policy_cases.ts`.)
