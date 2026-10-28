import { expect, test } from 'claude-code/testing'

import { DAY, mergeCfg, pickIdle, type Row } from './lib'

const NOW = Date.parse('2026-10-28T00:00:00Z')
const cfg = mergeCfg({})
const ago = (d: number) => new Date(NOW - d * DAY).toISOString()
const row = (id: string, d: number, x: Partial<Row> = {}): Row => ({ sessionId: id, title: id, lastActivityAt: ago(d), ...x })
const ids = (rows: Row[], self = 'me') => pickIdle(rows, NOW, cfg, self).map(p => p.row.sessionId)

test('15 d idle is picked, 13 d is not', () => {
  expect(ids([row('a', 15), row('b', 13)])).toEqual(['a'])
})
test('running, pinned, archived and self are never picked', () => {
  expect(ids([row('r', 30, { isRunning: true }), row('p', 30, { pinned: true }), row('x', 30, { isArchived: true }), row('me', 30)])).toEqual([])
})
test('a parent with an active child is kept; with only idle children it is picked', () => {
  expect(ids([row('par', 30), row('kid', 1, { startedBy: 'par' })])).toEqual([])
  expect(ids([row('par', 30), row('kid', 20, { startedBy: 'par' })]).sort()).toEqual(['kid', 'par'])
  expect(ids([row('par', 30), row('kid', 30, { isRunning: true, startedBy: 'par' })])).toEqual([])
})
test('oldest first and capped', () => {
  const rows = [row('a', 20), row('b', 40), row('c', 30)]
  expect(pickIdle(rows, NOW, { ...cfg, maxPerRun: 2 }, 'me').map(p => p.row.sessionId)).toEqual(['b', 'c'])
})
test('mergeCfg floors idleDays at 3', () => {
  expect(mergeCfg({ idleDays: 1 }).idleDays).toBe(14)
  expect(mergeCfg({ idleDays: 5 }).idleDays).toBe(5)
})
