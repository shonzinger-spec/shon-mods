from friction import notify

TEXT = "These are the common things holding us back this week. If we make a mod for them, we can make sure we never run into them again."


class Done:
    def __init__(self, code=0, out=""):
        self.returncode, self.stdout = code, out


def test_notify_argv_is_list_and_exact_text():
    argv = notify.build_argv()
    assert isinstance(argv, list) and all(isinstance(a, str) for a in argv)
    assert argv[0] == "osascript" and argv[-1] == TEXT and notify.TEXT == TEXT
    assert TEXT not in " ".join(argv[:-1])  # the message is an argument, never script source
    assert "Open report" in " ".join(argv) and "giving up after 300" in " ".join(argv)


def test_notify_opens_report_only_on_open_button():
    calls = []

    def fake(answer):
        def run(argv, **kw):
            calls.append(list(argv))
            return Done(0, answer) if argv[0] == "osascript" else Done(0, "")
        return run

    assert notify.notify("/r/x.md", run=fake("Open report\n")) is True
    assert calls[-1] == ["open", "/r/x.md"]
    calls.clear()
    assert notify.notify("/r/x.md", run=fake("Later\n")) is False
    assert notify.notify("/r/x.md", run=fake("")) is False  # gave up
    assert all(c[0] == "osascript" for c in calls)
    assert notify.notify("/r/x.md", run=lambda argv, **kw: Done(1, "Open report")) is False

    def boom(argv, **kw):
        raise OSError("no osascript")
    assert notify.notify("/r/x.md", run=boom) is False
