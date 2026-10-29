import json
import os
import shutil
from datetime import datetime, timezone

from friction import scan

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
NOW = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)


def put(projects, proj, name, text, mtime=NOW):
    d = os.path.join(str(projects), proj)
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name)
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)
    os.utime(p, (mtime.timestamp(), mtime.timestamp()))
    return p


def session_a():
    with open(os.path.join(FIX, "session_a.jsonl"), encoding="utf-8") as f:
        return f.read()


def test_scan_skips_big_file_and_lists_it(tmp_path):
    proj, out = tmp_path / "projects", tmp_path / "out"
    put(proj, "-p1", "small.jsonl", session_a())
    put(proj, "-p1", "huge.jsonl", session_a() * 5)
    size = os.path.getsize(proj / "-p1" / "small.jsonl")
    latest = scan.run(str(proj), str(out), NOW, 7, max_bytes=size + 10)
    md = (out / "reports" / "2026-10-29.md").read_text()
    assert "## Skipped (>50 MB)" in md and "-p1/huge.jsonl" in md and "-p1/small.jsonl (" not in md
    assert "Files scanned: 1." in md
    assert latest["counts"]["total"] == 14  # session_a.jsonl yields 14 hits; the skipped file adds none


def test_scan_one_file_at_a_time_streaming(tmp_path, monkeypatch):
    proj = tmp_path / "projects"
    for i in range(4):
        put(proj, "-p%d" % (i % 2), "s%d.jsonl" % i, session_a())
    state = {"open": 0, "max": 0, "reads": 0, "opened": 0}

    class Spy:
        def __init__(self, fh):
            self.fh = fh

        def __enter__(self):
            state["open"] += 1
            state["opened"] += 1
            state["max"] = max(state["max"], state["open"])
            return self

        def __exit__(self, *a):
            state["open"] -= 1
            self.fh.close()

        def __iter__(self):
            for l in self.fh:
                state["reads"] += 1
                yield l

        def read(self, *a):
            raise AssertionError("whole-file read")

        readlines = read

    monkeypatch.setattr(scan, "_open", lambda p: Spy(open(p, encoding="utf-8")))
    scan.run(str(proj), str(tmp_path / "out"), NOW, 7)
    assert state["opened"] == 4 and state["max"] == 1 and state["open"] == 0 and state["reads"] > 4


def test_scan_window_filters_by_timestamp(tmp_path):
    proj = tmp_path / "projects"
    old = session_a().replace("2026-10-28", "2026-10-01")  # 28 days old: outside 7d friction
    put(proj, "-p1", "old.jsonl", old)
    latest = scan.run(str(proj), str(tmp_path / "o1"), NOW, 7)
    assert latest["counts"]["total"] == 0
    md = (tmp_path / "o1" / "reports" / "2026-10-29.md").read_text()
    assert "No patterns found." in md
    # a file whose mtime is older than the 30-day horizon is not even opened
    ancient = datetime(2026, 8, 1, tzinfo=timezone.utc)
    put(proj, "-p2", "ancient.jsonl", session_a(), mtime=ancient)
    both = scan.run(str(proj), str(tmp_path / "o2"), NOW, 7)
    assert both["counts"]["total"] == 0
    assert "Files scanned: 1." in (tmp_path / "o2" / "reports" / "2026-10-29.md").read_text()
    # inside the window the same events count
    put(proj, "-p3", "new.jsonl", session_a())
    new = scan.run(str(proj), str(tmp_path / "o3"), NOW, 7)
    assert new["counts"]["total"] > 0
    assert new["top3"][0]["pattern"] == "tool_error_exit" and new["top3"][0]["count"] == 3


def test_invocations_30d_feed_unused_section(tmp_path):
    proj = tmp_path / "projects"
    rows = [
        {"type": "assistant", "sessionId": "s", "timestamp": "2026-10-10T10:00:00.000Z", "message": {"content": [
            {"type": "tool_use", "id": "1", "name": "Skill", "input": {"skill": "alpha:do-it"}},
            {"type": "tool_use", "id": "2", "name": "mcp__plugin_gamma-x_srv__tool", "input": {}},
            {"type": "tool_use", "id": "3", "name": "Skill", "input": {"skill": "baresk"}},
        ]}},
        {"type": "user", "sessionId": "s", "timestamp": "2026-10-11T10:00:00.000Z",
         "message": {"content": "<command-name>/delta:run</command-name>"}},
    ]
    put(proj, "-p", "s.jsonl", "\n".join(json.dumps(r) for r in rows) + "\n", mtime=datetime(2026, 10, 11, tzinfo=timezone.utc))
    installed = {n: {"skills": 1, "agents": 0, "mcp": 0, "is_mod": False} for n in ("alpha", "beta", "gamma-x", "gamma", "delta", "epsilon")}
    installed["modx"] = {"skills": 1, "agents": 0, "mcp": 0, "is_mod": True}
    scan.run(str(proj), str(tmp_path / "o"), NOW, 7, installed=installed, bare={"baresk": "epsilon"})
    md = (tmp_path / "o" / "reports" / "2026-10-29.md").read_text()
    section = md.split("## Unused plugins")[1]
    assert "- beta" in section and "- gamma\n" in section  # gamma was never used; gamma-x was (longest match)
    for used in ("alpha", "gamma-x", "delta", "epsilon"):
        assert "- %s\n" % used not in section
    assert "- modx" in section.split("Not measurable")[1]


