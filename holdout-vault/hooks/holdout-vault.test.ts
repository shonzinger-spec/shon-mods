import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { burnedSlugs, matches } from './lib'

// /h/data/oos.parquet is a confirmed holdout; /h/link/oos.parquet is a symlink to it.
// /h/data/old.parquet is confirmed but burned per memory; /h/data/maybe.parquet is NOT confirmed.
const VAULT = {
  ledger: '~/_ledger/burns.jsonl',
  files: [
    { match: '~/data/oos.parquet', slug: 'oos', confirmed: true },
    { match: '~/data/old.parquet', slug: 'old', confirmed: true, burned_per_memory: true },
    { match: '~/data/maybe.parquet', slug: 'maybe', confirmed: false },
    { match: '~/sealed/*.enc', slug: 'enc', confirmed: true },
  ],
}

type World = { ledger: string | null; writes: number; toasts: string[] }

function engine(on: On, vault: unknown = VAULT): World {
  const w: World = { ledger: null, writes: 0, toasts: [] }
  mock.env(on, { HOME: '/h' })
  on('session.start', () => ({ cwd: '/h' }))
  on('session.cwd', () => ({ value: '/h' }))
  on('command.register', () => ({ value: { command: 'burn' } }))
  on('clock.now', () => ({ value: 0 }))
  on('fs.read', (_, e) => {
    const p = (e as { path: string }).path
    if (p.endsWith('/vault.json')) return { value: JSON.stringify(vault) }
    if (p === '/h/_ledger/burns.jsonl' && w.ledger !== null) return { value: w.ledger }
    return { deny: 'ENOENT' }
  })
  on('fs.write', (_, e) => {
    const x = e as { path: string; text: string }
    if (x.path === '/h/_ledger/burns.jsonl') { w.ledger = x.text; w.writes++ }
    return { value: undefined }
  })
  // /h/hub/sealed is a symlinked folder -> /h/sealed (like ~/Trading/competition -> ~/competition)
  on('fs.stat', (_, e) => {
    const p = (e as { path: string }).path
    if (p === '/h/link/oos.parquet') return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: true, realPath: '/h/data/oos.parquet' } }
    if (p === '/h/hub/sealed') return { value: { kind: 'dir', size: 1, mtimeMs: 0, isLink: true, realPath: '/h/sealed' } }
    return { deny: 'ENOENT' }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push((e as { text: string }).text)
    return { value: undefined }
  })
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', () => ({ result: {} }))
  return w
}

const start = { cwd: '/h', surface: 'desktop', isInteractive: true } as const
const BURN = (slug: string) => ({ command: 'burn', args: slug, origin: { kind: 'composer' }, presentation: { isFullscreen: false } }) as never

test('matching: exact, folder prefix, glob', () => {
  expect(matches('/h/d/x.csv', '/h/d/x.csv')).toBe(true)
  expect(matches('/h/d/x.csv', '/h/d')).toBe(true)
  expect(matches('/h/dd/x.csv', '/h/d')).toBe(false)
  expect(matches('/h/s/a.enc', '/h/s/*.enc')).toBe(true)
  expect(matches('/h/s/q/a.enc', '/h/s/*.enc')).toBe(false)
  expect(burnedSlugs('{"event":"BURNED","slug":"a"}\nnot json\n', [{ match: 'x', slug: 'b', burned_per_memory: true }])).toEqual(new Set(['b', 'a']))
})

test('writes to a confirmed holdout are refused (Write, Edit, Bash redirect, via symlink)', async ($, on) => {
  engine(on)
  await $.session.start(start)
  expect(String((await $.tool.call({ tool: 'Write', file_path: '/h/data/oos.parquet', content: 'x' })).deny)).toContain('read-only')
  expect(String((await $.tool.call({ tool: 'Edit', file_path: '/h/data/old.parquet', old_string: 'a', new_string: 'b' })).deny)).toContain('read-only')
  expect(String((await $.tool.call({ tool: 'Bash', command: 'echo x > data/oos.parquet' })).deny)).toContain('"oos"')
  expect(String((await $.tool.call({ tool: 'Write', file_path: '/h/link/oos.parquet', content: 'x' })).deny)).toContain('read-only')
})

