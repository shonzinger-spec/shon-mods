"""Tests for commit_queue.py. Every repo is a throwaway under a temp dir; the real repos are never touched."""
import json
import os
import shutil
import stat as statmod
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "commit_queue.py")
REAL_GIT = shutil.which("git")
CLEAN_ENV = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
IDENT = {"name": "Test Person", "email": "test@users.noreply.example.org"}
# Key-shaped text is assembled at run time so this file holds no literal secret.
SK = "sk" + "-ant-" + "x" * 12
AK = "AK" + "IA" + "B" * 16


def g(repo, *args, stdin=None):
    r = subprocess.run([REAL_GIT, "-C", repo, *args], input=stdin, capture_output=True, env=CLEAN_ENV, check=True)
    return r.stdout.decode()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="cq-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.repos = []

    def mkrepo(self, name="r1", identity=("Repo Owner", "owner@users.noreply.example.org"), commit=True):
        repo = os.path.join(self.tmp, name)
        os.makedirs(repo)
        g(repo, "init", "-q", "-b", "main")
        # Guard: this repo must be its own toplevel, inside our temp dir.
        top = os.path.realpath(g(repo, "rev-parse", "--show-toplevel").strip())
        assert top == os.path.realpath(repo) and top.startswith(os.path.realpath(self.tmp))
        if identity:
            g(repo, "config", "user.name", identity[0])
            g(repo, "config", "user.email", identity[1])
        if commit:
            self.put(repo, "seed.txt", "seed\n")
            g(repo, "add", "seed.txt")
            g(repo, "-c", "user.name=Seed", "-c", "user.email=seed@users.noreply.example.org", "commit", "-qm", "seed")
        self.repos.append(repo)
        return repo

    def put(self, repo, rel, text="x\n"):
        p = os.path.join(repo, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write(text)

    def config(self, repos=None, **over):
        cfg = {"repos": repos if repos is not None else self.repos, "max_file_mb": 2, "interval_min": 10,
               "identity": IDENT}
        cfg.update(over)
        path = os.path.join(self.tmp, "config.json")
        with open(path, "w") as f:
            json.dump(cfg, f)
        return path

    def cq(self, *args, cfg=None, env=None):
        r = subprocess.run([sys.executable, SCRIPT, "--config", cfg or self.config(), *args],
                           capture_output=True, env=env or CLEAN_ENV)
        return r.returncode, json.loads(r.stdout.decode())

    def groups(self, out, repo=None):
        return {g_["group"]: g_ for r in out["repos"] if repo in (None, r["repo"]) for g_ in r["groups"]}


class Scan(Base):
    def test_scan_counts_modified_untracked_staged(self):
        repo = self.mkrepo()
        self.put(repo, "seed.txt", "seed\nmore\n")  # modified, +1
        self.put(repo, "new.txt", "a\nb\nc\n")  # untracked, +3
        self.put(repo, "staged.txt", "s\n")
        g(repo, "add", "staged.txt")  # staged, +1
        code, out = self.cq("scan")
        self.assertEqual(code, 0)
        root = self.groups(out)["(root)"]
        self.assertEqual(root["file_count"], 3)
        self.assertEqual(root["added"], 5)
        self.assertEqual(out["totals"]["files"], 3)
        self.assertEqual(out["repos"][0]["branch"], "main")

    def test_group_by_top_dir(self):
        repo = self.mkrepo()
        self.put(repo, "alpha/a.py")
        self.put(repo, "alpha/sub/b.py")
        self.put(repo, "beta/c.py")
        _, out = self.cq("scan")
        gs = self.groups(out)
        self.assertEqual(gs["alpha"]["file_count"], 2)
        self.assertEqual(gs["beta"]["file_count"], 1)
        self.assertEqual(gs["alpha"]["id"], "r1:alpha")

    def test_root_file_group(self):
        repo = self.mkrepo()
        self.put(repo, "top.md", "hi\n")
        _, out = self.cq("scan")
        self.assertEqual(list(self.groups(out)), ["(root)"])

    def test_nested_untracked_dir_expanded(self):
        repo = self.mkrepo()
        self.put(repo, "data/deep/er/one.csv", "1\n")
        self.put(repo, "data/deep/er/two.csv", "2\n")
        _, out = self.cq("scan")
        self.assertEqual(self.groups(out)["data"]["file_count"], 2)

    def test_clean_repo_has_no_groups(self):
        self.mkrepo()
        _, out = self.cq("scan")
        self.assertEqual(out["totals"], {"files": 0, "groups": 0, "repos": 0, "unreadable": 0})

    def test_unreadable_repo_does_not_raise(self):
        repo = self.mkrepo()
        self.put(repo, "ok.txt")
        os.makedirs(os.path.join(self.tmp, "broken", ".git"))  # a .git dir git cannot read
        code, out = self.cq("scan", cfg=self.config([repo, os.path.join(self.tmp, "broken"),
                                                     os.path.join(self.tmp, "missing")]))
        self.assertEqual(code, 0)
        by = {r["name"]: r for r in out["repos"]}
        self.assertFalse(by["broken"]["readable"])
        self.assertTrue(by["broken"]["error"])
        self.assertTrue(by["r1"]["readable"])
        self.assertNotIn("missing", by)  # missing paths are skipped silently

    def test_duplicate_symlink_repo_deduped(self):
        repo = self.mkrepo()
        self.put(repo, "x.txt")
        link = os.path.join(self.tmp, "alias")
        os.symlink(repo, link)
        _, out = self.cq("scan", cfg=self.config([repo, link]))
        self.assertEqual(len(out["repos"]), 1)
        self.assertEqual(out["totals"]["files"], 1)

    def test_scan_is_read_only(self):
        repo = self.mkrepo()
        self.put(repo, "x.txt")
        before = g(repo, "log", "--format=%H"), g(repo, "status", "--porcelain")
        self.cq("scan")
        self.assertEqual(before, (g(repo, "log", "--format=%H"), g(repo, "status", "--porcelain")))


class Withheld(Base):
    def reasons(self, out, seg="(root)"):
        return {w["path"]: w["reason"] for w in self.groups(out)[seg]["withheld"]}

    def test_secret_env_withheld(self):
        repo = self.mkrepo()
        self.put(repo, ".env", "A=1\n")
        self.put(repo, "app/.env.local", "A=1\n")
        self.put(repo, "ok.txt")
        _, out = self.cq("scan")
        self.assertEqual(self.reasons(out), {".env": "secret-name"})
        self.assertEqual(self.reasons(out, "app"), {"app/.env.local": "secret-name"})
        self.assertEqual(self.groups(out)["(root)"]["allowed_count"], 1)

    def test_secret_key_name_withheld(self):
        repo = self.mkrepo()
        for n in ["id_rsa", "deploy.pem", "api_key.txt", "my-secrets.yaml", "auth_token.json", "credentials.json"]:
            self.put(repo, n)
        self.put(repo, "fine.txt")
        _, out = self.cq("scan")
        self.assertEqual(len(self.reasons(out)), 6)
        self.assertEqual(self.groups(out)["(root)"]["allowed_count"], 1)

    def test_secret_content_regex_withheld(self):
        repo = self.mkrepo()
        self.put(repo, "a.py", "x = '" + SK + "'\n")
        self.put(repo, "b.py", "id = " + AK + "\n")
        self.put(repo, "c.py", "api_key = " + "z" * 20 + "\n")
        self.put(repo, "d.pyx", "-----" + "BEGIN RSA PRIVATE KEY" + "-----\n")
        self.put(repo, "clean.py", "print('hi')\n")
        # a tracked file that gains a secret line is caught through the diff too
        self.put(repo, "seed.txt", "seed\nkey2 = " + SK + "\n")
        _, out = self.cq("scan")
        r = self.reasons(out)
        self.assertEqual(set(r), {"a.py", "b.py", "c.py", "d.pyx", "seed.txt"})
        self.assertTrue(all(v == "secret-content" for v in r.values()))

    def test_oversize_withheld(self):
        repo = self.mkrepo()
        with open(os.path.join(repo, "big.bin"), "wb") as f:
            f.write(b"a\n" * (1024 * 1024 + 10))  # > 2 MB
        self.put(repo, "small.txt")
        _, out = self.cq("scan")
        self.assertEqual(self.reasons(out), {"big.bin": "oversize"})

    def test_withheld_files_are_never_staged(self):
        repo = self.mkrepo()
        self.put(repo, ".env", "A=1\n")
        self.put(repo, "ok.txt")
        code, out = self.cq("commit", repo, "(root)")
        self.assertEqual(code, 0, out)
        self.assertEqual(g(repo, "show", "--name-only", "--format=", "HEAD").split(), ["ok.txt"])
        self.assertIn("?? .env", g(repo, "status", "--porcelain"))


class Commit(Base):
    def test_commit_uses_config_identity(self):
        repo = self.mkrepo(identity=None)  # no repo identity at all
        self.put(repo, "pkg/a.py")
        code, out = self.cq("commit", repo, "pkg")
        self.assertEqual(code, 0, out)
        self.assertTrue(out["ok"])
        self.assertEqual(g(repo, "log", "-1", "--format=%an,%ae,%cn,%ce").strip(),
                         "Test Person,test@users.noreply.example.org,Test Person,test@users.noreply.example.org")
        self.assertEqual(out["sha"], g(repo, "log", "-1", "--format=%h").strip())

    def test_commit_prefers_real_repo_identity(self):
        repo = self.mkrepo(identity=("Repo Owner", "owner@users.noreply.example.org"))
        self.put(repo, "pkg/a.py")
        self.cq("commit", repo, "pkg")
        self.assertEqual(g(repo, "log", "-1", "--format=%an").strip(), "Repo Owner")

    def test_placeholder_identity_rejected(self):
        for ident in [("Your Name", "you@example.com"), ("", ""), ("Real Name", "me@example.com")]:
            with self.subTest(ident=ident):
                repo = self.mkrepo(name="p" + str(abs(hash(ident))), identity=ident)
                self.put(repo, "pkg/a.py")
                code, out = self.cq("commit", repo, "pkg")
                self.assertEqual(code, 0, out)
                self.assertEqual(out["author"], "Test Person")  # fell back to config.json

    def test_no_identity_anywhere_aborts(self):
        repo = self.mkrepo(identity=("Your Name", "you@example.com"))
        self.put(repo, "pkg/a.py")
        before = g(repo, "rev-list", "--count", "HEAD").strip()
        code, out = self.cq("commit", repo, "pkg", cfg=self.config(identity={"name": "", "email": ""}))
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])
        self.assertIn("identity", out["error"])
        self.assertEqual(before, g(repo, "rev-list", "--count", "HEAD").strip())

    def test_commit_no_claude_trailer(self):
        repo = self.mkrepo()
        self.put(repo, "pkg/a.py")
        _, out = self.cq("commit", repo, "pkg")
        body = g(repo, "log", "-1", "--format=%B")
        self.assertNotIn("co-authored-by", body.lower())
        self.assertEqual(body.strip(), "pkg: 1 files")
        self.assertFalse(out["has_trailer"])

    def test_trailer_in_message_refused(self):
        repo = self.mkrepo()
        self.put(repo, "pkg/a.py")
        code, out = self.cq("commit", repo, "pkg", "-m", "x\n\nCo-Authored-By: Someone <s@x.org>")
        self.assertEqual(code, 2)
        self.assertEqual(g(repo, "rev-list", "--count", "HEAD").strip(), "1")

    def test_custom_message_used(self):
        repo = self.mkrepo()
        self.put(repo, "pkg/a.py")
        self.cq("commit", repo, "pkg", "-m", "add the a module")
        self.assertEqual(g(repo, "log", "-1", "--format=%s").strip(), "add the a module")

    def test_commit_leaves_other_staged_files_untouched(self):
        repo = self.mkrepo()
        self.put(repo, "other/staged.txt", "keep me staged\n")
        g(repo, "add", "other/staged.txt")
        self.put(repo, "pkg/a.py")
        code, out = self.cq("commit", repo, "pkg")
        self.assertEqual(code, 0, out)
        self.assertEqual(g(repo, "show", "--name-only", "--format=", "HEAD").split(), ["pkg/a.py"])
        self.assertEqual(g(repo, "diff", "--cached", "--name-only").split(), ["other/staged.txt"])

    def test_commit_refuses_when_files_changed_since_stat(self):
        repo = self.mkrepo()
        self.put(repo, "pkg/a.py", "one\n")
        _, st = self.cq("stat", repo, "pkg")
        self.put(repo, "pkg/b.py", "appeared after the stat\n")
        code, out = self.cq("commit", repo, "pkg", "--expect-hash", st["hash"])
        self.assertEqual(code, 2)
        self.assertIn("changed since", out["error"])
        self.assertEqual(g(repo, "rev-list", "--count", "HEAD").strip(), "1")
        # an unchanged group with the matching hash commits
        os.remove(os.path.join(repo, "pkg/b.py"))
        code, out = self.cq("commit", repo, "pkg", "--expect-hash", st["hash"])
        self.assertEqual(code, 0, out)

    def test_commit_handles_deletion_and_odd_names(self):
        repo = self.mkrepo()
        self.put(repo, "pkg/[x] *.txt", "glob chars\n")
        self.put(repo, "pkg/dir with space/é.txt", "u\n")
        g(repo, "add", "pkg")
        g(repo, "commit", "-qm", "base")
        os.remove(os.path.join(repo, "pkg/[x] *.txt"))
        self.put(repo, "pkg/new.txt", "n\n")
        self.put(repo, "pkg/dir with space/é.txt", "u2\n")
        code, out = self.cq("commit", repo, "pkg")
        self.assertEqual(code, 0, out)
        self.assertEqual(g(repo, "status", "--porcelain").strip(), "")

    def test_commit_never_runs_push(self):
        repo = self.mkrepo()  # no remote configured at all
        self.assertEqual(g(repo, "remote").strip(), "")
        self.put(repo, "pkg/a.py")
        shim = os.path.join(self.tmp, "shim")
        os.makedirs(shim)
        log = os.path.join(self.tmp, "git-calls.log")
        sh = os.path.join(shim, "git")
        with open(sh, "w") as f:
            f.write(f'#!/bin/sh\necho "$@" >> "{log}"\nexec "{REAL_GIT}" "$@"\n')
        os.chmod(sh, os.stat(sh).st_mode | statmod.S_IXUSR)
        env = dict(CLEAN_ENV, PATH=shim + os.pathsep + CLEAN_ENV["PATH"])
        code, out = self.cq("commit", repo, "pkg", env=env)
        self.assertEqual(code, 0, out)
        with open(log) as fh:
            calls = fh.read()
        self.assertIn("commit", calls)
        for banned in ["push", "reset", "checkout", "stash", "--amend", "--no-verify", "rebase", "restore", "clean"]:
            self.assertNotRegex(calls, r"(^|\s)" + banned + r"(\s|$)", banned)

    def test_commit_unknown_group_errors(self):
        repo = self.mkrepo()
        code, out = self.cq("commit", repo, "nope")
        self.assertEqual(code, 2)
        self.assertFalse(out["ok"])

    def test_commit_all_withheld_errors(self):
        repo = self.mkrepo()
        self.put(repo, ".env", "A=1\n")
        code, out = self.cq("commit", repo, "(root)")
        self.assertEqual(code, 2)
        self.assertIn("withheld", out["error"])


class Stat(Base):
    def test_stat_lists_files_with_counts_and_no_diff_body(self):
        repo = self.mkrepo()
        self.put(repo, "seed.txt", "seed\nplus\n")
        self.put(repo, "pkg/a.py", "1\n2\n")
        self.put(repo, "pkg/.env", "A=1\n")
        _, out = self.cq("stat", repo, "pkg")
        files = {f["path"]: f for f in out["files"]}
        self.assertEqual(files["pkg/a.py"]["added"], 2)
        self.assertEqual(files["pkg/.env"]["withheld"], "secret-name")
        self.assertNotIn("diff --git", json.dumps(out))
        self.assertNotIn("A=1", json.dumps(out))


if __name__ == "__main__":
    unittest.main()
