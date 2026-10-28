#!/usr/bin/env python3
"""Switch and inspect Claude Code plugin profiles without non-stdlib dependencies."""

import argparse
import json
import os
import re
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PROFILES_PATH = ROOT / 'profiles.json'
TOOL_LOG_PATH = ROOT.parent / 'usage-coach' / 'state' / 'tool-log.jsonl'
ALIASES_KEY = '_aliases'


class ProfileError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        with path.open(encoding='utf-8') as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        raise ProfileError(f'{path}: {exc}') from exc


def raw_profiles() -> dict[str, Any]:
    value = load_json(PROFILES_PATH)
    if not isinstance(value, dict):
        raise ProfileError(f'{PROFILES_PATH}: expected an object of plugin lists')
    return value


def profiles() -> dict[str, list[str]]:
    # Keys starting with "_" (such as _aliases) are metadata, not profiles.
    value = {k: v for k, v in raw_profiles().items() if not k.startswith('_')}
    if not all(isinstance(v, list) and all(isinstance(x, str) for x in v) for v in value.values()):
        raise ProfileError(f'{PROFILES_PATH}: expected an object of plugin lists')
    return value


def normalise(name: str) -> str:
    return re.sub(r'\s+', ' ', name.strip().lower())


def aliases() -> dict[str, str]:
    value = raw_profiles().get(ALIASES_KEY, {})
    if not isinstance(value, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in value.items()):
        raise ProfileError(f'{PROFILES_PATH}: {ALIASES_KEY} must map names to profile names')
    return {normalise(k): v for k, v in value.items()}


def resolve(name: str) -> str:
    """Profile name for a typed name or sidebar section name (aliases applied)."""
    key = normalise(name)
    return aliases().get(key, key)


