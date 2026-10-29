#!/usr/bin/env python3
"""Is every Claude chat saved in the second brain? And if not, rerun the save.

A chat is SAVED when all three stages hold for its current transcript:
  1. backed up  - _raw/MANIFEST.tsv has the transcript's current sha256
  2. noted      - notes_state.json has that sha256 and the note file exists
  3. in Melxis  - melxis_sync/state.json has the note at status ok with the note's current hash
A chat still in use (idle < 6h and not archived in the app) is LIVE: the pipeline waits for it on
purpose. An idle chat that is not saved is FAILED. These are the same rules the nightly jobs use.

--heal reruns the existing launchd jobs (never new save logic): com.secondbrain.chatarchive for a
missing backup or note, then com.secondbrain.melxissync for a missing mel. One job at a time,
never while one runs, with backoff (now, +10, +20, +40, +80 min), then every 60 min until it lands:
it never gives up. The count resets when the failures shrink or new ones appear. Both jobs are idempotent (state files keyed by
chat), so a rerun never duplicates a note or a mel.

Reads the archive read-only. Writes only <archive>/monitor_state.json (hash cache + retry state).
  sync_status.py            one-line summary
  sync_status.py --json     full status as JSON (what the brain-sync pane reads)
  sync_status.py --heal     also rerun the save when something failed
"""
import argparse, fcntl, glob, hashlib, json, os, subprocess, sys, time
from datetime import datetime

HOME = os.path.expanduser('~')
IDLE = 6 * 3600
BACKOFF_MIN = [0, 10, 20, 40, 80]
CAP = 5          # fast tries; after these it keeps trying every SLOW_MIN, never stops
SLOW_MIN = 60
JOBS = {'archive': 'com.secondbrain.chatarchive', 'melxis': 'com.secondbrain.melxissync'}


def default_cfg():
    archive = os.environ.get('BRAIN_ARCHIVE', os.path.join(HOME, 'second-brain/archive/chats'))
    return {
        'archive': archive,
        'melxis_state': os.environ.get('BRAIN_MELXIS_STATE', os.path.join(HOME, 'second-brain/melxis_sync/state.json')),
        'transcript_globs': [
            os.path.join(HOME, '.claude/projects/*/*.jsonl'),
            os.path.join(HOME, 'Library/Application Support/Claude/local-agent-mode-sessions/*/*/local_*/.claude/projects/*/*.jsonl'),
        ],
        'meta_glob': os.path.join(HOME, 'Library/Application Support/Claude/claude-code-sessions/*/*/local_*.json'),
        'logs': {'archive': os.path.join(archive, 'sync.log'),
                 'melxis': os.path.join(HOME, 'second-brain/melxis_sync/logs/nightly.log')},
    }


def _json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def sha_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def note_hash(path):  # exactly how melxis_sync/sync.py hashes a note
    with open(path, encoding='utf-8', errors='replace') as f:
        return hashlib.sha256(f.read().encode()).hexdigest()


def load_manifest(archive):
    m = {}
    try:
        for line in open(os.path.join(archive, '_raw/MANIFEST.tsv'), encoding='utf-8'):
            parts = line.rstrip('\n').split('\t')
            if len(parts) >= 2:
                m[parts[0]] = parts[1]   # later lines win, as in backup_raw.py
    except FileNotFoundError:
        pass
    return m


def desktop_meta(meta_glob):
    out = {}
    for f in glob.glob(meta_glob):
        j = _json(f, None)
        if isinstance(j, dict) and j.get('cliSessionId'):
            out[j['cliSessionId']] = j
    return out


def transcripts(globs):
    paths = sorted(p for g in globs for p in glob.glob(g))
    return [(os.path.basename(p)[:-6], p) for p in paths]


