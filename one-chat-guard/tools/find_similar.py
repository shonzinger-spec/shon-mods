#!/usr/bin/env python3
"""Read-only: find open desktop chats that look like the same task as a new chat.

Reads the app's per-chat files and, for open chats in the same folder, the first real
user message from the chat's transcript. Only the content words of that message are cached
(state/firstprompts.json); nothing is printed except chat titles and ids. Writes only the cache.

  find_similar.py --cwd DIR --prompt-file F|- [--self-id ID] [--self-cli ID] [--title T]
                  [--min-jaccard X] [--ignore-title T ...]       -> {"matches": [...]}
  find_similar.py --dry-run                                      -> every open chat vs the rest
"""
import argparse
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from match import content_words, match  # noqa: E402

HOME = os.path.expanduser('~')
APP_ROOT = os.path.join(HOME, 'Library/Application Support/Claude/claude-code-sessions')
PROJECTS = os.path.join(HOME, '.claude/projects')
STATE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'state')
MAX_LINES = 200


def load_chats(root):
    chats = []
    for path in glob.glob(os.path.join(root, '*', '*', 'local_*.json')):
        try:
            with open(path) as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        sid = d.get('sessionId')
        if not isinstance(sid, str):
            continue
        spawned = d.get('spawnedFrom')
        chats.append({
            'sessionId': sid,
            'cliSessionId': d.get('cliSessionId') if isinstance(d.get('cliSessionId'), str) else '',
            'title': d.get('title') if isinstance(d.get('title'), str) else '',
            'cwd': d.get('cwd') if isinstance(d.get('cwd'), str) else '',
            'lastActivityAt': int(d['lastActivityAt']) if isinstance(d.get('lastActivityAt'), (int, float)) else 0,
            'isArchived': bool(d.get('isArchived')),
            'spawnedFrom': spawned if isinstance(spawned, dict) else None,
            'scheduledTaskId': d.get('scheduledTaskId') or None,
        })
    return chats


def _text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return '\n'.join(b['text'] for b in content
                         if isinstance(b, dict) and b.get('type') == 'text' and isinstance(b.get('text'), str))
    return ''


_REMINDER = re.compile(r'<system-reminder>.*?</system-reminder>', re.S)
_PASTE_TAG = re.compile(r'</?pasted_content\b[^>]*>')


def _prompt_text(raw):
    """Drop system-reminder blocks, keep pasted bodies; '' when what is left is a wrapper (<command-...>)."""
    text = _PASTE_TAG.sub(' ', _REMINDER.sub(' ', raw)).strip()
    return '' if text.startswith('<') else text


def first_user_text(path):
    """First real user message in the first MAX_LINES lines ('' when none)."""
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            for i, line in enumerate(f):
                if i >= MAX_LINES:
                    break
                try:
                    obj = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(obj, dict) or obj.get('type') != 'user' or obj.get('isMeta'):
                    continue
                msg = obj.get('message')
                text = _prompt_text(_text_of(msg.get('content') if isinstance(msg, dict) else None))
                if text:
                    return text
    except OSError:
        pass
    return ''


class Prompts:
    """First-prompt words per chat, cached by cliSessionId + transcript mtime."""

    def __init__(self, projects_root, state_dir):
        self.projects_root = projects_root
        self.path = os.path.join(state_dir, 'firstprompts.json') if state_dir else None
        self.cache = {}
        self.dirty = False
        if self.path:
            try:
                with open(self.path) as f:
                    loaded = json.load(f)
                if isinstance(loaded, dict):
                    self.cache = loaded
            except (OSError, ValueError):
                pass

    def words(self, cli_id):
        if not cli_id:
            return ''
        hits = glob.glob(os.path.join(self.projects_root, '*', cli_id + '.jsonl'))
        if not hits:
            return ''
        try:
            mtime = os.path.getmtime(hits[0])
        except OSError:
            return ''
        hit = self.cache.get(cli_id)
        if isinstance(hit, dict) and hit.get('mtime') == mtime and isinstance(hit.get('words'), str):
            return hit['words']
        words = ' '.join(sorted(content_words(first_user_text(hits[0]))))
        self.cache[cli_id] = {'mtime': mtime, 'words': words}
        self.dirty = True
        return words

    def save(self):
        if not (self.path and self.dirty):
            return
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + '.tmp'
            with open(tmp, 'w') as f:
                json.dump(self.cache, f)
            os.replace(tmp, self.path)
        except OSError:
            pass


