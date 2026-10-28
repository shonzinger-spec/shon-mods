# prereg

## What it does
`/prereg <slug> <plan>` asks Claude to write a pre-registration file `prereg/<slug>.json` before any result is seen. The file holds the hypothesis, data, period, gates and a SHA256, and is written with `scripts/prereg.py`.
A guard then refuses any write to a pre-registration file once its results exist. This stops anyone from moving the goalposts after seeing the results.

## Commands it adds
- `/prereg <slug> <hypothesis, data/period, gates>`: the slug must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$`. It submits a prompt that tells Claude to:
  1. Settle the falsifiable hypothesis and every gate, asking you for anything missing.
  2. Run `prereg.py create`.
  3. Show you the path, the sha256 and the gates. Claude does not run the test in that turn.
- Helper script (run by Claude or by you): `python3 scripts/prereg.py`
  - `create`: writes `<dir>/<slug>.json`. It never overwrites, and at least one `--gate "name|metric|op|threshold"` is required.
  - `verify <slug>`: recomputes the sha256 and exits 1 on a mismatch.
  - `judge <slug> <metrics.json>`: prints PASS/FAIL for each gate and exits 2 on FAIL.
  - `result <slug> <results file>`: writes `<slug>.result.json`, which locks the plan.
  - `list`: shows each pre-registration as open or LOCKED.
  - All subcommands accept `--dir`, default `prereg`.

## Files it reads and writes
- **The mod itself writes no files.** The `/prereg` prompt has Claude write `<cwd>/prereg/<slug>.json` (via `prereg.py create`). Later, `prereg.py result` writes `<cwd>/prereg/<slug>.result.json`.
- **Guarded paths** (writes are refused once locked):
  - New style: `…/prereg/<slug>.json`, `.sha256`, `.result.json`. Locked when `…/prereg/<slug>.result.json` exists, or when `…/results/` holds an entry named `<slug>` or `<slug>` followed by `.`, `_` or `-`.
  - Legacy (propfarm-2026): `PREREGISTRATION_<tag>.md`, `PREREG_<tag>.sha256`. Locked when `PREREG_<tag>_RESULT.sha256` exists in the same folder.
- **Reads:** existence checks on the lock markers and a listing of `results/`. It does not read the contents of pre-registration files.

## When it runs (hooks/events)
- `session.start`: records the cwd and HOME, and registers `/prereg`.
- `tool.call` for Write, Edit, MultiEdit, NotebookEdit and Bash, **before** the tool runs. For Bash, `hooks/shell.ts` works out which files the command would write (redirects, tee, touch, mkdir, rm, mv, cp, ln, rsync, install, `sed -i`/`perl -i`, `git checkout/restore/rm/mv`, following `cd` and simple `VAR=` assignments). If any target is a locked pre-registration, the call is denied with an explanation and an amendment hint.
- If the lock check itself throws on a pre-registration path, the call is **denied** ("not editing it blind"). Any other failure lets the call through.
- `command.run` for `prereg`.

## How to turn it off
- `claude plugin disable prereg@shon-mods`, or set `"prereg@shon-mods": false` in `~/.claude/settings.json`. It is enabled as of 2026-10-22.

## How to test it
```
claude plugin test ./prereg
```
(10 tests in `hooks/prereg.test.ts` and `hooks/shell.test.ts`.)
