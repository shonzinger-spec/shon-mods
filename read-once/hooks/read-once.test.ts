import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { clear, forget, isNonText, isRanged, record, refusal } from './lib.ts'

type Files = Record<string, { mtimeMs: number; size: number }>

// The test stands for the engine: fs.stat answers from `files`, the turn counter
// from `turn.n`, and every Read/Write/... call is answered by a tool.call hook
// that counts how often the tool really ran.
function engine(on: On, files: Files, turn = { n: 1 }, result: unknown = { type: 'text', file: { filePath: 'x', content: 'c' } }) {
  const ran: string[] = []
  on('fs.stat', (_, e) => {
    const f = files[(e as { path: string }).path]
    if (!f) throw new Error('ENOENT')
    return { value: { kind: 'file', size: f.size, mtimeMs: f.mtimeMs, isLink: false } } as never
  })
  on('session.turns', () => ({ value: turn.n }) as never)
  on('tool.call', (_, e) => {
    ran.push(e.tool)
    return { result } as never
  })
  return ran
}

const read = ($: any, file_path: string, extra: Record<string, unknown> = {}, agentId?: string) =>
  $.tool.call({ tool: 'Read', file_path, ...extra, ...(agentId ? { agentId } : {}) })

test('lib: refusal needs same mtime and size; record/forget/clear', () => {
  const l = new Map()
  record(l, 'main', '/a', { mtimeMs: 1, size: 2 }, 5)
  expect(refusal(l, 'main', '/a', { mtimeMs: 1, size: 2 })).toContain('turn 5')
  expect(refusal(l, 'main', '/a', { mtimeMs: 2, size: 2 })).toBeUndefined()
  expect(refusal(l, 'main', '/a', { mtimeMs: 1, size: 3 })).toBeUndefined()
  expect(refusal(l, 'sub', '/a', { mtimeMs: 1, size: 2 })).toBeUndefined()
  forget(l, 'main', '/a')
  expect(refusal(l, 'main', '/a', { mtimeMs: 1, size: 2 })).toBeUndefined()
  record(l, 'main', '/a', { mtimeMs: 1, size: 2 }, 1)
  record(l, 'sub', '/a', { mtimeMs: 1, size: 2 }, 1)
  clear(l, 'sub')
  expect(refusal(l, 'main', '/a', { mtimeMs: 1, size: 2 })).toBeDefined()
  clear(l, 'main')
  expect(l.size).toBe(0)
})

test('lib: ranged and non-text detection', () => {
  expect(isRanged({})).toBe(false)
  expect(isRanged({ offset: 1 })).toBe(true)
  expect(isRanged({ limit: 5 })).toBe(true)
  expect(isRanged({ pages: '1-2' })).toBe(true)
  for (const p of ['/a.png', '/a.JPG', '/a.pdf', '/a.ipynb', '/a.webp', '/a.gif']) expect(isNonText(p)).toBe(true)
  expect(isNonText('/a.ts')).toBe(false)
})

test('second whole-file Read of an unchanged file is denied with the turn of the first', async ($, on) => {
  const turn = { n: 3 }
  const ran = engine(on, { '/p/a.ts': { mtimeMs: 10, size: 100 } }, turn)
  const first = await read($, '/p/a.ts')
  expect(first.deny).toBeUndefined()
  turn.n = 7
  const second = await read($, '/p/a.ts')
  expect(second.deny).toContain('unchanged since last read at turn 3')
  expect(second.deny).toContain('offset/limit')
  expect(ran.length).toBe(1)
})

test('Read with offset or limit is allowed and does not arm the denial', async ($, on) => {
  const ran = engine(on, { '/p/a.ts': { mtimeMs: 10, size: 100 } })
  expect((await read($, '/p/a.ts', { offset: 5 })).deny).toBeUndefined()
  expect((await read($, '/p/a.ts', { limit: 5 })).deny).toBeUndefined()
  // a ranged read is not a whole read, so the first whole read still passes
  expect((await read($, '/p/a.ts')).deny).toBeUndefined()
  expect((await read($, '/p/a.ts', { offset: 1, limit: 2 })).deny).toBeUndefined()
  expect((await read($, '/p/a.ts')).deny).toContain('unchanged')
  expect(ran.length).toBe(4)
})

