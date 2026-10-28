# leak-lint

## What it does
After a Write, Edit or MultiEdit to a `.py` file inside a trading repo succeeds, it scans the newly written text for lookahead patterns (for example `shift(-N)`, forward indexing, fills at the signal bar's close, future-window aggregates, `bfill`, `center=True`, full-sample z-score, quantiles or scaler fits).
If it finds any, it shows a toast and adds a warning note to the tool result for the model. It **never blocks** anything.

## Commands it adds
None.

## Files it reads and writes
- **Reads:** the folder listing of `~/Trading` (`$.fs.list`) and `stat` of each symlink in it to find the real repo paths. Trading roots = `~/Trading`, every resolved link in `~/Trading`, plus `~/mnq-mgc-research`, `~/strategy_lab`, `~/nq_bot`, `~/scriv_recreate`, `~/propfarm-2026`, `~/prop_farm` (`EXTRA_ROOTS` in `hooks/lib.ts`). The root list is cached in memory for the session.
- **Scans:** only the text in the tool call (`content` for Write, `new_string` for Edit, every `edits[].new_string` for MultiEdit). It does not read the file from disk.
- **Writes:** nothing on disk.
- Paths are matched case-insensitively and must end in `.py`.
- Skipped: comment lines, triple-quoted docstrings, and any line with `# leak-ok`.

## When it runs (hooks/events)
- `session.start`: resolves and caches the trading roots.
- `tool.call` (all tools; only Write / Edit / MultiEdit are handled): runs **after** the tool. If the tool was denied or errored it does nothing. On findings it shows a `$.ui.toast` and appends a `context` report.
- Each hook has a `.catch` that passes the call through unchanged, so if leak-lint fails, the tool call is unaffected.

## How to turn it off
- `claude plugin disable leak-lint@shon-mods`, or set `"leak-lint@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. It is enabled as of 2026-10-22.
- To silence a single reviewed line, add `# leak-ok`.

## How to test it
```
claude plugin test ./leak-lint
```
(21 tests in `hooks/leak-lint.test.ts`: positive/negative pattern cases, the path filter, and an end-to-end tool.call.)
