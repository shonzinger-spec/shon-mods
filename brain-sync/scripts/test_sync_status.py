import hashlib, json, os, time
import pytest
import sync_status as ss

NOW = 1_800_000_000.0


def sha(b):
    return hashlib.sha256(b).hexdigest()


@pytest.fixture
def env(tmp_path):
    arch = tmp_path / 'archive'; (arch / '_raw').mkdir(parents=True); (arch / 'notes/trading').mkdir(parents=True)
    proj = tmp_path / 'projects/p'; proj.mkdir(parents=True)
    meta = tmp_path / 'meta/a/b'; meta.mkdir(parents=True)
    mel = tmp_path / 'melxis.json'
    cfg = {'archive': str(arch), 'melxis_state': str(mel), 'transcript_globs': [str(tmp_path / 'projects/*/*.jsonl')],
           'meta_glob': str(tmp_path / 'meta/*/*/local_*.json'), 'logs': {'archive': str(arch / 'sync.log'), 'melxis': str(tmp_path / 'm.log')}}

    class E:
        pass
    e = E(); e.cfg, e.arch, e.proj, e.meta, e.mel = cfg, arch, proj, meta, mel
    e.manifest, e.noted, e.mels = {}, {}, {}

    def chat(sid, body=b'{"x":1}\n', age_h=10, backup=True, note=True, melxis=True, archived=False):
        p = proj / f'{sid}.jsonl'; p.write_bytes(body)
        t = NOW - age_h * 3600; os.utime(p, (t, t))
        h = sha(body)
        if backup: e.manifest[sid] = h
        if note:
            n = arch / f'notes/trading/2026-10-01_chat__{sid[:8]}.md'; n.write_text(f'# Title {sid[:4]}\nbody\n')
            e.noted[sid] = h
            if melxis: e.mels[sid[:8]] = {'status': 'ok', 'note_hash': sha(n.read_text().encode())}
        if archived:
            (meta / f'local_{sid[:8]}.json').write_text(json.dumps({'cliSessionId': sid, 'isArchived': True, 'title': 'Archived one'}))
        flush()

    def flush():
        (arch / '_raw/MANIFEST.tsv').write_text(''.join(f'{k}\t{v}\t1\tf.tar.gz\n' for k, v in e.manifest.items()))
        (arch / 'notes_state.json').write_text(json.dumps(e.noted))
        mel.write_text(json.dumps({'notes': e.mels}))
    e.chat, e.flush = chat, flush
    return e


def status_of(env, **kw):
    out = ss.run(env.cfg, now=NOW, running=lambda l: False, kick=lambda l: (True, ''), **kw)
    return out, {p['sid8']: p for p in out['problems'] + out['live']}


def test_saved_live_failed_classification(env):
    env.chat('aaaaaaaa-1')                                  # fully saved
    env.chat('bbbbbbbb-1', age_h=1)                         # in use -> live
    env.chat('cccccccc-1', age_h=1, note=False, archived=True)  # archived in app -> eligible now -> failed
    env.chat('dddddddd-1', backup=False)                    # idle, not backed up
    env.chat('eeeeeeee-1', melxis=False)                    # note but no mel
    out, by = status_of(env)
    assert out['totals'] == {'saved': 1, 'live': 1, 'failed': 3, 'stuck': 0, 'total': 5}
    assert by['bbbbbbbb']['status'] == 'live'
    assert by['cccccccc']['title'] == 'Archived one' and by['cccccccc']['job'] == 'archive'
    assert by['dddddddd']['reason'] == 'no backup of latest version'
    assert by['eeeeeeee']['job'] == 'melxis'
    assert out['stages'] == {'backup': 3, 'note': 3, 'melxis': 2, 'eligible': 4}


def test_changed_transcript_or_note_is_not_saved(env):
    env.chat('aaaaaaaa-1')
    p = env.proj / 'aaaaaaaa-1.jsonl'; p.write_bytes(b'{"x":2}\n'); os.utime(p, (NOW - 36000, NOW - 36000))
    _, by = status_of(env)
    assert by['aaaaaaaa']['status'] == 'failed'             # chat continued: older note does not count
    env.chat('bbbbbbbb-1')
    (env.arch / 'notes/trading/2026-10-01_chat__bbbbbbbb.md').write_text('# edited\n')
    _, by = status_of(env)
    assert by['bbbbbbbb']['reason'] == 'not in Melxis'      # note changed after it was mirrored


