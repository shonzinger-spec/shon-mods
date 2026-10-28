#!/usr/bin/env python3
"""Read-only: print every desktop chat's metadata as one JSON array.

The app's chat list tool can't return 150+ chats in one result, so chat-tidy reads
the app's own per-chat files instead. Nothing is written or changed here.
"""
import datetime, glob, json, os, sys

ROOT = os.path.expanduser('~/Library/Application Support/Claude/claude-code-sessions')


def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).isoformat().replace('+00:00', 'Z') if isinstance(ms, (int, float)) else None


rows = []
for path in glob.glob(os.path.join(ROOT, '*', '*', 'local_*.json')):
    try:
        with open(path) as f:
            d = json.load(f)
    except Exception:
        continue
    sid = d.get('sessionId')
    if not isinstance(sid, str):
        continue
    parent = (d.get('spawnedFrom') or {}).get('sessionId') if isinstance(d.get('spawnedFrom'), dict) else None
    rows.append({
        'sessionId': sid,
        'title': d.get('title') or '',
        'isArchived': bool(d.get('isArchived')),
        'lastActivityAt': iso(d.get('lastActivityAt')),
        'startedBy': parent or d.get('forkedFromSessionId'),
        'exempt': bool(d.get('autoArchiveExempt')) or bool(d.get('interruptedAwaitingPerson')),
    })
json.dump(rows, sys.stdout)
