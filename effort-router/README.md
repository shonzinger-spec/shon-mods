# effort-router

Picks the effort level (low, medium, high, xhigh, max) and whether to use ultracode for every prompt you type, so small asks stay cheap and hard ones get the thinking.

**How it decides.** Thanks and similar get low. Everything else goes to Haiku, which reads your request plus the last reply. xhigh stays only with a stakes cue (real money, live account, security, irreversible) or a long, detailed request. "continue", "can we please continue" and "do it" never drop below medium or the last job's level. A short hand-off ("lets do it in a new session", "continue this in another chat") runs at its own level, with no floor and no ultracode, since the turn only writes the hand-off. If Haiku is off or slow, keyword rules from `config.json` decide.

**Ultracode.** For a big multi-part job (Haiku says so, or you write things like "all of the strats" or "go through everything we've done" in a request of up to 200 words; the same words inside a long pasted handoff don't count), the router adds a note that opts that turn into a multi-agent workflow. When ultracode is on only as the session's default, small requests get a "work solo" note instead. Ultracode you switch on mid-session is left alone. The engine only accepts the ultracode keyword from you, so the note is how the mod does it.

**Your controls.** Start a prompt with `!low` `!med` `!high` (or `!hard`) `!xhigh` `!max`, or with `!ultra` / `!solo`; they combine (`!high !solo`). If you change effort mid-session (picker or `/effort`), routing pauses until you set it back. `/effort-router` shows the last decision; `/effort-router off|on` switches routing off or on. The status line under the prompt shows `effort: <level> · <why>`. Each decision is also written to `state/now-<session>.json` for the hud mod.

**Measured** on 225 of your real prompts (two Sonnet labelers, Opus settling disagreements): tuned on 145 (the first 120 plus 25 typed on 2026-10-27), checked on the same 80 held out. Held-out: 60.0% exact (v2: 60%, v1: 51%), 96.3% within one level (v2: 96%, v1: 89%), 1.3% two or more levels too low (v2: 1.3%, v1: 7.5%). Ultracode: precision 0.63, recall 0.56 (v2: 0.63, 0.56; v1: 0.27, 0.44). While tuning, re-score with `node eval/score.mjs --split tune`; the plain command also prints the held-out lines, so look at those once per change.

Install: `/plugin install effort-router@shon-mods` (enabled in settings.json already); after an edit, `/reload-plugins`. Tests: `claude plugin test ~/.claude/mods-src/effort-router`.
