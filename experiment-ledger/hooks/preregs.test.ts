import { expect, test } from 'claude-code/testing'

import { bandLine, classify, collect, createdMs, DAY_MS, listText, parseScan, resolveKey, verdictJson, type Entry } from './preregs'

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0)
const ago = (d: number): number => NOW - d * DAY_MS
const e = (path: string, daysAgo: number): Entry => ({ mtimeMs: ago(daysAgo), path })
const none = new Map<string, string>()
const noAck = new Set<string>()
const items = (entries: Entry[], verdicts = none, acked = noAck) => classify(collect(entries), verdicts, acked, NOW)
const byKey = (xs: ReturnType<typeof items>, k: string) => xs.find(i => i.key === k)

test('parseScan keeps a path containing spaces and skips junk lines', () => {
  const out = parseScan('1793152675 /h/My Trading/prereg/a b.json\n\nnotanumber /x\n1793116990 /h/y.md\n5\n')
  expect(out).toEqual([
    { mtimeMs: 1793152675000, path: '/h/My Trading/prereg/a b.json' },
    { mtimeMs: 1793116990000, path: '/h/y.md' },
  ])
})

test('json prereg with a result and no verdict is unlogged, aged from the result', () => {
  const xs = items([e('/r/prereg/s1.json', 20), e('/r/prereg/s1.result.json', 3)])
  expect(xs.length).toBe(1)
  expect(xs[0]).toMatchObject({ key: 's1', kind: 'json', dir: '/r', state: 'unlogged', ageDays: 3 })
})

test('json prereg without a result is open, aged from its file time', () => {
  const xs = items([e('/r/prereg/s2.json', 2)])
  expect(xs[0]).toMatchObject({ state: 'open', ageDays: 2, resultMs: null })
})

test('a ledger slug match makes it done, and open all shows its verdict', () => {
  const xs = items([e('/r/prereg/s3.json', 9), e('/r/prereg/s3.result.json', 8)], new Map([['s3', 'FAIL']]))
  expect(xs[0]).toMatchObject({ state: 'done', verdict: 'FAIL' })
  expect(listText(xs, false)).not.toContain('s3  ')
  expect(listText(xs, true)).toContain('done FAIL')
})

test('createdMs and verdictJson read the slug files', () => {
  expect(createdMs('{"created_at":"2026-10-27T21:57:55-04:00"}')).toBe(Date.parse('2026-10-28T01:57:55Z'))
  expect(createdMs('{"created_at":"nope"}')).toBe(null)
  expect(createdMs('not json')).toBe(null)
  expect(verdictJson('{"schema":"verdict/2","slug":"k1","verdict":"INCONCLUSIVE"}')).toEqual({ slug: 'k1', verdict: 'INCONCLUSIVE' })
  expect(verdictJson('{"slug":"k2"}')).toEqual({ slug: 'k2', verdict: 'logged' })
  expect(verdictJson('{"verdict":"PASS"}')).toBe(null)
})

test('legacy md + sha without RESULT is open, aged from the sha mtime', () => {
  const xs = items([e('/p/PREREGISTRATION_v54.md', 30), e('/p/PREREG_v54.sha256', 21)])
  expect(xs.length).toBe(1)
  expect(xs[0]).toMatchObject({ key: 'v54', kind: 'legacy', state: 'open', ageDays: 21 })
})

test('legacy with a RESULT marker is done', () => {
  const xs = items([e('/p/PREREGISTRATION_v63.md', 20), e('/p/PREREG_v63.sha256', 20), e('/p/PREREG_v63_RESULT.sha256', 19)])
  expect(xs.length).toBe(1)
  expect(xs[0]).toMatchObject({ key: 'v63', state: 'done' })
})

test('v62_A1 is its own row, and a sha-only or md-only tag is a row', () => {
  const xs = items([
    e('/p/PREREG_v62.sha256', 5),
    e('/p/PREREG_v62_A1.sha256', 4),
    e('/p/PREREG_v58.sha256', 6),
    e('/p/PREREGISTRATION_v28_OVERWRITTEN_by_v29.md', 7),
  ])
  expect(xs.map(i => i.key).sort()).toEqual(['v28_OVERWRITTEN_by_v29', 'v58', 'v62', 'v62_A1'])
  expect(byKey(xs, 'v62_A1')?.ageDays).toBe(4)
  expect(byKey(xs, 'v62')?.ageDays).toBe(5)
})

test('untagged PREREG.sha256 and PREREGISTRATION.md are ignored; so are prereg/*.sha256 files', () => {
  const xs = items([
    e('/p/PREREG.sha256', 3),
    e('/p/PREREGISTRATION.md', 3),
    e('/r/prereg/s4.sha256', 3),
    e('/r/prereg/PREREG_x.sha256', 3),
    e('/r/prereg/s4.result.json', 1), // a result with no prereg file makes no row
  ])
  expect(xs).toEqual([])
})

test('ack hides from the list and the band', () => {
  const entries = [e('/p/PREREG_v54.sha256', 21), e('/p/PREREG_v60.sha256', 10)]
  expect(listText(items(entries), false)).toContain('v54')
  const xs = items(entries, none, new Set(['v54']))
  const t = listText(xs, false)
  expect(t).not.toContain('v54  ')
  expect(t).toContain('1 acked and hidden')
  expect(bandLine(xs)?.text).toBe('prereg: 1 waiting on a verdict, oldest 10d (v60). /experiments open')
  expect(bandLine(items(entries, none, new Set(['v54', 'v60'])))).toBe(null)
  expect(listText(xs, true)).toContain('ACKED')
})

test('resolveKey: exact, then unique suffix, else the matches', () => {
  const xs = items([e('/p/PREREG_v62_A1.sha256', 1), e('/p/PREREG_v58_A1.sha256', 1), e('/p/PREREG_v62.sha256', 1)])
  expect(resolveKey(xs, 'v62')).toEqual({ key: 'v62' })
  expect(resolveKey(xs, 'V62_a1')).toEqual({ key: 'v62_A1' })
  expect(resolveKey(xs, '58_A1')).toEqual({ key: 'v58_A1' })
  expect(resolveKey(xs, 'A1')).toEqual({ matches: ['v58_A1', 'v62_A1'] })
  expect(resolveKey(xs, 'zzz')).toEqual({ matches: [] })
  expect(resolveKey(xs, '')).toEqual({ matches: [] })
})

test('listText sorts oldest first and counts open vs unlogged', () => {
  const xs = items([e('/p/PREREG_a.sha256', 2), e('/p/PREREG_b.sha256', 9), e('/r/prereg/c.json', 30), e('/r/prereg/c.result.json', 4)])
  const lines = listText(xs, false).split('\n')
  expect(lines[0]).toBe('prereg: 3 waiting on a verdict (2 open, 1 unlogged)')
  expect(lines[1]).toContain('b  9d  open')
  expect(lines[2]).toContain('c  4d  unlogged')
  expect(lines[3]).toContain('a  2d  open')
})

test('bandLine: null under 7 days, amber at 7, red at 30', () => {
  const at = (d: number) => bandLine(items([e('/p/PREREG_x.sha256', d)]))
  expect(at(6)).toBe(null)
  expect(at(7)).toEqual({ text: 'prereg: 1 waiting on a verdict, oldest 7d (x). /experiments open', color: 'yellow' })
  expect(at(29)?.color).toBe('yellow')
  expect(at(30)?.color).toBe('red')
  expect(bandLine([])).toBe(null)
})