def collect(cfg, state, now=None):
    """Status of every chat. Updates state['hash_cache'] in place."""
    now = time.time() if now is None else now
    arch = cfg['archive']
    manifest = load_manifest(arch)
    noted_sha = _json(os.path.join(arch, 'notes_state.json'), {})
    notes = {}
    for p in glob.glob(os.path.join(arch, 'notes/[!_]*/*__*.md')):
        notes[os.path.basename(p)[-11:-3]] = p
    mel = _json(cfg['melxis_state'], {}).get('notes', {})
    meta = desktop_meta(cfg['meta_glob'])
    cache = state.setdefault('hash_cache', {})
    seen_paths, items = set(), []

    def mel_ok(sid8, note):
        e = mel.get(sid8) or {}
        return bool(note) and e.get('status') == 'ok' and e.get('note_hash') == note_hash(note)

    def title_of(sid, note):
        t = (meta.get(sid) or {}).get('title')
        if not t and note:
            try:
                t = open(note, encoding='utf-8', errors='replace').readline().lstrip('# ').strip()
            except OSError:
                t = None
        return (t or 'untitled')[:80]

    for sid, p in transcripts(cfg['transcript_globs']):
        try:
            st = os.stat(p)
        except FileNotFoundError:
            continue
        seen_paths.add(p)
        c = cache.get(p)
        if c and c[0] == st.st_size and c[1] == st.st_mtime_ns:
            h = c[2]
        else:
            h = sha_file(p)
            cache[p] = [st.st_size, st.st_mtime_ns, h]
        sid8, note = sid[:8], notes.get(sid[:8])
        m = meta.get(sid) or {}
        idle = now - st.st_mtime
        eligible = bool(m.get('isArchived')) or idle >= IDLE
        stages = {'backup': manifest.get(sid) == h,
                  'note': noted_sha.get(sid) == h and bool(note),
                  'melxis': mel_ok(sid8, note)}
        it = {'sid': sid, 'sid8': sid8, 'title': title_of(sid, note),
              'date': datetime.fromtimestamp(st.st_mtime).strftime('%Y-%m-%d'),
              'idle_min': int(idle // 60), 'stages': stages, 'has_note': bool(note)}
        if not eligible:
            it.update(status='live', job=None, reason='in use, saves after 6h idle')
        elif all(stages.values()):
            it.update(status='saved', job=None, reason='')
        else:
            miss = [k for k, v in stages.items() if not v]
            it['status'] = 'failed'
            it['job'] = 'archive' if ('backup' in miss or 'note' in miss) else 'melxis'
            it['reason'] = {'backup': 'no backup of latest version', 'note': 'note missing or out of date',
                            'melxis': 'not in Melxis'}[miss[0]]
        items.append(it)

    # Chats whose original transcript was pruned: the backup and note are all that is left.
    live_sids = {i['sid'] for i in items}
    for sid in manifest:
        if sid in live_sids:
            continue
        note = notes.get(sid[:8])
        stages = {'backup': True, 'note': bool(note), 'melxis': mel_ok(sid[:8], note)}
        it = {'sid': sid, 'sid8': sid[:8], 'title': title_of(sid, note), 'date': '', 'idle_min': None,
              'stages': stages, 'has_note': bool(note), 'job': None}
        if all(stages.values()):
            it.update(status='saved', reason='')
        elif note:
            it.update(status='failed', job='melxis', reason='not in Melxis')
        else:
            it.update(status='stuck', reason='original pruned and no note: rerun cannot fix')
        items.append(it)

    for p in list(cache):   # forget transcripts that are gone
        if p not in seen_paths:
            del cache[p]
    return items


def summarize(items):
    eligible = [i for i in items if i['status'] != 'live']
    tot = {k: sum(1 for i in items if i['status'] == k) for k in ('saved', 'live', 'failed', 'stuck')}
    tot['total'] = len(items)
    stages = {k: sum(1 for i in eligible if i['stages'][k]) for k in ('backup', 'note', 'melxis')}
    stages['eligible'] = len(eligible)
    return tot, stages


def launchd_running(label):
    try:
        r = subprocess.run(['launchctl', 'print', f'gui/{os.getuid()}/{label}'], capture_output=True, text=True, timeout=10)
    except Exception:
        return False
    for ln in r.stdout.splitlines():
        if ln.strip().startswith('state ='):
            return ln.split('=', 1)[1].strip() == 'running'   # first 'state =' is the job's own
    return False


def launchd_kick(label):
    r = subprocess.run(['launchctl', 'kickstart', f'gui/{os.getuid()}/{label}'], capture_output=True, text=True, timeout=20)
    return r.returncode == 0, (r.stderr or r.stdout).strip()[-200:]


def heal(state, items, now=None, running=launchd_running, kick=launchd_kick, force=False):
    """Decide whether to rerun a save job. Mutates state['heal']; returns the heal summary.
    force: the person pressed Rerun now - fresh tries, no waiting (still never while a job runs)."""
    now = time.time() if now is None else now
    h = state.setdefault('heal', {'attempts': 0, 'next_at': 0, 'last_failed': [], 'history': []})
    if force:
        h.update(attempts=0, next_at=0)
    failed = sorted(i['sid'] for i in items if i['status'] == 'failed' and i['job'])
    jobs = {i['job'] for i in items if i['status'] == 'failed' and i['job']}
    busy = [j for j, label in JOBS.items() if running(label)]
    prev = set(h.get('last_failed', []))
    if not failed:
        h.update(attempts=0, next_at=0, last_failed=[])
        action, job = ('running', busy[0]) if busy else ('idle', None)
    else:
        # Progress (fewer failures) or new failures earn a fresh set of tries.
        if prev and (len(failed) < len(prev) or not set(failed) <= prev):
            h.update(attempts=0, next_at=0)
        h['last_failed'] = failed
        job = 'archive' if 'archive' in jobs else 'melxis'
        if busy:
            action, job = 'running', busy[0]
        elif now < h['next_at']:
            action = 'waiting'
        else:
            ok, msg = kick(JOBS[job])
            h['attempts'] += 1
            h['next_at'] = now + (BACKOFF_MIN[h['attempts']] if h['attempts'] < len(BACKOFF_MIN) else SLOW_MIN) * 60
            h['history'] = (h.get('history', []) + [{'at': now, 'job': job, 'ok': ok, 'msg': msg, 'failed': len(failed)}])[-10:]
            action = 'started' if ok else 'launch_error'
    return {'action': action, 'job': job, 'attempts': h['attempts'], 'cap': CAP, 'struggling': h['attempts'] >= CAP,
            'next_at': h['next_at'] or None, 'history': h.get('history', [])[-5:]}


def log_tail(path, n=3):
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 8192))
            lines = [ln.strip() for ln in f.read().decode('utf-8', 'replace').splitlines() if ln.strip()]
        return lines[-n:]
    except OSError:
        return []


