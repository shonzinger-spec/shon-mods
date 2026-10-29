# read-once

## What it does
Refuses a whole-file `Read` of a file this session already read in full and that has not changed since (same mtime and size). The reason Claude sees: `read-once: <path> is unchanged since last read at turn N; use the earlier content, or pass offset/limit to re-read a range`. The Read tool does not run, so the file's text is not paid for twice.

Always allowed:
- reads with `offset`, `limit` or `pages`
- a file whose mtime or size differs from the earlier read
- images, PDFs and notebooks (`.png .jpg .jpeg .gif .webp .pdf .ipynb`), and any read whose result was not plain text or was cut by the token cap (these are never remembered)
- a file after a `Write`, `Edit`, `MultiEdit` or `NotebookEdit` to that path in this session (its entry is dropped)
- everything after the conversation compacts (the whole ledger is cleared, since the earlier text may be gone from context)

Decisions: state is kept per context, so a subagent has its own ledger and is never denied for what the main conversation read; a subagent's compaction clears only its own. A `precompute` compaction also clears the ledger (its result can be installed later without a second event), a vetoed one (`skip`) does not. Over-clearing only costs a re-read.

## Commands it adds
None.

## Files it reads and writes
- **Reads:** `stat` (mtime, size) of the file being Read, via `$.fs.stat`. Never the file's content.
- **Writes:** nothing. State is in memory for the session and starts empty after a mod reload or restart.

## When it runs (hooks/events)
- `tool.call` (all tools; Read and Write / Edit / MultiEdit / NotebookEdit are handled): before a Read it may deny; after a Read succeeds it records the path with its stat and the turn; on a writer tool it forgets the path.
- `session.compact`: after the compaction is not vetoed, clears the ledger.
- Both hooks have a `.catch` that passes the call through unchanged, and all bookkeeping sits in try/catch, so a fault (for example a failing `stat`) lets the Read run. The mod can never break a tool call.

## How to turn it off
`claude plugin disable read-once@shon-mods`, or set `"read-once@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`.

## How to test it
```
claude plugin test ./read-once
```
(12 tests in `hooks/read-once.test.ts`: the deny with turn number, ranged reads, mtime/size change, images/PDFs/notebooks, non-text and truncated results, the four writer tools, compaction and a vetoed compaction, subagent isolation, fail-open on a throwing stat.)
