# usage-coach

## What it does
Coaches use of the Pro-plan weekly limit. Informs only; never blocks anything.
- Status line: `wk 53% · 5.7d · ~8.2%/day` (weekly used, days to reset, daily allowance = remaining % ÷ days left).
- Amber band above the prompt when today's spend beats the daily allowance, or more than 3 sessions ran in the last 15 minutes.
- A task queue (`tasks.md`) with a size, value and estimated cost per task; `/next` ranks open tasks by value per estimated %, and drops those that do not fit what is left of the week minus a 5% reserve.
- Logs plugin/skill/agent/connector use to `state/tool-log.jsonl`.

**Every % here is an estimate, and it shows its basis:** `prior` (the size's default guess), `measured n=k` (median of k finished tasks of the same section and size, used from k >= 3), or `set` (an explicit `| est <n>%` on the task line, which always wins).

**Calibration** (% of the week per $ of session cost): each time the weekly % rises by at least 2 points, one ratio is weekly rise ÷ total session $ added across all sessions in that interval. The median of ratios from the last 14 days is used, once there are 3. Until then it says "calibrating". Biases: it only sees chats that run the mod (other chats' usage inflates the ratio), other devices, claude.ai web use and resumed sessions all move the weekly % without matching $ here, and a week reset restarts the interval.

**Task line format** in `tasks.md`:
`- [ ] <section> | <task> | <S|M|L|XL> | value <1-5>` plus optional `| est <n>%`. Size priors: S 0.5%, M 2%, L 5%, XL 12% of the week. Lines that do not parse are ignored; section aliases (e.g. `agent stuff` becomes `agent`) come from `config.json`.

**Section detection order:** the sidebar group name via `ccd_session_mgmt get_session` (desktop app); else a name set with `/section <name>`; else keyword match of the cwd and first prompt against `config.json` keywords.

## Commands it adds
- `/budget`: weekly used, reset, allowance, spent today, parallel sessions, calibration, open tasks per section and whether they fit.
- `/next`: top 3 open tasks that fit, with estimate and basis.
- `/task start <n>`: mark the start of task n (records the cost so far).
- `/done [n]`: finish a task, record what it cost, toast the next pick.
- `/section [name]`: show or set this session's section.

## Files it reads and writes
- **Reads:** `tasks.md`, `config.json` (aliases, keywords, priors, reserve, thresholds), Claude's session usage (rate limits, cost), the sidebar session record.
- **Writes** in the data dir `~/.claude/mods-src/usage-coach/state/` (gitignored): `samples.jsonl` (weekly %, cost per session over time), `task-starts.jsonl`, `task-history.jsonl`, `tool-log.jsonl`; and `tasks.md` (`/done` ticks the box).
- `tool-log.jsonl` is read by the profile mod's `/profile learn` and `auto` to build profiles for new sections.

## When it runs (hooks/events)
- `session.start`: registers commands, detects the section, refreshes.
- `prompt.submit`: keeps the first prompt for keyword detection.
- `tool.call`: appends plugin/skill/agent/connector calls to the tool log; on `wrap_up`, toasts the next pick.
- `turn.complete`: samples usage and refreshes the status line.
- `ui.render` for `AbovePrompt`: the amber band.
- `command.run`: the five commands above.

## How to turn it off
`claude plugin disable usage-coach@shon-mods`, or set `"usage-coach@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. Delete `state/` to drop its history.

## How to test it
```
claude plugin test ./usage-coach
```
Runs the unit tests of the pure logic (`hooks/lib.test.ts`) and the smoke tests (`hooks/register.smoke.test.tsx`).
