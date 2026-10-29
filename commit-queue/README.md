# commit-queue

## What it does
Watches the git repos listed in `config.json` and shows one dim yellow line above the prompt when work is waiting:
`12 changes waiting for review in 3 repos (7 groups) - /review-commits`. Nothing is drawn when nothing is waiting.
`/review-commits` lets you review that work one group at a time and commit a group only after you answer **Commit** to a question asked in that same command run. A group is the repo plus the first path segment (for mods-src: `health-band`, `kill-ledger`, ...; files at the repo root are group `(root)`; group id is `<repo>:<group>`).

## Commands it adds
- `/review-commits` - rescan and list groups per repo: branch, files, +/-, withheld count.
- `/review-commits stat <id>` - one line per file with its git status and +/-. Stats only, never diff bodies, so nothing from your files lands in the transcript.
- `/review-commits commit [id]` - for each group (or just `<id>`), asks `Commit <id> on <branch>: N files +a/-d as <name>? Withheld: ...` with **Commit / Skip / Edit message**. Only the exact label **Commit** commits. Anything else, no answer, or a dismissed dialog is a skip. **Edit message** asks again: type your own message under Other, or pick "Use the default".

## Safety rules (enforced in scripts/commit_queue.py, covered by tests)
- Commits are authored and committed as you. Identity: the repo's own `user.name/user.email` if real (not empty, not "Your Name", not example.com), else `identity` in `config.json`, else the commit aborts. Never guessed. No `Co-Authored-By` trailer; a message containing one is refused.
- Never runs push, reset, checkout, stash, rebase, `--amend` or `--no-verify`. It does `git add` of the group's allowed files and one pathspec commit, so other staged files are left exactly as they are. The branch is whatever the repo is on (shown in the table).
- Withheld, never staged, listed so you commit them by hand: file names matching `.env*`, `*.pem`, `*.p12`, `id_rsa*`, `*.key`, `*key*`, `*secret*`, `*token*`, `credentials*`, `*.keystore`; files over `max_file_mb`; files with an added line holding `sk-ant-`, an AWS access key id, a private-key header, or `api_key = <16+ chars>`; directories (nested repos); files it ran out of time to scan. False positives are accepted (`keyboard-notes.md` is withheld).
- Before committing it rescans and refuses if the group changed since the question was built (hash of file list, status and +/- counts), e.g. another session edited the repo while you decided.
- Repos with more than 5000 changed entries are not committed from here.

## Things to know
- `git commit` here runs through the Python script, so the repo's own pre-commit hooks DO run (unlike a plain `git` call from a mod, which runs hooks off). A hook that adds a trailer is reported but not undone (no amend).
- The band counts every change in these repos, whoever made it: it cannot tell Claude-written edits from yours.
- A staged rename commits only the new path; the old path's deletion stays staged for you to commit.
- Large untracked data folders can slow a scan; each repo is capped at 20 s and 5000 entries (past that the repo is flagged "too many changes").
- Output of `stat` and the table contain file names only.

## Files it reads and writes
- **Reads:** the repos in `config.json` through `git status`, `git diff`, `git config` (read-only, `--no-optional-locks`), and untracked files' text to count lines and check for secrets.
- **Writes:** only what a confirmed commit writes into the repo's own `.git`. Nothing else on disk.

## When it runs (hooks/events)
- `session.start`: registers `/review-commits`, first scan after 50 ms, then every `interval_min` minutes.
- `ui.render` on `AbovePrompt`: the band (amber text if the scan fails).
- `command.run` for `/review-commits`.

## config.json
`repos` (missing or non-repo paths are skipped silently; duplicates by `samefile`, so `~/AutoRank` and `~/autorank` count once), `max_file_mb` (2), `interval_min` (10), `identity` (`name`, `email`).

## How to turn it off
`claude plugin disable commit-queue@shon-mods`, or set `"commit-queue@shon-mods": false` in `~/.claude/settings.json` -> `enabledPlugins`.

## How to test it
```
claude plugin test <path>/commit-queue
python3 -m unittest discover -s <path>/commit-queue/scripts
```
Python tests build throwaway repos in a temp dir; they never touch a real repo.
