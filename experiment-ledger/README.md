# experiment-ledger

## What it does
Reads the verdict experiment JSONL ledger and presents a summary or one idea's history, including its latest verdict and whether kill-ledger treats it as killed. Large ledgers are read from their last 4 MB, so older rows are not counted in that case.

Since 0.2.0 it also tracks preregistrations that never got a verdict (`/experiments open`) and shows a band above the prompt when one has waited a week or more.

- **json preregs** (`<root>/prereg/<slug>.json`, written by the prereg mod): `open` until `<slug>.result.json` exists (age from `created_at`), then `unlogged` until a ledger row or a sibling `<root>/verdict.json` carries the same `slug` (age from the result file). A ledger row only matches when `write_verdict()` was called with `slug=`.
- **legacy preregs** in `~/propfarm-2026` itself (`PREREGISTRATION_<tag>.md` and/or `PREREG_<tag>.sha256`, frozen at the sha file's mtime): `open` until `PREREG_<tag>_RESULT.sha256` exists, then done. Legacy tags cannot link to the ledger, so finished-but-unmarked ones stay open until you ack them. Amendments (`v62_A1`) are their own tags. Untagged `PREREG.sha256` / `PREREGISTRATION.md` and copies in sub-folders are ignored.
- Scans `~/Trading` and `~/propfarm-2026` (depth 7) with `find ... -exec stat -f` (BSD stat, macOS only). A failed scan prints `could not scan (...)` and hides the band.

## Commands it adds
- `/experiments` — summarize the ledger.
- `/experiments <idea>` — show that idea's rows and latest kill status. An idea literally named `open` is shadowed by the subcommand below.
- `/experiments open` — preregs waiting on a verdict, oldest first, with age.
- `/experiments open all` — also acked and done ones (with their verdict).
- `/experiments open ack <slug|tag>` / `open unack <slug|tag>` — hide or restore one. The exact name, or any unique ending of it (`62_A1`); an ambiguous ending lists the candidates.

## Files it reads and writes
- **Reads:** `~/Trading/_ledger/experiments.jsonl` (or `$VERDICT_LEDGER`) and, when the ledger is absent, `~/.claude/verdict/policy.json` (or `$VERDICT_POLICY`); prereg files and `verdict.json` under `~/Trading` and `~/propfarm-2026`.
- **Writes:** nothing on disk. Acked names are kept in the plugin store (`acked`).

## When it runs (hooks/events)
- `session.start`: registers `/experiments`; refreshes the band 50 ms later and every 30 minutes.
- `command.run` for `/experiments`: reads/parses the ledger and returns the requested summary or idea report; `open ...` rescans and refreshes the band.
- `ui.render` for `AbovePrompt`: shows `prereg: 3 waiting on a verdict, oldest 21d (v54). /experiments open` when an unacked pending prereg is 7+ days old (yellow, red from 30 days). Hidden while a survey is up.

## How to turn it off
- `claude plugin disable experiment-ledger@shon-mods`, or set `"experiment-ledger@shon-mods": false` in `~/.claude/settings.json` -> `enabledPlugins`. It is listed in `enabledPlugins` (checked 2026-10-29).

## How to test it
```
claude plugin test ./experiment-ledger
```