test('opening an unburned holdout asks; a burned one is allowed', async ($, on) => {
  engine(on)
  await $.session.start(start)
  const a = await $.tool.check({ tool: 'Read', input: { file_path: '/h/data/oos.parquet' } })
  expect(a.decision).toBe('ask')
  expect(String(a.reason)).toContain('BURNS holdout "oos"')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'python3 -c "import sys" sealed/NQ.enc' } })).decision).toBe('ask')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'head -3 /h/link/oos.parquet' } })).decision).toBe('ask')
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/h/data/old.parquet' } })).decision).toBe('allow')
})

test('a Read that runs burns once per slug; then it is allowed with a toast', async ($, on) => {
  const w = engine(on)
  await $.session.start(start)
  const r = await $.tool.call({ tool: 'Read', file_path: '/h/data/oos.parquet' })
  expect(String(r.context?.join(' '))).toContain('BURNED "oos"')
  expect(w.ledger).toContain('"event":"BURNED"')
  expect(w.ledger).toContain('"slug":"oos"')
  await $.tool.call({ tool: 'Bash', command: 'wc -l data/oos.parquet' })
  expect(w.writes).toBe(1)
  expect(w.toasts.join(' ')).toContain('already burned')
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/h/data/oos.parquet' } })).decision).toBe('allow')
})

test('/burn appends BURNED, then Read is allowed with a toast', async ($, on) => {
  const w = engine(on)
  await $.session.start(start)
  const r = await $.command.run(BURN('enc'))
  expect(String((r as { text?: string }).text)).toContain('BURNED "enc"')
  expect(w.ledger).toContain('"slug":"enc"')
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/h/sealed/ES.enc' } })).decision).toBe('allow')
  const c = await $.tool.call({ tool: 'Read', file_path: '/h/sealed/ES.enc' })
  expect(c.deny).toBeUndefined()
  expect(w.toasts.join(' ')).toContain('"enc" is already burned')
  expect(w.writes).toBe(1)
  expect(String(((await $.command.run(BURN('maybe'))) as { text?: string }).text)).toContain('Usage')
})

test('G-neg: an unconfirmed entry is not enforced', async ($, on) => {
  const w = engine(on)
  await $.session.start(start)
  expect((await $.tool.call({ tool: 'Write', file_path: '/h/data/maybe.parquet', content: 'x' })).deny).toBeUndefined()
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/h/data/maybe.parquet' } })).decision).toBe('allow')
  await $.tool.call({ tool: 'Read', file_path: '/h/data/maybe.parquet' })
  expect(w.writes).toBe(0)
})

test('normal work: unrelated reads, writes and Bash are untouched', async ($, on) => {
  const w = engine(on)
  await $.session.start(start)
  expect((await $.tool.call({ tool: 'Write', file_path: '/h/src/engine.py', content: 'x' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Read', file_path: '/h/data/train.parquet' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'cat data/train.parquet > /tmp/x && ls data' })).deny).toBeUndefined()
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'python3 run.py --data data/oos_notes.txt' } })).decision).toBe('allow')
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/h/data/train.parquet' } })).decision).toBe('allow')
  expect(w.writes).toBe(0)
  expect(w.toasts).toEqual([])
})

test('HV-1 a vault.json with the wrong shape seals nothing and blocks nothing', async ($, on) => {
  const w = engine(on, { ledger: '~/_ledger/burns.jsonl', entries: VAULT.files })
  await $.session.start(start)
  expect((await $.tool.call({ tool: 'Write', file_path: '/h/src/a.py', content: 'x' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'ls /h/src' } })).decision).toBe('allow')
  expect(w.toasts.join(' ')).toContain('vault.json')
})

