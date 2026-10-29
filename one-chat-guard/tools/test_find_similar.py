"""find_similar.py against a temp tree of synthetic chats and transcripts (no real data)."""
import contextlib
import io
import json
import os
import tempfile
import unittest

import find_similar as fs

NOW = 1_800_000_000_000
H = 3_600_000
P1 = 'refactor the invoice exporter module to stream rows into the ledger writer with retries'
P2 = 'refactor the invoice exporter module to stream rows into the ledger writer with backoff'


class Tree(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        r = self.tmp.name
        self.sess, self.proj, self.state = (os.path.join(r, d) for d in ('sess', 'proj', 'state'))
        os.makedirs(os.path.join(self.sess, 'a', 'b'))
        os.makedirs(os.path.join(self.proj, '-w-app'))

    def tearDown(self):
        self.tmp.cleanup()

    def chat(self, sid, title, cwd='/w/app', prompt=None, idle_h=1, **kw):
        d = {'sessionId': 'local_' + sid, 'cliSessionId': 'cli-' + sid, 'title': title, 'cwd': cwd,
             'lastActivityAt': NOW - idle_h * H, 'isArchived': False}
        d.update(kw)
        with open(os.path.join(self.sess, 'a', 'b', 'local_%s.json' % sid), 'w') as f:
            json.dump(d, f)
        if prompt is not None:
            lines = [{'type': 'user', 'isMeta': True, 'message': {'content': 'meta noise'}},
                     {'type': 'user', 'message': {'content': '<system-reminder>x</system-reminder>'}},
                     {'type': 'assistant', 'message': {'content': 'hi'}},
                     {'type': 'user', 'message': {'content': [{'type': 'text', 'text': prompt}]}}]
            with open(os.path.join(self.proj, '-w-app', 'cli-%s.jsonl' % sid), 'w') as f:
                f.write('\n'.join(json.dumps(x) for x in lines))

    def raw_chat(self, sid, title, content):
        """Chat whose transcript has one user message with exactly this content, then tool results."""
        self.chat(sid, title)
        lines = [{'type': 'user', 'message': {'content': content}},
                 {'type': 'user', 'message': {'content': [{'type': 'tool_result', 'content': 'x'}]}}]
        with open(os.path.join(self.proj, '-w-app', 'cli-%s.jsonl' % sid), 'w') as f:
            f.write('\n'.join(json.dumps(x) for x in lines))

    def run_cli(self, *args, stdin=''):
        argv = ['--sessions-root', self.sess, '--projects-root', self.proj, '--state-dir', self.state,
                '--now-ms', str(NOW), *args]
        out = io.StringIO()
        old = fs.sys.stdin
        fs.sys.stdin = io.StringIO(stdin)
        try:
            with contextlib.redirect_stdout(out):
                self.assertEqual(fs.main(argv), 0)
        finally:
            fs.sys.stdin = old
        return out.getvalue()

    def test_prompt_match_via_stdin_and_cache(self):
        self.chat('old', 'Ledger work', prompt=P1)
        out = json.loads(self.run_cli('--cwd', '/w/app', '--prompt-file', '-', '--self-id', 'local_me', stdin=P2))
        self.assertEqual([m['sessionId'] for m in out['matches']], ['local_old'])
        with open(os.path.join(self.state, 'firstprompts.json')) as f:
            cache = f.read()
        self.assertIn('invoice', cache)
        self.assertNotIn('refactor the invoice', cache)  # words only, never the sentence
        os.remove(os.path.join(self.proj, '-w-app', 'cli-old.jsonl'))
        out2 = json.loads(self.run_cli('--cwd', '/w/app', '--prompt-file', '-', stdin=P2))
        self.assertEqual(out2['matches'], [])

    def match_ids(self):
        out = json.loads(self.run_cli('--cwd', '/w/app', '--prompt-file', '-', '--self-id', 'local_me', stdin=P2))
        return [m['sessionId'] for m in out['matches']]

    def test_prompt_starting_with_paste_still_matches(self):
        self.raw_chat('paste', 'Ledger work', '\n\n<pasted_content id="1">' + P1 + '</pasted_content>')
        self.assertEqual(self.match_ids(), ['local_paste'])

    def test_prompt_with_system_reminder_prefix_still_matches(self):
        self.raw_chat('rem', 'Ledger work', '<system-reminder>ctx words here</system-reminder>\n' + P1)
        self.assertEqual(self.match_ids(), ['local_rem'])

    def test_all_text_blocks_are_joined(self):
        self.raw_chat('blocks', 'Ledger work', [{'type': 'text', 'text': '<system-reminder>x</system-reminder>'},
                                                {'type': 'text', 'text': P1}])
        self.assertEqual(self.match_ids(), ['local_blocks'])

    def test_command_wrapper_message_still_skipped(self):
        self.raw_chat('cmd', 'Ledger work', '<command-name>/clear</command-name>')
        self.assertEqual(self.match_ids(), [])

    def test_title_match_and_self_excluded_by_cli_id(self):
        self.chat('me', 'Same task')
        self.chat('other', 'Same task', cwd='/else')
        out = json.loads(self.run_cli('--cwd', '/w/app', '--title', 'same task', '--self-cli', 'cli-me'))
        self.assertEqual([m['sessionId'] for m in out['matches']], ['local_other'])

    def test_archived_routine_and_spawned_excluded(self):
        self.chat('me', 'Same task')
        self.chat('arch', 'Same task', isArchived=True)
        self.chat('rout', 'Same task', scheduledTaskId='task_1')
        self.chat('kid', 'Same task', spawnedFrom={'sessionId': 'local_me'})
        out = json.loads(self.run_cli('--cwd', '/w/app', '--title', 'Same task', '--self-id', 'local_me'))
        self.assertEqual(out['matches'], [])

    def test_dry_run_lists_mutual_matches(self):
        for i in range(3):
            self.chat('c%d' % i, 'Conductor build')
        self.chat('z', 'Unrelated')
        text = self.run_cli('--dry-run')
        self.assertEqual(text.count('~'), 6)
        self.assertNotIn('Unrelated', text)


if __name__ == '__main__':
    unittest.main()
