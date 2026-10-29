# conductor

Routes each subagent's model and effort by task class, and guards messages between Claude Code sessions.

## Routing
- Every spawn (Agent tool and workflow scripts, via `agent.spawn`) is classified from its agent type and description (`routes.default.json`; override with `~/.claude/conductor/routes.json`).
- Raises are applied; subagent effort `max` is capped at `xhigh`; models or efforts the caller set are kept; forks are never touched.
- Lowerings apply only to checked classes (a failing test/build moves the next spawn of that task up one tier) or to classes promoted by calibration.
- `/conductor main auto` caps the main session's `max` effort at `xhigh` (off by default); the band shows each switch.

## Messages between sessions
- SendMessage only; ccd `send_message` is blocked (it looks like a message from you).
- Send guards: more than 4 hops, the same text twice, 6 sends to one target in 10 minutes (then a 5-minute pause), 20 sends an hour, sending to itself.
- Receive caps: 10 peer messages an hour, 40 a day, $25 a day of turns (and their subagents) started by peers. Over a cap the message is held and logged.
- Every delivered peer message is marked as data, not your instructions.
- A send to a session this one started in auto or bypassPermissions mode needs `/conductor ask` first (one send, 10 minutes).

## Commands
`/conductor status | why | on | off | ask | session <class> <text> | pane [routes|bus] | calibrate on|off | main auto|off`

`/conductor session` starts a session at or below opus/high; xhigh classes are refused (run them as subagents).

## Data
`~/.claude/conductor/`: `ledger/` (routes and token usage per session), `bus/` (messages per session), `state.json` and `evals.jsonl` (calibration, off by default).

## Known limits
- The hop count comes from the envelope the sender adds; a sender without this mod sends no envelope, so only the rate caps limit it.
- Daily caps restart if the mod reloads after midnight UTC.
- A `wake_when_done` completion is matched to the next background notification, not to the session that finished.
- The calibration judge sees both outputs and the task prompt, not the source files.