test('a changed mtime or size allows the re-read, and the new state is what is remembered', async ($, on) => {
  const files: Files = { '/p/a.ts': { mtimeMs: 10, size: 100 } }
  engine(on, files)
  await read($, '/p/a.ts')
  files['/p/a.ts'] = { mtimeMs: 11, size: 100 }
  expect((await read($, '/p/a.ts')).deny).toBeUndefined()
  expect((await read($, '/p/a.ts')).deny).toContain('unchanged')
  files['/p/a.ts'] = { mtimeMs: 11, size: 101 }
  expect((await read($, '/p/a.ts')).deny).toBeUndefined()
})

test('images, PDFs and notebooks are never refused', async ($, on) => {
  const files: Files = {}
  for (const f of ['/p/a.png', '/p/b.pdf', '/p/c.ipynb']) files[f] = { mtimeMs: 1, size: 1 }
  engine(on, files)
  for (const f of Object.keys(files)) {
    expect((await read($, f)).deny).toBeUndefined()
    expect((await read($, f)).deny).toBeUndefined()
  }
})

test('a non-text result (image content in a .txt) is not remembered', async ($, on) => {
  engine(on, { '/p/odd.txt': { mtimeMs: 1, size: 1 } }, { n: 1 }, { type: 'image', file: {} })
  await read($, '/p/odd.txt')
  expect((await read($, '/p/odd.txt')).deny).toBeUndefined()
})

test('a token-cap truncated read is not remembered', async ($, on) => {
  engine(on, { '/p/big.txt': { mtimeMs: 1, size: 1 } }, { n: 1 }, { type: 'text', file: { truncatedByTokenCap: true } })
  await read($, '/p/big.txt')
  expect((await read($, '/p/big.txt')).deny).toBeUndefined()
})

test('Write, Edit, MultiEdit and NotebookEdit to the path reset its entry', async ($, on) => {
  const files: Files = { '/p/a.ts': { mtimeMs: 10, size: 100 } }
  engine(on, files)
  const writes: Array<[string, Record<string, unknown>]> = [
    ['Write', { file_path: '/p/a.ts', content: 'x' }],
    ['Edit', { file_path: '/p/a.ts', old_string: 'a', new_string: 'b' }],
    ['MultiEdit', { file_path: '/p/a.ts', edits: [] }],
    ['NotebookEdit', { notebook_path: '/p/a.ts', new_source: 'x' }],
  ]
  for (const [tool, args] of writes) {
    await read($, '/p/a.ts')
    // identical mtime+size (a rewrite of equal length in the same millisecond)
    await $.tool.call({ tool, ...args })
    expect((await read($, '/p/a.ts')).deny).toBeUndefined()
  }
  // a write to another path leaves it armed
  await $.tool.call({ tool: 'Write', file_path: '/p/other.ts', content: 'x' })
  expect((await read($, '/p/a.ts')).deny).toContain('unchanged')
})

test('session.compact clears everything; a vetoed compaction keeps the ledger', async ($, on) => {
  engine(on, { '/p/a.ts': { mtimeMs: 1, size: 1 } })
  let veto = true
  on('session.compact', () => (veto ? ({ skip: 'off' } as never) : ({ messages: [{ role: 'user', text: 'kept', toolUses: [] }] } as never)))
  await read($, '/p/a.ts')
  await $.session.compact({ messages: [{ role: 'user', text: 'x', toolUses: [] }] } as never)
  expect((await read($, '/p/a.ts')).deny).toContain('unchanged')
  veto = false
  await $.session.compact({ messages: [{ role: 'user', text: 'x', toolUses: [] }] } as never)
  expect((await read($, '/p/a.ts')).deny).toBeUndefined()
})

test('a subagent has its own ledger', async ($, on) => {
  engine(on, { '/p/a.ts': { mtimeMs: 1, size: 1 } })
  await read($, '/p/a.ts')
  expect((await read($, '/p/a.ts', {}, 'sub1')).deny).toBeUndefined()
  expect((await read($, '/p/a.ts', {}, 'sub1')).deny).toContain('unchanged')
  expect((await read($, '/p/a.ts')).deny).toContain('unchanged')
})

test('fails open: a stat that throws lets the Read run', async ($, on) => {
  const ran = engine(on, {})
  const r = await read($, '/missing.ts')
  expect(r.deny).toBeUndefined()
  expect(ran).toEqual(['Read'])
})