test('HV-1 a malformed entry is skipped; the well-formed ones stay sealed', async ($, on) => {
  const w = engine(on, { ledger: '~/_ledger/burns.jsonl', files: [{ path: '~/data/x.parquet', slug: 'x', confirmed: true }, 'junk', VAULT.files[0]] })
  await $.session.start(start)
  expect((await $.tool.call({ tool: 'Write', file_path: '/h/src/a.py', content: 'x' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Read', file_path: '/h/src/a.py' })).deny).toBeUndefined()
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'ls /h/src' } })).decision).toBe('allow')
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/h/data/oos.parquet' } })).decision).toBe('ask')
  expect(String((await $.tool.call({ tool: 'Write', file_path: '/h/data/oos.parquet', content: 'x' })).deny)).toContain('read-only')
  expect(w.toasts.join(' ')).toContain('skipped')
})

test('HV-2 a shell read through $HOME, a glob or a folder given to a recursive reader asks', async ($, on) => {
  const w = engine(on)
  await $.session.start(start)
  const chk = async (command: string) => (await $.tool.check({ tool: 'Bash', input: { command } })).decision
  for (const c of ['cat $HOME/data/oos.parquet', 'cat ${HOME}/data/oos.parquet', 'cat data/*.parquet', 'head -c 400 sealed/*.enc', 'tar czf /tmp/x.tgz sealed', 'grep -r needle data', 'cat /h/hub/sealed/*.enc'])
    expect(`${c}: ${await chk(c)}`).toBe(`${c}: ask`)
  expect((await $.tool.check({ tool: 'Grep', input: { pattern: 'x', path: '/h/sealed' } })).decision).toBe('ask')
  await $.tool.call({ tool: 'Bash', command: 'cat $HOME/data/oos.parquet' })
  expect(w.writes).toBe(1)
})

test('HV-2 negative: listing a folder, grepping a whole repo, other globs stay allowed', async ($, on) => {
  const w = engine(on)
  await $.session.start(start)
  for (const c of ['ls data', 'ls -la sealed', 'grep -r needle /h', 'rg needle .', 'cat data/*.csv', 'cat $HOME/data/train.parquet', 'cp data/train.parquet /tmp/'])
    expect(`${c}: ${(await $.tool.check({ tool: 'Bash', input: { command: c } })).decision}`).toBe(`${c}: allow`)
  expect((await $.tool.check({ tool: 'Grep', input: { pattern: 'x', path: '/h' } })).decision).toBe('allow')
  expect(w.writes).toBe(0)
})

test('HV-3 a glob delete through a symlinked folder is refused', async ($, on) => {
  engine(on)
  await $.session.start(start)
  expect(String((await $.tool.call({ tool: 'Bash', command: 'rm /h/hub/sealed/*.enc' })).deny)).toContain('"enc"')
  expect(String((await $.tool.call({ tool: 'Bash', command: 'rm /h/sealed/*.enc' })).deny)).toContain('"enc"')
  expect((await $.tool.call({ tool: 'Bash', command: 'rm /h/hub/other/*.enc' })).deny).toBeUndefined()
})

test('HV-4 git restore/checkout of a folder and git rm --cached are not refused; git rm of it is', async ($, on) => {
  engine(on)
  await $.session.start(start)
  for (const c of ['git restore .', 'git restore --staged .', 'git checkout -- .', 'git rm -r --cached data/'])
    expect(`${c}: ${String((await $.tool.call({ tool: 'Bash', command: c })).deny)}`).toBe(`${c}: undefined`)
  expect(String((await $.tool.call({ tool: 'Bash', command: 'git rm -r data' })).deny)).toContain('read-only')
  expect(String((await $.tool.call({ tool: 'Bash', command: 'git checkout -- data/oos.parquet' })).deny)).toContain('read-only')
})
