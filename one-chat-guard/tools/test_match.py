"""Tests for match.py. Synthetic chats only: no real titles, prompts or transcripts."""
import unittest

from match import content_words, jaccard, match, norm_title

NOW = 1_800_000_000_000
H = 3_600_000
PA = 'refactor the invoice exporter module to stream rows into the ledger writer with retries'
PB = 'refactor the invoice exporter module to stream rows into the ledger writer with backoff'
PC = 'design a nightly cron schedule for pruning stale cache directories and notifying admins'


def chat(sid, title='', cwd='/w/app', prompt='', idle_h=1.0, **kw):
    d = {'sessionId': sid, 'title': title, 'cwd': cwd, 'prompt': prompt,
         'lastActivityAt': int(NOW - idle_h * H), 'isArchived': False}
    d.update(kw)
    return d


def ids(new, others, **kw):
    return [m['sessionId'] for m in match(new, others, now_ms=NOW, **kw)]


class Helpers(unittest.TestCase):
    def test_norm_title(self):
        self.assertEqual(norm_title('  Fork of Fork of  Build: the THING!! '), 'build the thing')
        self.assertEqual(norm_title('...'), '')

    def test_content_words(self):
        self.assertEqual(content_words('Fix the Bug, in a module of 42 ok'), {'fix', 'bug', 'module'})

    def test_jaccard(self):
        self.assertEqual(jaccard({'a', 'b'}, {'b', 'c'}), 1 / 3)
        self.assertEqual(jaccard(set(), set()), 0.0)
        self.assertEqual(jaccard({'a'}, {'a'}), 1.0)


class Match(unittest.TestCase):
    def test_equal_titles_match(self):
        new = chat('n', 'Ledger exporter build', cwd='/other')
        out = match(new, [chat('a', 'ledger EXPORTER build!', idle_h=2)], now_ms=NOW)
        self.assertEqual([m['sessionId'] for m in out], ['a'])
        self.assertEqual(out[0]['score'], 1.0)
        self.assertEqual(out[0]['reason'], 'title')
        self.assertEqual(out[0]['title'], 'ledger EXPORTER build!')
        self.assertEqual(out[0]['idleMs'], 2 * H)

    def test_fork_prefix_ignored(self):
        new = chat('n', 'Ledger exporter build')
        self.assertEqual(ids(new, [chat('a', 'Fork of Ledger exporter build')]), ['a'])

    def test_same_cwd_similar_prompt_matches(self):
        new = chat('n', 'Untitled', prompt=PB)
        out = match(new, [chat('a', 'Something else', prompt=PA)], now_ms=NOW)
        self.assertEqual([m['sessionId'] for m in out], ['a'])
        self.assertEqual(out[0]['reason'], 'prompt')
        self.assertAlmostEqual(out[0]['score'], 0.8)
        self.assertEqual(ids(new, [chat('a', 'Something else', prompt=PA)], min_jaccard=0.9), [])
        self.assertEqual(ids(new, [chat('c', 'Other', prompt=PC)]), [])

    def test_different_cwd_never_matches_on_prompt(self):
        new = chat('n', 'Untitled', prompt=PB)
        self.assertEqual(ids(new, [chat('a', 'Other', cwd='/w/elsewhere', prompt=PA)]), [])

    def test_archived_excluded(self):
        new = chat('n', 'Same title')
        self.assertEqual(ids(new, [chat('a', 'Same title', isArchived=True)]), [])

    def test_routine_excluded(self):
        new = chat('n', 'Same title')
        self.assertEqual(ids(new, [chat('a', 'Same title', scheduledTaskId='task_1')]), [])

    def test_parent_child_excluded(self):
        new = chat('n', 'Same title')
        child = chat('a', 'Same title', spawnedFrom={'sessionId': 'n', 'sideSession': True})
        self.assertEqual(ids(new, [child]), [])
        new2 = chat('n', 'Same title', spawnedFrom={'sessionId': 'p'})
        self.assertEqual(ids(new2, [chat('p', 'Same title')]), [])
        self.assertEqual(ids(new2, [chat('q', 'Same title')]), ['q'])

    def test_self_excluded(self):
        new = chat('n', 'Same title')
        self.assertEqual(ids(new, [chat('n', 'Same title')]), [])

    def test_short_prompt_never_matches_by_prompt(self):
        short = 'fix invoice exporter bug'
        new = chat('n', 'Untitled', prompt=short)
        self.assertEqual(ids(new, [chat('a', 'Other', prompt=short)]), [])
        self.assertEqual(ids(chat('n', 'Untitled', prompt=PA), [chat('a', 'Other', prompt=short)]), [])

    def test_ranks_newest_first(self):
        new = chat('n', 'Same title')
        others = [chat('old', 'Same title', idle_h=50), chat('new', 'Same title', idle_h=1),
                  chat('mid', 'Same title', idle_h=10)]
        self.assertEqual(ids(new, others), ['new', 'mid', 'old'])

    def test_limit_three(self):
        new = chat('n', 'Same title')
        others = [chat(f'c{i}', 'Same title', idle_h=i + 1) for i in range(5)]
        self.assertEqual(ids(new, others), ['c0', 'c1', 'c2'])
        self.assertEqual(len(match(new, others, now_ms=NOW, limit=2)), 2)

    def test_ignore_titles_and_empty_titles(self):
        new = chat('n', 'New chat')
        self.assertEqual(ids(new, [chat('a', 'New chat')], ignore_titles=['new chat']), [])
        self.assertEqual(ids(new, [chat('a', 'New chat')]), ['a'])
        self.assertEqual(ids(chat('n', ''), [chat('a', '')]), [])
        self.assertEqual(ids(chat('n', '!!!'), [chat('a', '...')]), [])


if __name__ == '__main__':
    unittest.main()
