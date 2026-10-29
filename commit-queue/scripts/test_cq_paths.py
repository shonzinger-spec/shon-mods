import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cq_paths import group_key, is_secret_line, is_secret_path, parse_porcelain_z


class IsSecretPath(unittest.TestCase):
    def test_withheld(self):
        for p in [
            ".env", ".env.local", ".env.production", "app/.env", "a/b/.env.test",
            "server.pem", "x/cert.PEM", "store.p12", "id_rsa", "id_rsa.pub", "home/.ssh/id_rsa_work",
            "api.key", "a/b/signing.KEY", "apikey.txt", "my_key_file.json",
            "secrets.yaml", "app_secret.json", "client-secret.txt",
            "token.txt", "github_token", "auth-tokens.json",
            "credentials", "credentials.json", "aws/credentials.bak",
            "release.keystore", "debug.keystore",
        ]:
            with self.subTest(p=p):
                self.assertTrue(is_secret_path(p))

    def test_benign(self):
        for p in [
            "README.md", "src/main.py", "hooks/register.tsx", "scripts/commit_queue.py",
            "data/prices.csv", "env.md", "docs/environment.txt", "notes.txt",
            "dir/readme.md", "résumé.docx", "my file.txt",
        ]:
            with self.subTest(p=p):
                self.assertFalse(is_secret_path(p))

    def test_false_positive_accepted(self):
        self.assertTrue(is_secret_path("keyboard-notes.md"))
        self.assertTrue(is_secret_path("docs/monkey.py"))

    def test_only_basename_counts(self):
        self.assertFalse(is_secret_path("keys/readme.md"))
        self.assertFalse(is_secret_path("secrets/readme.md"))


# Key-shaped text is assembled at run time so this file holds no literal secret.
SK = "sk" + "-ant-"
AK = "AK" + "IA"
BEGIN = "-----" + "BEGIN "
END = "PRIVATE KEY" + "-----"


class IsSecretLine(unittest.TestCase):
    def test_hits(self):
        for t in [
            "ANTHROPIC=" + SK + "api03-abcdef",
            "x = '" + SK + "xyz'",
            "id = " + AK + "A" * 16,
            BEGIN + "RSA " + END,
            BEGIN + END,
            BEGIN + "OPENSSH " + END,
            "api_key = abcdefghijklmnop1234",
            "API-KEY: 0123456789abcdef0123",
            "apikey=ABCDEFGHIJKLMNOPQRSTUV",
            'config = {"api_key": "abcdefghijklmnopqrst"}',
        ]:
            with self.subTest(t=t):
                self.assertTrue(is_secret_line(t))

    def test_misses(self):
        for t in [
            "",
            "hello world",
            "api_key = short",
            "api_key = None",
            AK + "123",
            BEGIN + "CERTIFICATE-----",
            "def get_api_key(): pass",
            "sk-other-abc",
        ]:
            with self.subTest(t=t):
                self.assertFalse(is_secret_line(t))


class GroupKey(unittest.TestCase):
    def test_cases(self):
        table = {
            "health-band/hooks/register.tsx": "health-band",
            "health-band/README.md": "health-band",
            "README.md": "(root)",
            ".gitignore": "(root)",
            "a/b/c/d.txt": "a",
            "dir with space/file.txt": "dir with space",
            "ünï/x.py": "ünï",
        }
        for path, want in table.items():
            with self.subTest(path=path):
                self.assertEqual(group_key(path), want)


class ParsePorcelainZ(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(parse_porcelain_z(b""), [])

    def test_basic(self):
        raw = b" M a/b.py\0?? new file.txt\0A  c.md\0"
        self.assertEqual(parse_porcelain_z(raw), [(" M", "a/b.py"), ("??", "new file.txt"), ("A ", "c.md")])

    def test_rename_returns_new_path_and_drops_old(self):
        raw = b"R  new/name.py\0old/name.py\0 M other.py\0"
        self.assertEqual(parse_porcelain_z(raw), [("R ", "new/name.py"), (" M", "other.py")])

    def test_copy_entry_drops_origin(self):
        raw = b"C  copy.py\0orig.py\0?? z.txt\0"
        self.assertEqual(parse_porcelain_z(raw), [("C ", "copy.py"), ("??", "z.txt")])

    def test_unicode_and_spaces(self):
        raw = " M dir with space/résumé.txt\0?? ünï/日本.md\0".encode("utf-8")
        self.assertEqual(parse_porcelain_z(raw), [(" M", "dir with space/résumé.txt"), ("??", "ünï/日本.md")])

    def test_worktree_rename(self):
        raw = b" R x.py\0y.py\0"
        self.assertEqual(parse_porcelain_z(raw), [(" R", "x.py")])

    def test_no_trailing_nul(self):
        self.assertEqual(parse_porcelain_z(b" M a.py"), [(" M", "a.py")])


if __name__ == "__main__":
    unittest.main()
