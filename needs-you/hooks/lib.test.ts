import { expect, test } from 'claude-code/testing'

import type { ChatRow, Scan } from '../types'
import { ageText, group, listText, parseScan, rowLine, runningIds, statusText } from './lib'

const NOW = 1_800_000_000_000
const row = (o: Partial<ChatRow>): ChatRow => ({
  sessionId: 'local_a', title: 'A chat', status: 'done', kind: null, question: null, question_source: null,
  last_activity_ms: NOW - 3 * 3_600_000, error: null, ...o,
})
const SCAN: Scan = {
  now_ms: NOW,
  rows: [
    row({ sessionId: 'd1' }),
    row({ sessionId: 'w1', title: 'Newer wait', status: 'waiting', question: 'Merge it?', question_source: 'wrap_up', last_activity_ms: NOW - 60_000 }),
    row({ sessionId: 'w2', title: 'Older wait', status: 'waiting', question: 'Pick one', question_source: 'summary', last_activity_ms: NOW - 5 * 86_400_000 }),
    row({ sessionId: 's1', title: 'Cut off', status: 'stalled', kind: 'limit', error: 'hit your session limit', last_activity_ms: NOW - 600_000 }),
    row({ sessionId: 'r1', status: 'working' }),
  ],
}

test('age text uses minutes, hours, days', () => {
  expect(ageText(NOW, NOW - 5 * 60_000)).toBe('5m')
  expect(ageText(NOW, NOW - 3 * 3_600_000)).toBe('3h')
  expect(ageText(NOW, NOW - 3 * 86_400_000)).toBe('3d')
  expect(ageText(NOW, null)).toBe('?')
})

test('groups sort oldest first, the own chat is left out, status line counts waiting and stalled', () => {
  const g = group(SCAN)
  expect(g.waiting.map(r => r.sessionId)).toEqual(['w2', 'w1'])
  expect(statusText(g)).toBe('2 waiting, 1 stalled')
  expect(group(SCAN, 'w1').waiting.length).toBe(1)
  expect(statusText(group({ now_ms: NOW, rows: [row({})] }))).toBeUndefined()
})

test('summary questions are marked as not verbatim; exact ones are not', () => {
  expect(rowLine(SCAN.rows[2] as ChatRow, NOW)).toContain('(app summary, not verbatim)')
  expect(rowLine(SCAN.rows[1] as ChatRow, NOW)).toBe('Newer wait · 1m · Merge it?')
})

test('text list has stalled before waiting, each with a chat link', () => {
  const t = listText(SCAN)
  expect(t.indexOf('Stalled')).toBeLessThan(t.indexOf('Waiting on you'))
  expect(t).toContain('[#w1]')
  expect(t.split('\n')[0]).toBe('1 stalled, 2 waiting, 1 working, 1 done')
})

test('parsers tolerate junk', () => {
  expect(parseScan('nope')).toBeNull()
  expect(parseScan('{"now_ms":1,"rows":[{"x":1},{"sessionId":"a","status":"done"}]}')?.rows.length).toBe(1)
  expect(runningIds('Error: too big')).toEqual([])
  expect(runningIds(JSON.stringify([{ sessionId: 'a', isRunning: true }, { sessionId: 'b', isRunning: false }]))).toEqual(['a'])
})
