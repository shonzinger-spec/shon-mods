"""hooks/policy.ts and hooks/policy_cases.ts are byte copies of verdict-line's (fix there, re-copy).

The plugin test suite only checks the local policy.ts against the local policy_cases.ts, and both are
copied together, so it cannot see drift from verdict-line. This test compares the bytes.
"""
import pathlib
import unittest

HOOKS = pathlib.Path(__file__).resolve().parent.parent / "hooks"
SOURCE = HOOKS.parent.parent / "verdict-line" / "hooks"
COPIES = ("policy.ts", "policy_cases.ts")


class PolicyCopyTest(unittest.TestCase):
    def test_copies_match_verdict_line_byte_for_byte(self):
        for name in COPIES:
            with self.subTest(file=name):
                src = SOURCE / name
                self.assertTrue(src.is_file(), f"missing source {src}")
                self.assertEqual(
                    (HOOKS / name).read_bytes(),
                    src.read_bytes(),
                    f"variant-counter/hooks/{name} differs from {src}: re-copy it from verdict-line",
                )


if __name__ == "__main__":
    unittest.main()
