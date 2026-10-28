# variant-counter

## What it does
It counts how many distinct variants have been tried for each research idea in the experiment ledger. When a new verdict's idea goes over `variant_limit` (default 20), it shows one toast saying a PASS now needs a reality-check/SPA p ≤ `rc_alpha` (default 0.05).
It only warns. Blocking is done by `verdict.py` / verdict-line, and only when the `variant_counter` rule is on in `policy.json`.

## Commands it adds
- `/variants`: every idea in the ledger, sorted by the number of distinct variants. For each idea: the number of runs, an `OVER <limit>` mark, whether any run has an RC/SPA p ≤ alpha, and whether a PASS is possible or blocked.
- `/variants <idea>`: one line per distinct variant (its latest run): date, PF, t, p and p kind, verdict, and the run count. The idea name is matched exactly first, then case-insensitively.

## Files it reads and writes
- **Reads** (each path can be overridden by an env var):
  - `~/.claude/verdict/latest.json` (`VERDICT_PATH`)
  - `~/.claude/verdict/policy.json` (`VERDICT_POLICY`): `variant_limit` and `rc_alpha`.
  - `~/Trading/_ledger/experiments.jsonl` (`VERDICT_LEDGER`)
- **Writes:** no files. Uses `$.store` key `toasted` (up to the 500 most recent verdict keys `[idea, variant, written_at]`), so each verdict toasts at most once, across sessions.
- **How the count works:** distinct variant ids for the idea in the ledger, plus the verdict's own variant (`countVariants` in `hooks/policy.ts`). The file's own `variants_tried` field is ignored. Python's bare `Infinity`/`NaN` (a run with no losing trade) are read with `parseJson`, so those runs count.
- `hooks/policy.ts` and `hooks/policy_cases.ts` are byte copies of verdict-line's: fix them there and re-copy.
- **Skips:** verdicts with a schema other than `verdict/1` or `verdict/2`, and verdicts older than 7 days.
- The ledger is only appended to by `write_verdict()` in `~/Trading/_scratch/verdict.py` when the `experiment_ledger` rule is on in `policy.json` (it is `false` as of 2026-10-22). Until then, `/variants` reports that no ledger exists.

## When it runs (hooks/events)
- `session.start`: registers `/variants`, checks once, and starts a 30-second timer that checks again.
- `turn.complete`: checks again.
- `command.run` for `variants`.

## How to turn it off
- Not enabled as of 2026-10-22 (not in `enabledPlugins`). If you enabled it, use `claude plugin disable variant-counter@shon-mods` or set `"variant-counter@shon-mods": false` in `~/.claude/settings.json`.
- Blocking is controlled separately by `"variant_counter"` in `~/.claude/verdict/policy.json` (currently `false`). That switch does not affect the toast.

## How to test it
```
claude plugin test ./variant-counter
python3 -m unittest discover -s ./variant-counter/scripts -p 'test_*.py'
```
(52 tests in `hooks/variant-counter.test.ts`, including the shared `policy_cases.ts`. The Python test fails if the two policy copies drift from verdict-line's.)
