# kill-ledger

## What it does
Matches user-authored prompts against strategy verdicts indexed from Claude memory and the experiment ledger. For a killed, caution, or live-forward-test match, it toasts and gives Claude the prior reason/file, asking for a new pre-registered spec before retrying.


Matching: a generic name from `vocab.json` (a `?` term such as `momentum`, `overnight`, `James`) counts only when the prompt also has a trading word (NQ, futures, backtest, strategy...): "is momentum dead on NQ futures?" fires, "ask James about lunch" does not. A strict generic name (`?!`: `sweep`, `carry`) also counts only inside a strategy name: a trading word or another strategy word right before it ("futures carry", "overnight carry"), a strategy noun right after it, possessive allowed ("carry strategy", "sweep's entries"), or `on`/`for` plus a market right after it ("carry on ZN", "sweep for MNQ"). "Parameter sweep on the NQ strategy" or "carry on with the backtest" never fire.

Pasted data is cut before matching: fenced and inline code; lines that are clearly code or logs (indented, starting with a timestamp or log level, source in its own syntax such as `const x =`, `def f(`, `import x from`, tracebacks); and lines that only look like data (shell or REPL prompt, a line ending in `;`, `{` or `}`, JSON, table rows) when two or more of them stand together. A one-line prompt is never cut, so "let me retest the ORB on NQ" or "[1] retest ORB" still fire, and a pasted log naming a strategy raises nothing.
## Commands it adds
- `/kills <strategy name>` — look up matching indexed verdicts.

## Files it reads and writes
- **Reads:** `~/.claude/projects/-Users-shonzinger/memory/MEMORY.md`, linked memory topic files, this plugin's `vocab.json`, `~/Trading/_ledger/experiments.jsonl` when present, and `data/kill_index.json`.
- **Writes:** `data/kill_index.json` when it rebuilds the index on session start or `/kills`; nothing outside the plugin directory.

## When it runs (hooks/events)
- `session.start`: registers `/kills` and rebuilds/loads the index.
- `prompt.submit`: checks ordinary user prompts (not commands, meta, or injected/system-origin text); each matched file is raised once per session.
- `command.run` for `/kills`: rebuilds/loads the index and reports matches.

## How to turn it off
- `claude plugin disable kill-ledger@shon-mods`, or set `"kill-ledger@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. It is enabled as of 2026-10-22.

## How to test it
```
claude plugin test ./kill-ledger
```
