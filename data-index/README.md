# data-index

## What it does
Builds a cached index of `.parquet` and `.csv` bar files under `~/Trading` (plus configured roots): symbol, timeframe, coverage, rows, market-hours gaps, roll label, and known bad-data flags. It can then search that index from Claude.

## Commands it adds
- `/dataindex` — start an index rebuild in the background.
- `/data <symbol|tf|text>` — search the current index.

## Files it reads and writes
- **Reads:** discovered bar-file metadata/timestamp columns, `data-index.json` configuration, the prior `~/Trading/_data/index.json` cache, and `bad-data/bad-data.json`.
- **Writes:** `~/Trading/_data/index.json` and a slim `index.lookup.json` beside it (only the fields `/data` shows, so it stays under the mod API's 4 MiB read limit), both compact JSON written atomically; no source bar files are modified.

## When it runs (hooks/events)
- `session.start`: registers `/dataindex` and `/data`.
- `command.run` for `/dataindex`: launches `build_data_index.py` (up to 540 seconds) and toasts its summary when finished.
- `command.run` for `/data`: reads and queries the current index.

## How to turn it off
- `claude plugin disable data-index@shon-mods`, or set `"data-index@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. It is not enabled as of 2026-10-22 (no `enabledPlugins` entry).

## How to test it
```
claude plugin test ./data-index
```