def norm_cwd(cwd):
    return (cwd or '').rstrip('/')


def with_prompts(chats, prompts, cwd=None):
    out = []
    for c in chats:
        d = dict(c)
        d['prompt'] = prompts.words(c['cliSessionId']) if cwd is None or norm_cwd(c['cwd']) == norm_cwd(cwd) else ''
        out.append(d)
    return out


def find(chats, prompts, cwd, prompt, title, self_ids, min_jaccard, ignore_titles, now_ms):
    me = next((c for c in chats if c['sessionId'] in self_ids or (c['cliSessionId'] and c['cliSessionId'] in self_ids)), None)
    new = {'sessionId': me['sessionId'] if me else '', 'title': title or (me['title'] if me else ''), 'cwd': cwd,
           'prompt': prompt, 'spawnedFrom': me['spawnedFrom'] if me else None}
    others = [c for c in chats if not c['isArchived'] and not c['scheduledTaskId'] and c is not me]
    return match(new, with_prompts(others, prompts, cwd), now_ms=now_ms, min_jaccard=min_jaccard,
                 ignore_titles=ignore_titles)


def dry_run(chats, prompts, min_jaccard, ignore_titles, now_ms):
    open_chats = [c for c in chats if not c['isArchived'] and not c['scheduledTaskId']]
    full = with_prompts(open_chats, prompts)
    lines = []
    for c in full:
        rest = [o for o in full if o is not c]
        for m in match(c, rest, now_ms=now_ms, min_jaccard=min_jaccard, ignore_titles=ignore_titles):
            lines.append('%s "%s"  ~  %s "%s"  (%s %.2f)' % (c['sessionId'][-8:], c['title'], m['sessionId'][-8:], m['title'], m['reason'], m['score']))
    return '\n'.join(lines) if lines else 'no matches among %d open chats' % len(open_chats)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--cwd', default='')
    ap.add_argument('--prompt-file', default='')
    ap.add_argument('--title', default='')
    ap.add_argument('--self-id', default='')
    ap.add_argument('--self-cli', default='')
    ap.add_argument('--min-jaccard', type=float, default=0.55)
    ap.add_argument('--ignore-title', action='append', default=[])
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--sessions-root', default=APP_ROOT)
    ap.add_argument('--projects-root', default=PROJECTS)
    ap.add_argument('--state-dir', default=STATE)
    ap.add_argument('--now-ms', type=int, default=0)
    a = ap.parse_args(argv)

    import time
    now_ms = a.now_ms or int(time.time() * 1000)
    chats = load_chats(a.sessions_root)
    prompts = Prompts(a.projects_root, a.state_dir)
    if a.dry_run:
        print(dry_run(chats, prompts, a.min_jaccard, a.ignore_title, now_ms))
    else:
        prompt = ''
        if a.prompt_file == '-':
            prompt = sys.stdin.read()
        elif a.prompt_file:
            with open(a.prompt_file, encoding='utf-8', errors='replace') as f:
                prompt = f.read()
        ids = {i for i in (a.self_id, a.self_cli) if i}
        found = find(chats, prompts, a.cwd, prompt, a.title, ids, a.min_jaccard, a.ignore_title, now_ms)
        print(json.dumps({'matches': found}))
    prompts.save()
    return 0


if __name__ == '__main__':
    sys.exit(main())
