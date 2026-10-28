import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { lookupText, parseIndex, query, summaryText, type Entry } from './lib'

const FILES: Entry[] = [
  { path: '/h/Trading/nq_bot/NQ_1m_kaggle_clean.parquet', symbol: 'NQ', tf: '1m', rows: 3_000_000, start: '2016-01-03T23:00:00+00:00', end: '2025-06-01T00:00:00+00:00', gaps: 12, largest_gap: { start: '2020-03-01T00:00:00+00:00', end: '2020-03-02T00:00:00+00:00', open_hours: 7 }, roll: 'forward-adjusted', bad: [{ id: 'kag', defect: '+1 min offset' }] },
  { path: '/h/Trading/propfarm/ES_5m.csv', symbol: 'ES', tf: '5m', rows: 1000, start: '2024-01-01T00:00:00+00:00', end: '2024-02-01T00:00:00+00:00', gaps: 0, roll: null, bad: null },
]
const INDEX = JSON.stringify({ generated: '2026-10-21T00:00:00+00:00', partial: false, files: FILES })
const cmd = (command: string, args = '') => ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false } }) as never
const text = (r: unknown) => String((r as { text?: string }).text)

test('query matches symbol and tf exactly and path text, all terms', () => {
  expect(query(FILES, 'nq 1m').length).toBe(1)
  expect(query(FILES, 'propfarm').map(f => f.symbol)).toEqual(['ES'])
  expect(query(FILES, 'ZB').length).toBe(0)
  expect(query(FILES, '').length).toBe(0)
})

test('lookup text shows range, rows, gaps, roll and the bad flag', () => {
  const t = lookupText(parseIndex(INDEX), 'NQ')
  expect(t).toContain('2016-01-03 -> 2025-06-01')
  expect(t).toContain('3,000,000 rows')
  expect(t).toContain('12 gaps, max 7h @2020-03-01')
  expect(t).toContain('roll forward-adjusted')
  expect(t).toContain('BAD: +1 min offset')
  expect(lookupText(parseIndex(INDEX), 'ES')).toContain('clean')
})

test('summary text reads the script result and its error', () => {
  expect(summaryText('progress\n{"ok": true, "count": 9, "bad": 2, "partial": false, "seconds": 3.1}')).toBe('data-index: 9 files (2 flagged bad) in 3.1s')
  expect(summaryText('{"ok": true, "count": 9, "bad": 0, "partial": true, "seconds": 540}')).toContain('partial')
  expect(summaryText('{"error": "boom"}')).toBe('data-index failed: boom')
  expect(summaryText('')).toContain('failed')
})

const OK = '{"ok": true, "count": 2, "bad": 1, "partial": false, "seconds": 1.5}\n'

