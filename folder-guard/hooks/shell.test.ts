import { expect, test } from 'claude-code/testing'

import { leadingCd, resolvePath, segments, targetsOf, writtenFiles } from './shell'

const written = (cmd: string) => segments(cmd).flatMap(s => writtenFiles(s))

test('redirect targets are found; quoted > and fd redirects are not targets', () => {
  expect(written("echo 'a > b' > out.txt")).toEqual(['out.txt'])
  expect(written('cat x 2>/dev/null >> log.txt')).toEqual(['/dev/null', 'log.txt'])
  expect(written('make 2>&1 | tee build.log')).toEqual(['build.log'])
  expect(written("ls -l ~/Trading | grep -c -- '->'")).toEqual([])
  expect(written('python -c "print(1 > 0)"')).toEqual([])
})

test('heredoc bodies are skipped, their redirect kept', () => {
  const cmd = "cat > /tmp/x.ts <<'EOF'\nconst f = ($, e) => next(e)\nexport x > y\nEOF\necho done > /tmp/done"
  expect(written(cmd)).toEqual(['/tmp/x.ts', '/tmp/done'])
})

test('programs that write: sed -i, mv, cp dest, rm, touch, mkdir, git checkout', () => {
  expect(written("sed -i '' 's/1.3/1.1/' PREREGISTRATION_v59.md")).toEqual(['s/1.3/1.1/', 'PREREGISTRATION_v59.md'])
  expect(written('sed -n 1p PREREGISTRATION_v59.md')).toEqual([])
  expect(written('mv a.json b.json')).toEqual(['a.json', 'b.json'])
  expect(written('cp src.md dest.md')).toEqual(['dest.md'])
  expect(written('rm -f x && touch y; mkdir -p z/w')).toEqual(['x', 'y', 'z/w'])
  expect(written('git checkout -- prereg/a.json')).toEqual(['prereg/a.json'])
  expect(written('FOO=1 sudo tee out.txt')).toEqual(['out.txt'])
})

test('create mode: only what a command may bring into being', () => {
  const created = (cmd: string) => segments(cmd).flatMap(s => writtenFiles(s, 'create'))
  expect(created('rm -f a; sed -i x b; git checkout c')).toEqual([])
  expect(created('mkdir -p ~/new && touch ~/new/a.txt')).toEqual(['~/new', '~/new/a.txt'])
  expect(created('cp a.py b.py ~/Desktop/')).toEqual(['~/Desktop/', '~/Desktop/a.py', '~/Desktop/b.py'])
  expect(created('echo hi > ~/x.txt')).toEqual(['~/x.txt'])
})

test('targetsOf follows cd between segments and expands simple variables', () => {
  expect(targetsOf('mkdir -p ~/.claude/a && cd ~/.claude/a && cat > SKILL.md <<EOF\nx\nEOF', '/h', '/h', 'create'))
    .toEqual(['/h/.claude/a', '/h/.claude/a/SKILL.md'])
  expect(targetsOf('cd ~/repo\nmkdir -p research/x', '/h', '/h', 'create')).toEqual(['/h/repo/research/x'])
  expect(targetsOf('S=~/Desktop/share; mkdir -p $S/raw', '/h', '/h', 'create')).toEqual(['/h/Desktop/share/raw'])
  expect(targetsOf('S=$(mktemp -d); echo x > $S/a; touch "$1"/b', '/h', '/h', 'create')).toEqual([])
  expect(targetsOf('for f in a b; do cp $f ~/x/$f.bak; done', '/h', '/h', 'create')).toEqual([])
  expect(targetsOf('(cd /r && echo x > out.txt)', '/h', '/h', 'create')).toEqual(['/r/out.txt'])
  expect(targetsOf('echo x 2>/dev/null > ${HOME}/a.txt', '/h', '/h', 'create')).toEqual(['/h/a.txt'])
})

test('paths resolve against cwd, a leading cd, ~ and $HOME', () => {
  expect(resolvePath('a/../b.md', '/r/x', '/h')).toBe('/r/x/b.md')
  expect(resolvePath('../b.md', '/r/x', '/h')).toBe('/r/b.md')
  expect(resolvePath('~/Desktop/n.py', '/r', '/h')).toBe('/h/Desktop/n.py')
  expect(resolvePath('$HOME/n.py', '/r', '/h')).toBe('/h/n.py')
  expect(leadingCd('cd /r/p && sed -i x f', '/s')).toBe('/r/p')
  expect(leadingCd('ls', '/s')).toBe('/s')
})
