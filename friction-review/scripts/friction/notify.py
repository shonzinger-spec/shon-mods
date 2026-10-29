"""Ask the user, once a week, whether to open the friction report. osascript only; no shell."""
from __future__ import annotations

import subprocess
from typing import Callable, List, Sequence

TEXT = (
    "These are the common things holding us back this week. "
    "If we make a mod for them, we can make sure we never run into them again."
)
OPEN = "Open report"
LATER = "Later"
GIVE_UP_SECONDS = 300


def build_argv(text: str = TEXT) -> List[str]:
    """argv for osascript. The message travels as a script argument, never inside script source,
    so no quoting or escaping is involved."""
    return [
        "osascript",
        "-e", "on run argv",
        "-e", 'set r to display dialog (item 1 of argv) with title "Friction review" buttons {"%s", "%s"} '
              'default button "%s" giving up after %d' % (LATER, OPEN, OPEN, GIVE_UP_SECONDS),
        "-e", "return button returned of r",
        "-e", "end run",
        text,
    ]


def notify(report_path: str, run: Callable[..., "subprocess.CompletedProcess[str]"] = subprocess.run) -> bool:
    """Show the dialog; open the report only if the user chose Open report. True when it was opened."""
    try:
        r = run(build_argv(), capture_output=True, text=True, timeout=GIVE_UP_SECONDS + 30)
    except Exception:
        return False
    if r.returncode != 0 or (r.stdout or "").strip() != OPEN:
        return False
    try:
        run(["open", report_path], capture_output=True, text=True, timeout=30)
    except Exception:
        return False
    return True
