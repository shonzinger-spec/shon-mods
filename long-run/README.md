# long-run

## What it does
It times Bash commands that look like backtests: python / uv run / poetry run commands whose script, module or subcommand contains a word such as backtest, sweep, walkforward, optimize, monte-carlo, bootstrap, reality-check, replay, grid or spa, or whose script name starts with `run_`.
If a command signature, run from the same directory, last took 2 minutes or more, it refuses to run it in the foreground again and asks for `run_in_background: true`. A `--help`, `-h` or `--dry-run` run is never refused and never timed. It also sends a desktop notification when a long run finishes, whether it ran in the foreground or the background.

## Commands it adds
None.

## Files it reads and writes
- No files on disk.
- Uses the plugin's key-value store (`$.store`), which persists between sessions:
  - `dur:<run directory>|<signature>` → `{ ms, at }`: last duration of that command signature run from that directory. The run directory is the session cwd moved by any `cd X` before the python segment, resolved to an absolute path, so a `backtest.py` in two repos keeps two histories.
  - `pending` → `{ <backgroundTaskId>: { sig, key, startedAt } }`: background runs still waiting for their finish notification.
- A signature keeps the interpreter, the script or `-m module`, and one bare subcommand word. It drops flags, values, `cd X &&`, `VAR=` prefixes and the wrappers env/time/nohup/caffeinate/exec. Example: `python run_sweep.py grid`.
- `python -c` gets no signature, so it is never handled.

## When it runs (hooks/events)
- `tool.call` (Bash only):
  - Before the run: if the stored duration is ≥ 120 000 ms (`LONG_MS`) and the call is not backgrounded, the call is denied.
  - `--help`, `-h`, `--dry-run` / `--dry_run` runs pass through untouched.
  - After the run: if the run was backgrounded, or moved to the background (the result's `backgroundTaskId`, or the engine's wording "moved to the background (ID: …)"; a bare "ID: x" in the output does not count), it is added to `pending`. A foreground run moved to the background after 2 minutes or more (its timeout, which defaults to 120 s, or Ctrl+B) stores that time at once, so the next foreground run is refused.
  - If the run finished in the foreground: a run under 2 minutes updates the stored time only if it succeeded. A run of 2 minutes or more always stores its time, sends `$.ui.notify("finished <sig> (N.Nm)")` and, if it succeeded, adds a nudge to the context.
- `prompt.submit` with `origin.kind === 'task-notification'`: when the text names a pending task ID, it sends a notification with the elapsed minutes, stores that elapsed time as the signature's duration (unless the run was short and the notification reports a failure: "failed", "killed" or a non-zero exit code) and removes that ID from `pending`. The prompt itself is never changed.
- Both hooks have a `.catch` that passes the call through, so a long-run failure never blocks the command.

## How to turn it off
- Not enabled as of 2026-10-22 (not listed in `enabledPlugins`). If you enabled it, turn it off with `claude plugin disable long-run@shon-mods` or by setting `"long-run@shon-mods": false` in `~/.claude/settings.json`.
- To lift the refusal for one command without turning the mod off: run that command in the background once. When its finish notification arrives, its time replaces the stored one, so a run under 2 minutes lifts the refusal.

## How to test it
```
claude plugin test ./long-run
```
(18 tests in `hooks/long-run.test.ts`.)

UNSURE: where the engine keeps `$.store` data on disk, and how to reset a stored duration by hand. The code does not show either.
