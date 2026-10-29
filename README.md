# shon-mods

Claude Code mods (hooks-module plugins) that Shon Zinger built for his own setup: futures research hygiene, prop-firm forward tests, AutoRank outreach, and usage/effort control. This repository is a plugin marketplace: install any mod by name.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install <mod> --marketplace shonzinger-spec/shon-mods
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```bash
claude plugin install <mod> --marketplace shonzinger-spec/shon-mods
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `shonzinger-spec/shon-mods`, then Add plugin.

## Mods

| Mod | What it does |
| --- | --- |
| `leak-lint` | Warns when trading code introduces lookahead patterns |
| `kill-ledger` | Flags prompts that name a strategy the memory already killed |
| `bad-data` | Toasts when a call touches a known-defective data file |
| `forward-pane` | /forward: pane of live launchd forward-test jobs |
| `prereg` | /prereg with SHA256, and a lock on pre-registrations once results exist |
| `profile` | /profile: switch which plugin set loads next session (trading/business/coding/all) |
| `health-band` | Red/amber band for API credit errors, LSE key, stale feeds and jobs |
| `autorank-pane` | /autorank: follow-ups due, first touches, replies and leads |
| `folder-guard` | Refuses new files loose in ~, ~/Desktop, ~/Documents |
| `verdict-line` | Status line with the current test's PF, t, p and PASS/FAIL |
| `cost-gate` | Warns when trading code sets zero or below-measured costs; /costs |
| `variant-counter` | /variants per idea from the experiment ledger; toast past 20 variants |
| `holdout-vault` | Seals confirmed holdout files: read-only, opening one asks and logs a burn |
| `null-first` | /nulls; toast when a verdict has no null test that lost |
| `claim-check` | Toasts PF/Sharpe/win-rate/t numbers in a reply that no tool output backs; /claims |
| `experiment-ledger` | /experiments: every write_verdict() run, per idea, with kill status |
| `long-run` | Sends long backtests to the background and notifies when they finish |
| `data-index` | /dataindex and /data: index of every bar file with range, gaps, roll method, defects |
| `cost-band` | Session $ and cache ratio in the status line; band at 80%/100% of the limit |
| `sharpen` | Turns a rough idea into a full brief before Claude works (auto for 15+ words, ++ to force, -- to skip, /sharpen for other AIs) |
| `effort-router` | Picks effort and ultracode per prompt (Haiku + calibration, keyword fallback); !low..!max, !ultra, !solo overrides |
| `output-cap` | Bash results over 150 lines: Claude reads the first and last 75 with a note of how many were cut |
| `paste-dedupe` | A paste repeated from an earlier prompt this session is sent as "same as message N" |
| `usage-coach` | Weekly-limit coach: status line, pace band, /budget, /next and a task queue with measured cost per task |
| `memory-guard` | Memory meter in the prompt footer, warn/critical band with Not now / Let Claude clean it (graceful quit only, after a confirm), /mem lists top users by app, chat and MCP server |
| `needs-you` | /needs-you: pane of open chats that are stalled, waiting on you (with the question), or done |
| `friction-review` | Weekly report of what keeps going wrong in your sessions; amber band while unread, /friction for the top patterns |
| `one-chat-guard` | Band when a new chat looks like the same task as an open chat; offers to open that one |
| `brain-sync` | /brain: pane showing whether every chat is saved to the second brain; reruns failed saves |

Each mod has its own README with what it reads, writes and how to test it.

## Notes

- Many mods are tuned to the author's folder layout (`~/Trading`, `~/.claude/mods-src`, `~/AutoRank-Business`) and read config files you will want to edit: `bad-data/bad-data.json`, `health-band/health.json`, `forward-pane/jobs.json`, `holdout-vault/vault.json`, `kill-ledger/vocab.json`, `profile/profiles.json`, `usage-coach/config.json`.
- `sharpen/context.md` and `usage-coach/tasks.md` are templates: fill in your own.
- `kill-ledger` builds `data/kill_index.json` from your Claude memory folder at session start.
- Test a mod with `claude plugin test ./<mod>` (and `python3 -m unittest discover -s ./<mod>/scripts -p 'test_*.py'` where it has Python scripts).

## Credits

Written by Shon Zinger. Claude (Anthropic's Claude Code) assisted with implementing the hooks modules, tests and READMEs.