def write_profiles(value: dict[str, Any]) -> None:
    lines = [f' {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in value.items()]
    path = PROFILES_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', suffix='.tmp', dir=path.parent)
    with os.fdopen(fd, 'w', encoding='utf-8') as handle:
        handle.write('{\n' + ',\n'.join(lines) + '\n}\n')
    os.replace(temporary, path)


def enabled_plugins(settings: dict[str, Any]) -> dict[str, bool]:
    value = settings.get('enabledPlugins', {})
    if not isinstance(value, dict) or not all(isinstance(k, str) and isinstance(v, bool) for k, v in value.items()):
        raise ProfileError('settings enabledPlugins must be an object whose values are booleans')
    return value


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(value, handle, indent=2)
            handle.write('\n')
        os.replace(temporary, path)
    except OSError:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def atomic_bytes(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(value)
        os.replace(temporary, path)
    except OSError:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def desired(profile: str, profile_lists: dict[str, list[str]], snapshot: dict[str, bool]) -> dict[str, bool]:
    if profile == 'all':
        return dict(snapshot)
    if profile not in profile_lists or profile == 'core':
        raise ProfileError(f'unknown profile: {profile}')
    on = set(profile_lists['core']) | set(profile_lists[profile])
    result = {plugin: plugin in on for plugin in snapshot}
    result.update({plugin: True for plugin in on if plugin not in result})
    return result


def selected(value: dict[str, bool]) -> set[str]:
    return {name for name, is_enabled in value.items() if is_enabled}


def backup_path(state_dir: Path) -> Path:
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    return state_dir / f'settings.backup-{stamp}.json'


def switch(name: str, settings_path: Path, installed_path: Path, state_dir: Path) -> None:
    profile_lists = profiles()
    name = 'all' if normalise(name) == 'all' else resolve(name)
    if name != 'all' and (name not in profile_lists or name == 'core'):
        raise ProfileError(f'unknown profile: {name}')
    settings = load_json(settings_path)
    if not isinstance(settings, dict):
        raise ProfileError(f'{settings_path}: expected a JSON object')
    try:
        settings_bytes = settings_path.read_bytes()
    except OSError as exc:
        raise ProfileError(f'{settings_path}: {exc}') from exc
    current = enabled_plugins(settings)
    all_path = state_dir / 'all.json'
    snapshot = load_json(all_path) if all_path.exists() else dict(current)
    if not isinstance(snapshot, dict) or not all(isinstance(k, str) and isinstance(v, bool) for k, v in snapshot.items()):
        raise ProfileError(f'{all_path}: expected an enabledPlugins object')
    new_enabled = desired(name, profile_lists, snapshot)

    # Complete every state write before touching settings, so a state error cannot
    # leave settings partially changed.
    state_dir.mkdir(parents=True, exist_ok=True)
    if not all_path.exists():
        atomic_json(all_path, snapshot)
    backup = backup_path(state_dir)
    while backup.exists():
        backup = backup.with_name(f'{backup.stem}-1{backup.suffix}')
    atomic_bytes(backup, settings_bytes)
    settings['enabledPlugins'] = new_enabled
    atomic_json(settings_path, settings)
    on = len(selected(new_enabled))
    off = len(new_enabled) - on
    print(f'profile {name}: {on} on, {off} off. Backup: {backup}. Start a NEW session for it to take effect.')
    print(measure_text(new_enabled, installed_path))


def folded_description(text: str) -> str:
    lines = text.splitlines()
    if not lines or lines[0].strip() != '---':
        return ''
    end = next((i for i in range(1, len(lines)) if lines[i].strip() in ('---', '...')), None)
    if end is None:
        return ''
    frontmatter = lines[1:end]
    for i, line in enumerate(frontmatter):
        if not line.startswith('description:'):
            continue
        value = line[len('description:'):].strip()
        if value.startswith(('>', '|')):
            parts: list[str] = []
            for following in frontmatter[i + 1:]:
                if following and not following[0].isspace():
                    break
                if following.strip():
                    parts.append(following.strip())
            return ' '.join(parts)
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            return value[1:-1]
        return value
    return ''


def measure(enabled: dict[str, bool], installed_path: Path) -> tuple[int, int, int, int, int, int]:
    installed = load_json(installed_path)
    plugins = installed.get('plugins') if isinstance(installed, dict) else None
    if not isinstance(plugins, dict):
        raise ProfileError(f'{installed_path}: expected plugins object')
    count = unknown = skills = commands = agents = desc_chars = 0
    for plugin in sorted(selected(enabled)):
        count += 1
        record = plugins.get(plugin)
        install_path = record[0].get('installPath') if isinstance(record, list) and record and isinstance(record[0], dict) else None
        if not isinstance(install_path, str) or not Path(install_path).is_dir():
            unknown += 1
            continue
        root = Path(install_path)
        files = list(root.rglob('SKILL.md'))
        skills += len(files)
        command_files = [p for p in root.rglob('*.md') if 'commands' in p.relative_to(root).parts]
        agent_files = [p for p in root.rglob('*.md') if 'agents' in p.relative_to(root).parts]
        commands += len(command_files)
        agents += len(agent_files)
        for path in files + command_files + agent_files:
            try:
                desc_chars += len(folded_description(path.read_text(encoding='utf-8')))
            except OSError as exc:
                raise ProfileError(f'{path}: {exc}') from exc
    return count, unknown, skills, commands, agents, desc_chars


def measure_text(enabled: dict[str, bool], installed_path: Path) -> str:
    count, unknown, skills, commands, agents, desc_chars = measure(enabled, installed_path)
    return f'plugins {count} (unknown {unknown}), skills {skills}, commands {commands}, agents {agents}, desc_chars {desc_chars}, ~tokens {desc_chars // 4}'


def profile_enabled(name: str, profile_lists: dict[str, list[str]]) -> dict[str, bool]:
    if name not in profile_lists:
        raise ProfileError(f'unknown profile: {name}')
    return {plugin: True for plugin in set(profile_lists['core']) | set(profile_lists[name])}


def profile_tokens(name: str, profile_lists: dict[str, list[str]], installed_path: Path) -> int:
    return measure(profile_enabled(name, profile_lists), installed_path)[5] // 4


def list_profiles(settings_path: Path, state_dir: Path, installed_path: Path) -> None:
    profile_lists = profiles()
    settings = load_json(settings_path)
    if not isinstance(settings, dict):
        raise ProfileError(f'{settings_path}: expected a JSON object')
    current = enabled_plugins(settings)
    snapshot_path = state_dir / 'all.json'
    snapshot = load_json(snapshot_path) if snapshot_path.exists() else None
    matches: list[str] = []
    for name in profile_lists:
        if name == 'core':
            continue
        size = len(set(profile_lists['core']) | set(profile_lists[name]))
        print(f'{name}: {size} plugins, ~tokens {profile_tokens(name, profile_lists, installed_path)}')
        if isinstance(snapshot, dict) and current == desired(name, profile_lists, snapshot):
            matches.append(name)
    if isinstance(snapshot, dict):
        print(f'all: {len(selected(snapshot))} plugins')
        if current == snapshot:
            matches.append('all')
    else:
        print('all: snapshot not created yet')
    print(f'current: {", ".join(matches) if matches else "custom"}')


def read_log(log_path: Path) -> list[dict[str, Any]] | None:
    if not log_path.exists():
        return None
    rows: list[dict[str, Any]] = []
    with log_path.open(encoding='utf-8') as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict) and isinstance(row.get('section'), str):
                rows.append(row)
    return rows


def installed_ids(installed_path: Path) -> list[str]:
    plugins = load_json(installed_path).get('plugins', {})
    return sorted(plugins) if isinstance(plugins, dict) else []


def learn(section: str, rows: list[dict[str, Any]], installed_path: Path, force: bool, quiet_empty: bool = False) -> bool:
    target = resolve(section)
    raw = raw_profiles()
    if target in profiles() and not force:
        raise ProfileError(f'profile {target} already exists; use --force to overwrite it')
    if target in ('core', 'all') or target.startswith('_'):
        raise ProfileError(f'cannot learn into reserved name: {target}')
    mine = [r for r in rows if resolve(r['section']) == target]
    sessions = {r.get('session') for r in mine}
    names = {r['plugin'] for r in mine if isinstance(r.get('plugin'), str) and r.get('kind') != 'connector'}
    ids = sorted({i for i in installed_ids(installed_path) if i.split('@')[0] in names})
    if not ids:
        if not quiet_empty:
            print(f'learn {target}: no installed plugins found in {len(sessions)} session(s); nothing written')
        return False
    raw[target] = ids
    write_profiles(raw)
    print(f'learn {target}: {len(ids)} plugin(s) from {len(sessions)} session(s): {", ".join(ids)}')
    return True


def auto(rows: list[dict[str, Any]], installed_path: Path) -> None:
    existing = set(profiles())
    seen: list[str] = []
    for row in rows:
        target = resolve(row['section'])
        if target not in existing and target not in seen:
            seen.append(target)
    for target in seen:
        learn(target, rows, installed_path, force=False, quiet_empty=True)
    if not seen:
        print('auto: every section already has a profile')


def main(argv: list[str] | None = None) -> int:
    global PROFILES_PATH
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--settings', type=Path, default=Path('~/.claude/settings.json').expanduser())
    parser.add_argument('--installed', type=Path, default=Path('~/.claude/plugins/installed_plugins.json').expanduser())
    parser.add_argument('--state-dir', type=Path, default=ROOT / 'state')
    parser.add_argument('--profiles', type=Path, default=PROFILES_PATH)
    parser.add_argument('--tool-log', type=Path, default=TOOL_LOG_PATH)
    parser.add_argument('--force', action='store_true')
    parser.add_argument('command', nargs='?')
    parser.add_argument('name', nargs='*')
    args = parser.parse_intermixed_args(argv)
    PROFILES_PATH = args.profiles
    name = ' '.join(args.name)
    try:
        if args.command == 'switch' and name:
            switch(name, args.settings, args.installed, args.state_dir)
        elif args.command == 'list' and not name:
            list_profiles(args.settings, args.state_dir, args.installed)
        elif args.command == 'measure':
            profile_lists = profiles()
            if not name:
                settings = load_json(args.settings)
                if not isinstance(settings, dict):
                    raise ProfileError(f'{args.settings}: expected a JSON object')
                enabled = enabled_plugins(settings)
            elif normalise(name) == 'all':
                snapshot_path = args.state_dir / 'all.json'
                if not snapshot_path.exists():
                    raise ProfileError('all snapshot has not been created yet; switch a profile first')
                snapshot = load_json(snapshot_path)
                if not isinstance(snapshot, dict):
                    raise ProfileError(f'{snapshot_path}: expected an enabledPlugins object')
                enabled = dict(snapshot)
            else:
                enabled = profile_enabled(resolve(name), profile_lists)
            print(measure_text(enabled, args.installed))
        elif args.command in ('learn', 'auto'):
            rows = read_log(args.tool_log)
            if rows is None:
                print('no tool log yet')
            elif args.command == 'learn':
                if not name:
                    raise ProfileError('learn needs a section name')
                learn(name, rows, args.installed, args.force)
            else:
                auto(rows, args.installed)
        else:
            print(f'unknown subcommand: {args.command or ""}', file=sys.stderr)
            return 2
    except ProfileError as exc:
        print(f'profile: {exc}', file=sys.stderr)
        return 2 if str(exc).startswith('unknown profile:') else 1
    except OSError as exc:
        print(f'profile: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