function engine(on: On, seen: { reads: string[]; argv: string[][]; toasts: string[] }, index: string | null, stdout = OK) {
  mock.env(on, { HOME: '/h' })
  on('fs.read', (_, e) => {
    seen.reads.push(String((e as { path?: string }).path ?? e))
    return index == null ? { deny: 'ENOENT' } : { value: index }
  })
  on('process.run', (_, e) => {
    seen.argv.push([...((e as { argv: readonly string[] }).argv ?? [])])
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
}

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

test('/data prints the matching rows from index.json', async ($, on) => {
  const seen = { reads: [] as string[], argv: [] as string[][], toasts: [] as string[] }
  engine(on, seen, INDEX)
  const t = text(await $.command.run(cmd('data', 'ES 5m')))
  expect(t).toContain('1 match "ES 5m"')
  expect(t).toContain('/h/Trading/propfarm/ES_5m.csv')
  expect(t.includes('kaggle')).toBe(false)
})

test('/data with no match says so', async ($, on) => {
  const seen = { reads: [] as string[], argv: [] as string[][], toasts: [] as string[] }
  engine(on, seen, INDEX)
  expect(text(await $.command.run(cmd('data', 'ZB')))).toContain('no files match "ZB"')
})

test('/data with no index.json says run /dataindex', async ($, on) => {
  const seen = { reads: [] as string[], argv: [] as string[][], toasts: [] as string[] }
  engine(on, seen, null)
  expect(text(await $.command.run(cmd('data', 'NQ')))).toContain('run /dataindex')
})

test('/dataindex answers started at once and toasts the result when the script exits', async ($, on) => {
  const seen = { reads: [] as string[], argv: [] as string[][], toasts: [] as string[] }
  engine(on, seen, INDEX)
  const t = text(await $.command.run(cmd('dataindex')))
  expect(t).toContain('started')
  await settle()
  expect(seen.argv.length).toBe(1)
  expect(seen.argv[0]?.[0]).toBe('python3')
  expect(String(seen.argv[0]?.[1])).toContain('scripts/build_data_index.py')
  expect(seen.toasts).toEqual(['data-index: 2 files (1 flagged bad) in 1.5s'])
})

test('/dataindex reports a script failure in the toast, not as a success', async ($, on) => {
  const seen = { reads: [] as string[], argv: [] as string[][], toasts: [] as string[] }
  engine(on, seen, INDEX, '{"error": "PermissionError: x"}')
  await $.command.run(cmd('dataindex'))
  await settle()
  expect(seen.toasts).toEqual(['data-index failed: PermissionError: x'])
})

// Realistic paths: the folder mnq-mgc-research holds "nq", and "es" sits inside
// trades, tests and Desktop. Symbol and tf terms must match their fields only.
const REAL: Entry[] = [
  { path: '/Users/x/Trading/mnq-mgc-research/data/cache/tsmom/6E_F.parquet', symbol: '6E', tf: '1d' },
  { path: '/Users/x/Trading/mnq-mgc-research/MGC_1m.parquet', symbol: 'MGC', tf: '1m' },
  { path: '/Users/x/Trading/mnq-mgc-research/MNQ_1m.parquet', symbol: 'MNQ', tf: '1m' },
  { path: '/Users/x/Trading/_from_Desktop/databento_share/trades_ES.csv', symbol: 'ES', tf: null },
  { path: '/Users/x/Trading/nq_bot/tests/results_GC_5m.csv', symbol: 'GC', tf: '5m' },
  { path: '/Users/x/Trading/nq_bot/NQ_1m_primary.parquet', symbol: 'NQ', tf: '1m' },
  { path: '/Users/x/Trading/propfarm/notes_15m.csv', symbol: null, tf: '15m' },
]

test('a symbol term matches only that symbol, never MNQ files or path text', () => {
  expect(query(REAL, 'NQ').map(f => f.symbol)).toEqual(['NQ'])
  expect(query(REAL, 'es').map(f => f.symbol)).toEqual(['ES'])
  expect(query(REAL, 'MNQ').map(f => f.symbol)).toEqual(['MNQ'])
  expect(query(REAL, 'NQ 1m').map(f => f.symbol)).toEqual(['NQ'])
})

test('a tf term matches only the tf field; other text still matches the path', () => {
  expect(query(REAL, '5m').map(f => f.symbol)).toEqual(['GC'])
  expect(query(REAL, '3m').length).toBe(0)
  expect(query(REAL, 'nq_bot').map(f => f.symbol)).toEqual(['GC', 'NQ'])
  expect(query(REAL, 'databento').map(f => f.symbol)).toEqual(['ES'])
})

function reads(on: On, files: Record<string, string | 'ENOENT' | 'TOOBIG'>, size = 0) {
  mock.env(on, { HOME: '/h' })
  const asked: string[] = []
  on('fs.read', (_, e) => {
    const p = String((e as { path?: string }).path ?? e)
    asked.push(p)
    const v = files[p] ?? 'ENOENT'
    return v === 'ENOENT' ? { deny: 'ENOENT' } : v === 'TOOBIG' ? { deny: 'EFBIG: over 4 MiB' } : { value: v }
  })
  on('fs.stat', () => ({ value: { kind: 'file', size, mtimeMs: 0, isLink: false } }) as never)
  return asked
}

test('/data reads index.lookup.json first', async ($, on) => {
  const asked = reads(on, { '/h/Trading/_data/index.lookup.json': INDEX })
  expect(text(await $.command.run(cmd('data', 'ES 5m')))).toContain('1 match "ES 5m"')
  expect(asked).toEqual(['/h/Trading/_data/index.lookup.json'])
})

test('/data falls back to index.json when there is no lookup file', async ($, on) => {
  const asked = reads(on, { '/h/Trading/_data/index.json': INDEX })
  expect(text(await $.command.run(cmd('data', 'ES 5m')))).toContain('1 match "ES 5m"')
  expect(asked).toEqual(['/h/Trading/_data/index.lookup.json', '/h/Trading/_data/index.json'])
})

test('/data says the index is too large when a read fails for size, not "run /dataindex"', async ($, on) => {
  reads(on, { '/h/Trading/_data/index.lookup.json': 'TOOBIG' }, 5 * 1024 * 1024)
  const t = text(await $.command.run(cmd('data', 'NQ')))
  expect(t).toContain('5.0 MiB, over the 4 MiB')
  expect(t).toContain('index.lookup.json')
  expect(t.includes('run /dataindex')).toBe(false)
})
