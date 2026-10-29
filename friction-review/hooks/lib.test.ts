import { expect, test } from 'claude-code/testing'
import { bandText, commandText, isUnread, parseLatest, parseReadDate } from './lib'

const L = { date: '2026-10-30', path: '/r.md', counts: { total: 9, patterns: 2 }, top3: [{ pattern: 'a', count: 5, sessions: 2 }] }

test('isUnread: only a report with patterns whose date was not read', () => {
  expect(isUnread(L, null)).toBe(true)
  expect(isUnread(L, '2026-10-23')).toBe(true)
  expect(isUnread(L, '2026-10-30')).toBe(false)
  expect(isUnread({ ...L, counts: { total: 0, patterns: 0 } }, null)).toBe(false)
  expect(isUnread(null, null)).toBe(false)
})

test('parsers are total', () => {
  expect(parseLatest(JSON.stringify(L))).toEqual(L)
  for (const bad of ['', 'nope', '[]', 'null', '{"date":1}', '{"date":"d","path":"p"}']) expect(parseLatest(bad)).toBe(null)
  expect(parseReadDate('{"date":"x"}')).toBe('x')
  for (const bad of ['', 'nope', 'null', '{"date":2}']) expect(parseReadDate(bad)).toBe(null)
})

test('band and command text', () => {
  expect(bandText(L)).toBe('Weekly friction report ready (2 patterns) - /friction')
  expect(commandText(L)).toContain('5x a (2 sessions)')
  expect(commandText({ ...L, counts: { total: 0, patterns: 0 } })).toContain('no patterns found')
  expect(commandText(null)).toContain('No friction report yet')
})