def run(cfg, do_heal=False, now=None, running=launchd_running, kick=launchd_kick, force=False):
    state_path = os.path.join(cfg['archive'], 'monitor_state.json')
    with open(state_path + '.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)   # one checker at a time across sessions
        state = _json(state_path, {})
        items = collect(cfg, state, now)
        tot, stages = summarize(items)
        h = heal(state, items, now, running, kick, force) if do_heal or force else None
        tmp = state_path + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(state, f)
        os.replace(tmp, state_path)
    order = {'failed': 0, 'stuck': 1}
    bad = sorted((i for i in items if i['status'] in order), key=lambda i: i['date'], reverse=True)
    bad.sort(key=lambda i: order[i['status']])   # stable: failed first, newest first within
    live = sorted((i for i in items if i['status'] == 'live'), key=lambda i: i['idle_min'])
    slim = lambda i: {k: i[k] for k in ('sid8', 'title', 'date', 'status', 'reason', 'job', 'idle_min', 'has_note')}
    return {'generated_at': datetime.fromtimestamp(time.time() if now is None else now).isoformat(timespec='seconds'),
            'totals': tot, 'stages': stages,
            'problems': [slim(i) for i in bad[:30]], 'live': [slim(i) for i in live[:12]],
            'heal': h,
            'jobs': {k: {'running': running(v), 'log': log_tail(cfg['logs'][k])} for k, v in JOBS.items()}}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--heal', action='store_true')
    ap.add_argument('--force', action='store_true', help='rerun now: reset tries and backoff, then heal')
    ap.add_argument('--once', action='store_true', help='same as no flags: one check, one line')
    a = ap.parse_args()
    out = run(default_cfg(), do_heal=a.heal, force=a.force)
    if a.json:
        print(json.dumps(out))
        return
    t, h = out['totals'], out['heal']
    line = f"total {t['total']} | saved {t['saved']} | live {t['live']} | failed {t['failed']} | stuck {t['stuck']}"
    if h:
        line += f" | heal {h['action']}" + (f" {h['job']} ({h['attempts']}/{h['cap']})" if h['job'] else '')
    print(line)


if __name__ == '__main__':
    sys.exit(main())