def test_report_has_no_secret_shaped_strings(tmp_path):
    proj = tmp_path / "projects"
    secret = "sk-" + "ab12" * 8
    row = {"type": "user", "sessionId": "s", "timestamp": "2026-10-28T10:00:00.000Z",
           "message": {"content": [{"type": "tool_result", "tool_use_id": "x", "is_error": True,
                                    "content": "Error: bad key %s and ghp_%s" % (secret, "Zz9" * 10)}]}}
    put(proj, "-p", "s.jsonl", json.dumps(row) + "\n")
    scan.run(str(proj), str(tmp_path / "o"), NOW, 7)
    md = (tmp_path / "o" / "reports" / "2026-10-29.md").read_text()
    assert "tool_error_error" in md and secret not in md and "ghp_" not in md and "[REDACTED]" in md


def test_main_writes_report_and_latest_json(tmp_path, monkeypatch, capsys):
    proj, out = tmp_path / "projects", tmp_path / "out"
    put(proj, "-p1", "a.jsonl", session_a())
    monkeypatch.setattr(scan, "DEFAULT_PLUGINS", str(tmp_path / "none.json"))
    rc = scan.main(["--days", "7", "--out", str(out), "--projects", str(proj), "--no-notify", "--now", "2026-10-29T12:00:00+00:00"])
    assert rc == 0
    assert (out / "reports" / "2026-10-29.md").exists()
    latest = json.loads((out / "latest.json").read_text())
    assert latest["date"] == "2026-10-29" and latest["counts"]["patterns"] == 10 and len(latest["top3"]) == 3
    assert not [f for f in os.listdir(out) if ".tmp." in f]
    assert "report:" in capsys.readouterr().out


def test_parse_ts_and_invoked_plugin():
    assert scan.parse_ts("2026-10-28T10:00:00.000Z") == datetime(2026, 10, 28, 10, tzinfo=timezone.utc)
    assert scan.parse_ts("2026-10-28T10:00:00.123456789Z").microsecond == 123456
    assert scan.parse_ts("2026-10-28T10:00:00") == datetime(2026, 10, 28, 10, tzinfo=timezone.utc)
    assert scan.parse_ts("nope") is None and scan.parse_ts(None) is None
    names = ["a", "a-b"]
    assert scan.invoked_plugin("Skill", {"skill": "a:x"}, names) == "a"
    assert scan.invoked_plugin("Skill", {"skill": "bare"}, names, {"bare": "a"}) == "a"
    assert scan.invoked_plugin("Skill", {"skill": "bare"}, names) is None
    assert scan.invoked_plugin("Agent", {"subagent_type": "a:rev"}, names) == "a"
    assert scan.invoked_plugin("Task", {"subagent_type": "general-purpose"}, names) is None
    assert scan.invoked_plugin("mcp__plugin_a-b_srv__t", {}, names) == "a-b"
    assert scan.invoked_plugin("mcp__plugin_a_srv__t", {}, names) == "a"
    assert scan.invoked_plugin("Bash", {"command": "ls"}, names) is None
    assert scan.invoked_plugin("Skill", "garbage", names) is None


def test_discover_installed_counts_enabled_plugins_only(tmp_path):
    def mk(name, skills=(), agents=(), mcp=None):
        root = tmp_path / "cache" / name
        for s in skills:
            (root / "skills" / s).mkdir(parents=True)
        for a in agents:
            (root / "agents").mkdir(parents=True, exist_ok=True)
            (root / "agents" / (a + ".md")).write_text("x")
        if mcp:
            root.mkdir(parents=True, exist_ok=True)
            (root / ".mcp.json").write_text(json.dumps({"mcpServers": {m: {} for m in mcp}}))
        root.mkdir(parents=True, exist_ok=True)
        return str(root)
    plugins = {"plugins": {
        "p1@m": [{"installPath": mk("p1", skills=["s1", "s2"], agents=["ag"], mcp=["srv"])}],
        "p2@m": [{"installPath": mk("p2")}],
        "off@m": [{"installPath": mk("off", skills=["x"])}],
        "mymod@shon-mods": [{"installPath": mk("mymod")}],
    }}
    (tmp_path / "ip.json").write_text(json.dumps(plugins))
    (tmp_path / "settings.json").write_text(json.dumps({"enabledPlugins": {"p1@m": True, "p2@m": True, "off@m": False, "mymod@shon-mods": True}}))
    installed, bare = scan.discover_installed(str(tmp_path / "ip.json"), str(tmp_path / "settings.json"))
    assert installed == {
        "p1": {"skills": 2, "agents": 1, "mcp": 1, "is_mod": False, "hooks": 0},
        "p2": {"skills": 0, "agents": 0, "mcp": 0, "is_mod": False, "hooks": 0},
        "mymod": {"skills": 0, "agents": 0, "mcp": 0, "is_mod": True, "hooks": 0},
    }
    assert bare["s1"] == "p1"
    assert scan.discover_installed(str(tmp_path / "missing.json"), str(tmp_path / "settings.json")) == ({}, {})


def test_discover_installed_detects_hooks(tmp_path):
    a, b, c = (tmp_path / n for n in ("a", "b", "c"))
    (a / ".claude-plugin").mkdir(parents=True)
    (a / ".claude-plugin" / "plugin.json").write_text(json.dumps({"name": "a", "hooks": {"SessionStart": []}}))
    (b / "hooks").mkdir(parents=True)
    (b / "hooks" / "hooks.json").write_text("{}")
    (c / "skills" / "s").mkdir(parents=True)
    pj = tmp_path / "installed_plugins.json"
    pj.write_text(json.dumps({"plugins": {
        "a@m": [{"installPath": str(a)}], "b@m": [{"installPath": str(b)}], "c@m": [{"installPath": str(c)}],
    }}))
    out, _ = scan.discover_installed(str(pj), str(tmp_path / "missing.json"))
    assert (out["a"]["hooks"], out["b"]["hooks"], out["c"]["hooks"]) == (1, 1, 0)
