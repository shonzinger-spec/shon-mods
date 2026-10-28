# output-cap

## What it does
When a Bash command's stdout or stderr is longer than 150 lines, Claude reads only the first 75 and last 75 lines with a note in between: `… N lines cut by output-cap (kept the first 75 and last 75 of M; next time pipe the command through grep, head or tail to see the part you need) …`. stdout and stderr share the one 150-line budget: a stream that fits in half of it is kept whole and the other gets the rest. An errored result (non-zero exit) is capped the same way and still reaches Claude as an error. The command itself runs unchanged.

Left alone: results at or under the cap, image output, and background-task handles.

## Commands it adds
None.

## Files it reads and writes
- **Reads:** plugin setting `max_lines` (default 150) from `pluginConfigs["output-cap@shon-mods"].options` in `~/.claude/settings.json`.
- **Writes:** nothing.

## When it runs (hooks/events)
- `tool.call` for `Bash`: after the command answers, shortens its stdout/stderr, or its error text (returned as a deny, which Claude reads as the error result).

## How to turn it off
`claude plugin disable output-cap@shon-mods`, or set `"output-cap@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`.

## How to test it
```
claude plugin test ./output-cap
```
