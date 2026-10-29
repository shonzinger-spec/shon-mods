"""Pure matching of a new chat against other chats (stdlib only, no file IO)."""
import re

STOPWORDS = frozenset(
    'a an and are as at be but by for from has have in is it its of on or that the this to was we with '
    'you your please can could would should into then them they their there will just also about so if '
    'not do does did me my our us'.split()
)


def norm_title(title):
    """Casefold, drop every leading 'fork of' (repeatable), turn each non-alphanumeric run
    into one space, collapse and strip. 'Fork of Fork of  Build: X!' -> 'build x'. Never None."""
    text = (title or '').casefold().strip()
    while text.startswith('fork of'):
        text = text[len('fork of'):].lstrip()
    return re.sub(r'[^a-z0-9]+', ' ', text).strip()


def content_words(text):
    """Set of lowercase tokens matching [a-z0-9]+ that are at least 3 characters long and not
    in STOPWORDS. None or '' gives an empty set."""
    return {
        word for word in re.findall(r'[a-z0-9]+', (text or '').casefold())
        if len(word) >= 3 and word not in STOPWORDS
    }


def jaccard(a, b):
    """|a & b| / |a | b| for two sets; 0.0 when the union is empty."""
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


def _cwd_key(cwd):
    cwd = cwd or ''
    if cwd.endswith('/'):
        cwd = cwd[:-1]
    return cwd


def match(new, others, *, now_ms, min_jaccard=0.55, min_words=6, limit=3, ignore_titles=()):
    """Rank chats in `others` that look like the same task as chat `new`.

    Chats are dicts with keys sessionId, title, cwd, prompt (first user message, '' when
    unknown), lastActivityAt (epoch ms, int), isArchived (bool), and optionally
    scheduledTaskId (str) and spawnedFrom ({'sessionId': str}). Missing keys count as empty.

    An `other` is a candidate only if it is not archived, has no scheduledTaskId, its
    sessionId differs from new's, its spawnedFrom.sessionId is not new's sessionId and
    new's spawnedFrom.sessionId is not its sessionId.

    Score 1.0 with reason 'title' when norm_title(new.title) is non-empty, not in
    {norm_title(t) for t in ignore_titles}, and equals norm_title(other.title) (cwd is not
    compared). Otherwise reason 'prompt' with score = jaccard(content_words of both prompts)
    when both word sets have at least min_words members, cwd is equal (ignoring one trailing
    '/'; empty cwd never matches) and the score >= min_jaccard. Otherwise not a match.

    Return at most `limit` dicts {sessionId, title (other's original), score, reason,
    lastActivityAt, idleMs = max(0, now_ms - lastActivityAt)}, newest lastActivityAt first
    (ties broken by sessionId ascending).
    """
    new = new or {}
    new_sid = new.get('sessionId') or ''
    new_spawned = (new.get('spawnedFrom') or {}).get('sessionId') or ''

    new_title = norm_title(new.get('title'))
    ignored = {norm_title(t) for t in ignore_titles}
    title_ok = bool(new_title) and new_title not in ignored

    new_words = content_words(new.get('prompt'))
    new_cwd = _cwd_key(new.get('cwd'))

    results = []
    for other in others or ():
        other = other or {}
        sid = other.get('sessionId') or ''
        if other.get('isArchived'):
            continue
        if other.get('scheduledTaskId'):
            continue
        if sid == new_sid:
            continue
        other_spawned = (other.get('spawnedFrom') or {}).get('sessionId') or ''
        if other_spawned and other_spawned == new_sid:
            continue
        if new_spawned and new_spawned == sid:
            continue

        score = None
        reason = None
        if title_ok and norm_title(other.get('title')) == new_title:
            score = 1.0
            reason = 'title'
        else:
            other_words = content_words(other.get('prompt'))
            other_cwd = _cwd_key(other.get('cwd'))
            if (
                len(new_words) >= min_words
                and len(other_words) >= min_words
                and new_cwd
                and other_cwd
                and new_cwd == other_cwd
            ):
                candidate_score = jaccard(new_words, other_words)
                if candidate_score >= min_jaccard:
                    score = candidate_score
                    reason = 'prompt'

        if score is None:
            continue

        last_activity = other.get('lastActivityAt') or 0
        results.append({
            'sessionId': sid,
            'title': other.get('title'),
            'score': score,
            'reason': reason,
            'lastActivityAt': last_activity,
            'idleMs': max(0, now_ms - last_activity),
        })

    results.sort(key=lambda m: (-m['lastActivityAt'], m['sessionId']))
    return results[:limit]
