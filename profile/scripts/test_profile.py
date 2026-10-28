import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name('profile.py')


class ProfileTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.settings = self.root / 'settings.json'
        self.installed = self.root / 'installed.json'
        self.state = self.root / 'state'
        self.original = {
            'enabledPlugins': {
                'leak-lint@shon-mods': True,
                'trader-skill@trader-skill': True,
                'searchfit-seo@knowledge-work-plugins': True,
                'unrelated@x': True,
            },
            'otherSetting': {'kept': True},
        }
        self.settings.write_text(json.dumps(self.original), encoding='utf-8')
        self.installed.write_text(json.dumps({'plugins': {}}), encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def invoke(self, *args):
        return subprocess.run(['python3', str(SCRIPT), '--settings', str(self.settings), '--installed', str(self.installed), '--state-dir', str(self.state), *args], text=True, capture_output=True)

    def read_settings(self):
        return json.loads(self.settings.read_text(encoding='utf-8'))

    def test_switch_trading_preserves_other_settings_and_creates_backup(self):
        result = self.invoke('switch', 'trading')
        self.assertEqual(result.returncode, 0, result.stderr)
        settings = self.read_settings()
        self.assertTrue(settings['otherSetting']['kept'])
        enabled = settings['enabledPlugins']
        self.assertTrue(enabled['leak-lint@shon-mods'])
        self.assertTrue(enabled['trader-skill@trader-skill'])
        self.assertFalse(enabled['searchfit-seo@knowledge-work-plugins'])
        self.assertFalse(enabled['unrelated@x'])
        self.assertTrue(list(self.state.glob('settings.backup-*.json')))

    def test_all_snapshot_is_created_once_and_all_restores_it_exactly(self):
        self.assertEqual(self.invoke('switch', 'trading').returncode, 0)
        snapshot = (self.state / 'all.json').read_bytes()
        self.assertEqual(self.invoke('switch', 'coding').returncode, 0)
        self.assertEqual((self.state / 'all.json').read_bytes(), snapshot)
        self.assertEqual(self.invoke('switch', 'all').returncode, 0)
        self.assertEqual(self.read_settings()['enabledPlugins'], self.original['enabledPlugins'])

    def test_bad_name_leaves_settings_identical(self):
        before = self.settings.read_bytes()
        result = self.invoke('switch', 'nope')
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.settings.read_bytes(), before)

    def test_measure_counts_fake_plugin_tree(self):
        plugin = self.root / 'fake'
        (plugin / 'commands').mkdir(parents=True)
        (plugin / 'agents').mkdir()
        (plugin / 'SKILL.md').write_text('---\ndescription: skill one\n---\n', encoding='utf-8')
        (plugin / 'nested').mkdir()
        (plugin / 'nested' / 'SKILL.md').write_text('---\ndescription: >\n  skill two\n---\n', encoding='utf-8')
        (plugin / 'commands' / 'x.md').write_text('---\ndescription: command\n---\n', encoding='utf-8')
        (plugin / 'agents' / 'y.md').write_text('---\ndescription: agent\n---\n', encoding='utf-8')
        self.settings.write_text(json.dumps({'enabledPlugins': {'fake@x': True}}), encoding='utf-8')
        self.installed.write_text(json.dumps({'plugins': {'fake@x': [{'installPath': str(plugin)}]}}), encoding='utf-8')
        result = self.invoke('measure')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('plugins 1 (unknown 0), skills 2, commands 1, agents 1, desc_chars 30, ~tokens 7', result.stdout)

    def make_profiles(self):
        path = self.root / 'profiles.json'
        path.write_text(json.dumps({
            'core': ['leak-lint@shon-mods'],
            'agent': ['hand@made'],
            '_aliases': {'agent stuff': 'agent'},
        }), encoding='utf-8')
        return path

    def make_log(self, rows):
        path = self.root / 'tool-log.jsonl'
        path.write_text('\n'.join(json.dumps(r) for r in rows) + '\n', encoding='utf-8')
        return path

    def with_profiles(self, profiles, *args):
        return self.invoke('--profiles', str(profiles), *args)

    def test_aliases_and_multiword_arg_switch(self):
        profiles = self.make_profiles()
        result = self.with_profiles(profiles, 'switch', 'agent stuff')
        self.assertEqual(result.returncode, 0, result.stderr)
        enabled = self.read_settings()['enabledPlugins']
        self.assertTrue(enabled['hand@made'])
        self.assertFalse(enabled['unrelated@x'])
        result = self.with_profiles(profiles, 'switch', 'Agent', 'Stuff')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_alias_key_is_not_a_profile(self):
        profiles = self.make_profiles()
        self.assertEqual(self.with_profiles(profiles, 'switch', '_aliases').returncode, 2)
        listed = self.with_profiles(profiles, 'list')
        self.assertEqual(listed.returncode, 0, listed.stderr)
        self.assertNotIn('_aliases', listed.stdout)
        self.assertIn('agent: 2 plugins, ~tokens 0', listed.stdout)

    def installed_with(self, *ids):
        self.installed.write_text(json.dumps({'plugins': {i: [{'installPath': '/missing'}] for i in ids}}), encoding='utf-8')

    LOG = [
        {'session': 's1', 'section': 'Video Lab', 'kind': 'mcp', 'plugin': 'postiz', 'name': 'a'},
        {'session': 's2', 'section': 'video  lab', 'kind': 'skill', 'plugin': 'postiz', 'name': 'b'},
        {'session': 's2', 'section': 'Video Lab', 'kind': 'skill', 'plugin': 'brand-voice', 'name': 'c'},
        {'session': 's2', 'section': 'Video Lab', 'kind': 'connector', 'plugin': 'figma', 'name': 'd'},
        {'session': 's3', 'section': 'Video Lab', 'kind': 'skill', 'plugin': 'notinstalled', 'name': 'e'},
        {'session': 's9', 'section': 'agent stuff', 'kind': 'skill', 'plugin': 'postiz', 'name': 'f'},
    ]

    def test_learn_from_fixture_log(self):
        profiles = self.make_profiles()
        log = self.make_log(self.LOG)
        self.installed_with('postiz@kw', 'brand-voice@kw', 'figma@kw')
        result = self.with_profiles(profiles, '--tool-log', str(log), 'learn', 'Video Lab')
        self.assertEqual(result.returncode, 0, result.stderr)
        learned = json.loads(profiles.read_text(encoding='utf-8'))
        self.assertEqual(learned['video lab'], ['brand-voice@kw', 'postiz@kw'])
        self.assertIn('3 session(s)', result.stdout)
        self.assertIn('postiz@kw', result.stdout)
        self.assertIn('agent stuff', learned['_aliases'])

    def test_learn_refuses_overwrite_without_force(self):
        profiles = self.make_profiles()
        log = self.make_log(self.LOG)
        self.installed_with('postiz@kw')
        before = profiles.read_bytes()
        result = self.with_profiles(profiles, '--tool-log', str(log), 'learn', 'agent stuff')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(profiles.read_bytes(), before)
        result = self.with_profiles(profiles, '--tool-log', str(log), 'learn', 'agent stuff', '--force')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(profiles.read_text(encoding='utf-8'))['agent'], ['postiz@kw'])

    def test_learn_without_log_says_so(self):
        profiles = self.make_profiles()
        result = self.with_profiles(profiles, '--tool-log', str(self.root / 'nope.jsonl'), 'learn', 'x')
        self.assertEqual(result.returncode, 0)
        self.assertIn('no tool log yet', result.stdout)

    def test_auto_creates_only_missing(self):
        profiles = self.make_profiles()
        log = self.make_log(self.LOG)
        self.installed_with('postiz@kw', 'brand-voice@kw')
        result = self.with_profiles(profiles, '--tool-log', str(log), 'auto')
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(profiles.read_text(encoding='utf-8'))
        self.assertEqual(data['agent'], ['hand@made'])
        self.assertEqual(data['video lab'], ['brand-voice@kw', 'postiz@kw'])
        self.assertEqual(sorted(k for k in data if not k.startswith('_')), ['agent', 'core', 'video lab'])

    def test_measure_named_profile(self):
        plugin = self.root / 'fake'
        plugin.mkdir()
        (plugin / 'SKILL.md').write_text('---\ndescription: skill one\n---\n', encoding='utf-8')
        self.installed.write_text(json.dumps({'plugins': {'hand@made': [{'installPath': str(plugin)}]}}), encoding='utf-8')
        profiles = self.make_profiles()
        result = self.with_profiles(profiles, 'measure', 'agent stuff')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('plugins 2 (unknown 1), skills 1, commands 0, agents 0, desc_chars 9, ~tokens 2', result.stdout)
        self.assertEqual(self.with_profiles(profiles, 'measure', 'nope').returncode, 2)


if __name__ == '__main__':
    unittest.main()
