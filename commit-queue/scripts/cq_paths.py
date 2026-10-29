"""Pure path and line helpers for commit-queue. Stdlib only, no git, no file I/O."""

import fnmatch
import os.path
import re

_SECRET_PATTERNS = (
    ".env*",
    "*.pem",
    "*.p12",
    "id_rsa*",
    "*.key",
    "*key*",
    "*secret*",
    "*token*",
    "credentials*",
    "*.keystore",
)

_SECRET_LINE_PATTERNS = (
    re.compile(r"sk-ant-"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"-----BEGIN .*PRIVATE KEY-----"),
    re.compile(r"""api[_-]?key["']?\s*[:=]\s*\S{16,}""", re.IGNORECASE),
)


def is_secret_path(path: str) -> bool:
    """True when the basename of `path` looks like a secret file (case-insensitive).

    Withheld basenames: .env*, *.pem, *.p12, id_rsa*, *.key, *key*, *secret*,
    *token*, credentials*, *.keystore. Only the basename counts, not directories.
    False positives (e.g. keyboard-notes.md) are acceptable.
    """
    name = os.path.basename(path).lower()
    return any(fnmatch.fnmatchcase(name, pattern) for pattern in _SECRET_PATTERNS)


def is_secret_line(text: str) -> bool:
    """True when an added line contains secret-looking content: sk-ant-,
    AKIA followed by 16 [0-9A-Z], -----BEGIN ... PRIVATE KEY-----, or
    api_key / api-key / apikey followed by : or = and 16+ non-space chars."""
    return any(pattern.search(text) for pattern in _SECRET_LINE_PATTERNS)


def group_key(path: str) -> str:
    """First path segment of `path`, or '(root)' when it has no '/'."""
    if "/" not in path:
        return "(root)"
    return path.split("/", 1)[0]


def parse_porcelain_z(raw: bytes) -> list:
    """Parse `git status --porcelain=v1 -z` output into [(xy, path)].

    Entries are NUL-separated 'XY path'. For renames/copies (X or Y is R or C)
    the next NUL field is the origin path: return the new path and drop the
    origin. Decode as UTF-8. Empty input gives []."""
    fields = raw.split(b"\0")
    if fields and fields[-1] == b"":
        fields.pop()
    entries = []
    i = 0
    while i < len(fields):
        field = fields[i]
        i += 1
        xy = field[:2].decode("utf-8")
        path = field[3:].decode("utf-8")
        entries.append((xy, path))
        if "R" in xy or "C" in xy:
            i += 1
    return entries
