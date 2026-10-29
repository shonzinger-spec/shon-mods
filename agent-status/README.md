# agent-status

Shows, at a glance, whether the external coding agents (opencode, opencode-glm, codex, cline, copilot, amp, atlarix) and the nightly Claude headless login work, which model each one uses, and why not when it does not.

## What it shows
- **Pane "Coding agents"**: header "6 of 8 working" with a dotted, glowing segmented bar (one segment per agent, count glides when it changes). One row per agent: pulsing status dot (green soft pulse = works, red = down, grey = unknown/disabled), name, model chip (e.g. `[DeepSeek V4.1 Flash (free)]`), `Works: Yes / No / Unknown`, short reason, last run / checked time, and the fallback chain as a muted line. Buttons per row: **Recheck** (live ping of that agent, spinner while it runs) and, only when the script offers a `user_fix`, the fix button with its label. Bottom: **Model switches**, newest first.
- **Band above the prompt**, only when something needs you: an agent down with a `user_fix` ("atlarix needs you: Sign in" + button) or a context event in the last 30 minutes ("opencode ran out of context on ..., switching to ..."). Dismiss hides exactly what is showing now; anything new brings it back.
- **Toasts**: once when an agent goes from works to down, once per new context-switch event (seen ids kept in the mod store).

## How it checks
`python3 <script> --json` at session start and every 5 minutes, in the background. A failing or slow script shows a quiet `health check failed: <reason>` line and keeps the last data; it never blocks the prompt. `--ping <id>` (live, up to 60 s, paid lanes) runs only when you press Recheck. Fix buttons: a `command` opens macOS Terminal running exactly that command (osascript, passed as argv with quotes escaped; no shell in between), a `url` opens in the browser (http/https only).

## Commands
`/agent-status` opens the pane (and rechecks). `/coders` is an alias (registered as a second command; the platform has no alias field).

## Config
`config.json` beside the hooks folder:
```json
{ "script": "", "intervalMinutes": 5, "eventMinutes": 30 }
```
Contract of the script's JSON: `{checked_at, agents:[{id,name,model,model_label,works,state,reason,user_fix,last_run,fallback,checked}], events:[{at,lane,kind,from,to,text}]}`.

## Tests
`claude plugin test agent-status`

Bundled checker: `scripts/agent_health.py` with lane list `scripts/lanes.json` (Codex, Cline, opencode, Copilot, Amp and others). Leave `script` empty to use it, or point it at your own. Optional env: `DISPATCH_LANES_JSON`, `DISPATCH_LOG_DIR` (default `scripts/logs`).
