# health-band

## What it does
Shows a band above the prompt with two parts:
- **Gauges (always drawn):** `LSE 312/15000` (requests in `~/.lse_calls.log` dated today, local time; yellow above 10,000, red above 14,000) · helper-agent jobs started today or still running, from the dispatch.sh logs (`Codex ok 2 · Cline running 1 · opencode failed 1`) · `overhead ~91.3k tok/turn`, the fixed per-turn context of plugin skills/commands/agents (the `/profile measure` count) plus `~/.claude/skills`, at ~4 characters a token. A gauge whose source can't be read shows "unavailable".
- **Issues (only when checks find problems):** API credit errors in launchd logs, a missing/rejected LSE key, stale/unreadable live feeds, stale/non-zero forward jobs, a missed Claude desktop scheduled task, or a failed/missed secondbrain, autorank or youtube launchd job (the watchdog), the LSE v2 shutdown (410), forward-job data that stopped arriving. Hide hides the issue rows until a red condition worsens; the gauges stay.

It draws no context or 5-hour usage item (the app bar shows those) and no weekly reset countdown. Bands of other mods beneath it still draw.

## Watchdog (scheduled tasks and launchd jobs)
- **Scheduled tasks:** a cron task is red when its `lastRunAt` is older than its latest due time (15 minute grace for app jitter, 2 minute slack; a task created after the due time is not blamed). A one-time `fireAt` task that is more than 30 minutes past due and never ran is amber.
- **launchd jobs** matching `watchdog_regex` (default secondbrain, propfarm, autorank, youtube), minus labels already covered by `label_regex` (the forward pane): red when not loaded, last exit non-zero while not running (with the last error line from its logs), a stopped daemon, a missed calendar or interval run, or a stale success marker. `success_markers` names the file whose mtime is the job's last success (for `com.autorank.backup` the `.log`, because its `.err` is rewritten on every failed run). `known_issues` turns a job's red row into one amber row with your text, only while the job is unhealthy.
- **Cannot detect:** a FAILED scheduled-task run (the app stores only `lastRunAt`, no status) and DST edge cases. A task only fires while the desktop app is open, so a closed laptop shows as a missed run: correct, but noisy.
- These issues appear in the brain-sync pane and `/healthband`, not in the band.

## Backup and sign-in checks (`scripts/creds.py`)
- **AutoRank backup:** red when the newest `backed up` stamp in `~/Library/Logs/autorank-backup.log` is older than 36 h (the stamp is read from the line, not the file mtime), with the last useful `.err` line and the `known_issues` fix text (Full Disk Access). No log is red; a log with no `backed up` line is amber. The watchdog skips this label (`skip_labels`) so it is not reported twice.
- **Headless Claude token** (`~/second-brain/secrets/claude_oauth_token`): the file is only `stat()`ed, never opened. Missing or empty is red. Age against `valid_days` (365, an ASSUMPTION for `claude setup-token`, not verified) is amber `warn_days` (30) before and red after, always labelled estimated. The real signal is `scan_logs` (`cron.log`, the agent-pipeline logs) modified in the last 24 h: lines with `authentication_error`, `OAuth token has expired`, `invalid x-api-key`, `Invalid bearer`, `API Error: 401` or `Please run /login` are red and name the file, never the line. Agent logs that quote such text (for example while editing this check) can false-positive.
- **Interactive login expiry: unsupported.** It lives in the macOS keychain item `Claude Code-credentials` and reading it needs a keychain prompt.
- **YouTube Google sign-in:** `credentials/token.json` missing is amber (known: sign-in owed). The token's own `expiry` is the access token and refreshes itself, so it is never warned on. `invalid_grant`, `Token has been expired or revoked` or `RefreshError` in `launchd.log` within 48 h is red. A token.json older than 6 days with no `LIVE: https://youtu.be/` line in the log is amber: a consent screen left in Testing mode kills refresh tokens after 7 days.
- Reads (stat/log text only): the backup `.log`/`.err`, the token file's size and mtime, the configured scan logs, `~/youtube_automation/credentials/token.json` (mtime only) and `logs/launchd.log`. Writes nothing.

## Forward-data gap alarm (`scripts/dataflow.py`, `lse-gone`, push)
- **`lse-gone` (red, always listed first):** a `[410]` / "new documentation" line in a job log (plist StandardOut/Err) or in `extra_logs` (default: claude4b's `plans/run.log`) means LSE API v2 is retired. One row, `LSE API v2 retired (HTTP 410): v3 port needed (see .../LSE_V3_MIGRATION.md)`, lists the logs hit and any forward job whose error text carries the 410 under `affects` (those job rows are folded into it). The 429 daily-limit row stays amber. Every log check now ignores a line stamped older than `log_window_hours`, so a log touched today no longer repeats last week's error.
- **Forward job rows** now end with the job's last error line (`last exit 1: ...`).
- **Data flow (`data_flow` in `health.json`):** a job that exits 0 can still write nothing. Each item is `mtime_glob` (newest file), `parquet_ts` (newest bar), `json_field` (a timestamp field) or `log_match` (a pattern stamped within `within_hours`), with `max_lag_business_days` (Mon-Fri days after the source date; weekends skipped, **exchange holidays are not modelled**) or `max_lag_days`. Red when stale, amber when the source is missing or unreadable. Configured: livepractice (`data/live/*_live.parquet`, 3 business days, the limit `live_fetch.py` enforces itself), ticks (`of_NQ.F_1m.parquet` newest bar, 10 days for a weekly Monday job), oftick (`out/status.json` `updated`, 2 business days; `ledger.csv` only changes on trades), claude4b (`context build failed` in `plans/run.log`, 48 h).
- **Push:** a red issue that was not red on the previous good check raises one `$.ui.notify` (title `health-band`). Digits are ignored when comparing, so "12 days behind" then "13 days behind" is the same issue. The first check after a restart only records what is already red. A refused or failed notification is swallowed; the report still updates. Amber issues never notify.
- Live-run feed paths can change after the LSE v3 port: edit `data_flow` / `extra_logs`, no code change.

## Commands it adds
- `/healthband` — rerun all checks, show every issue, and unhide the band.

## Files it reads and writes
- **Reads:** this plugin's `health.json`, matching `~/Library/LaunchAgents/*.plist` and their log tails, `~/.lse_key`, `~/.lse_calls.log`, `~/Trading/_scratch/agent-pipeline/logs/<agent>-<date>-<time>-<pid>.log`, configured feed files, forward-job configuration/state through `forward_status.py`, the desktop app's `~/Library/Application Support/Claude/claude-code-sessions/*/*/scheduled-tasks.json` and the plists, `launchctl list` output and log mtimes of the watchdog's jobs (`scripts/watchdog.py`, `scripts/cron_due.py`), and the profile mod's `profile.py measure` plus `~/.claude/skills/*/SKILL.md` for the overhead gauge.
- **Writes:** nothing on disk.

## When it runs (hooks/events)
- `session.start`: registers `/healthband`, schedules an initial check, then checks every five minutes.
- `command.run` for `/healthband`: reruns the checks.
- `ui.render` for `AbovePrompt`: renders issues with Recheck and Hide, then the gauge row, then whatever band sits beneath.

## How to turn it off
- `claude plugin disable health-band@shon-mods`, or set `"health-band@shon-mods": false` in `~/.claude/settings.json` → `enabledPlugins`. It is enabled as of 2026-10-22.

## How to test it
```
claude plugin test ./health-band
python3 -m unittest discover -s ./health-band/scripts
```