def test_pruned_original_with_note_counts_as_saved(env):
    env.chat('aaaaaaaa-1'); (env.proj / 'aaaaaaaa-1.jsonl').unlink()
    env.manifest['ffffffff-1'] = 'x' * 64; env.flush()     # pruned and never noted
    out, by = status_of(env)
    assert out['totals']['saved'] == 1 and by['ffffffff']['status'] == 'stuck'


def test_hash_cache_skips_rehash(env, monkeypatch):
    env.chat('aaaaaaaa-1')
    status_of(env)
    monkeypatch.setattr(ss, 'sha_file', lambda p: pytest.fail('re-hashed an unchanged transcript'))
    out, _ = status_of(env)
    assert out['totals']['saved'] == 1


def heal_run(env, now, running=False, ok=True):
    kicks = []
    out = ss.run(env.cfg, do_heal=True, now=now, running=lambda l: running,
                 kick=lambda l: (kicks.append(l) or (ok, '')))
    return out['heal'], kicks


def test_heal_reruns_with_backoff_then_hourly_forever(env):
    env.chat('aaaaaaaa-1', backup=False); env.chat('bbbbbbbb-1', melxis=False)
    h, k = heal_run(env, NOW)
    assert (h['action'], h['job'], k) == ('started', 'archive', ['com.secondbrain.chatarchive'])
    h, k = heal_run(env, NOW + 60)                          # same failures, inside backoff: no second launch
    assert (h['action'], k) == ('waiting', [])
    t = NOW
    for n in range(2, ss.CAP + 1):                          # backoff 10, 20, 40, 80 min
        t = h['next_at']
        h, k = heal_run(env, t)
        assert (h['action'], h['attempts'], len(k)) == ('started', n, 1)
    assert h['struggling'] and h['next_at'] == t + ss.SLOW_MIN * 60   # past the fast tries: hourly
    h, k = heal_run(env, t + 30 * 60)
    assert (h['action'], k) == ('waiting', [])
    for n in range(ss.CAP + 1, ss.CAP + 4):                 # never gives up: keeps rerunning hourly
        t = h['next_at']
        h, k = heal_run(env, t)
        assert (h['action'], h['attempts'], len(k)) == ('started', n, 1)
    state = json.load(open(env.arch / 'monitor_state.json'))
    assert state['heal']['attempts'] == ss.CAP + 3


def test_heal_never_launches_while_a_job_runs(env):
    env.chat('aaaaaaaa-1', backup=False)
    h, k = heal_run(env, NOW, running=True)
    assert (h['action'], k) == ('running', [])


def test_heal_resets_on_progress_and_goes_idle_when_clear(env):
    env.chat('aaaaaaaa-1', melxis=False); env.chat('bbbbbbbb-1', melxis=False)
    h, k = heal_run(env, NOW)
    assert (h['job'], k) == ('melxis', ['com.secondbrain.melxissync'])
    env.chat('aaaaaaaa-1')                                  # the rerun saved one of the two
    h, k = heal_run(env, NOW + 60)
    assert (h['action'], h['attempts']) == ('started', 1)   # progress -> fresh tries, no waiting
    env.chat('bbbbbbbb-1')
    h, k = heal_run(env, NOW + 120)
    assert (h['action'], h['attempts'], k) == ('idle', 0, [])


def test_rerun_after_save_is_idempotent(env):
    env.chat('aaaaaaaa-1')
    for t in range(3):
        h, k = heal_run(env, NOW + t)
        assert (h['action'], k) == ('idle', [])
    notes = list((env.arch / 'notes').rglob('*__aaaaaaaa.md'))
    assert len(notes) == 1


def test_force_skips_the_wait(env):
    env.chat('aaaaaaaa-1', backup=False)
    assert heal_run(env, NOW)[0]['action'] == 'started'
    assert heal_run(env, NOW + 60)[0]['action'] == 'waiting'
    out = ss.run(env.cfg, now=NOW + 60, force=True, running=lambda l: False, kick=lambda l: (True, ''))
    assert (out['heal']['action'], out['heal']['attempts']) == ('started', 1)
