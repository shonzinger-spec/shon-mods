import { expect, test } from 'claude-code/testing'
import { bandLine, budgetText, calibrate, checkTask, DEFAULT_CFG as cfg, deriveTool, estimateTask, parseTasks, recommend, scanTasks } from './lib.js'
import type { HistoryRow, Sample } from './lib.js'

const al = cfg.aliases
const cal0 = { pctPerUSD: null, intervals: 0 }

test('deriveTool classifies mcp, skill, agent, connector, built-in', () => {
  expect(deriveTool('mcp__plugin_ecc_github__x', {})).toEqual({ kind: 'mcp', plugin: 'ecc', name: 'mcp__plugin_ecc_github__x' })
  expect(deriveTool('Skill', { skill: 'superpowers:brainstorming' })).toEqual({ kind: 'skill', plugin: 'superpowers', name: 'superpowers:brainstorming' })
  expect(deriveTool('Agent', { subagent_type: 'delegate:builder' })).toEqual({ kind: 'agent', plugin: 'delegate', name: 'delegate:builder' })
  expect(deriveTool('mcp__02df8b7e-dfa4-41c7-86ff-ec5d7be9e6f2__list_bases', {})?.kind).toBe('connector')
  expect(deriveTool('Bash', {})).toBeNull()
})

const MD = [
  '# header',
  '- [ ] agent stuff | build mod | XL | value 4 | est 3%',
  '- [x] trading | prereg test | L | value 2',
  '- [ ] business | call | S',
  '- [ ] bad line | no size',
].join('\n')

test('parseTasks reads boxes, sizes, value, est and aliases', () => {
  const t = parseTasks(MD, al)
  expect(t.length).toBe(3)
  expect(t[0]).toEqual({ n: 1, done: false, section: 'agent', text: 'build mod', size: 'XL', value: 4, est: 3 })
  expect(t[1]?.done).toBe(true)
  expect(t[1]?.size).toBe('L')
  expect(t[2]).toMatchObject({ n: 3, value: 3, est: null, section: 'business' })
  expect(scanTasks(MD, al)[2]?.lineIdx).toBe(3)
})

test('checkTask flips the right line only', () => {
  const out = checkTask(MD, 3, al) ?? ''
  expect(out.split('\n')[3]).toBe('- [x] business | call | S')
  expect(out.split('\n')[1]).toBe('- [ ] agent stuff | build mod | XL | value 4 | est 3%')
  expect(checkTask(MD, 2, al)).toBeNull()
  expect(checkTask(MD, 9, al)).toBeNull()
})

test('estimateTask: prior, measured median, explicit est', () => {
  const task = { n: 1, done: false, section: 'a', text: 't', size: 'M' as const, value: 3, est: null }
  const h = (pct: number): HistoryRow => ({ section: 'a', size: 'M', pct, deltaUSD: null })
  expect(estimateTask(task, [h(1), h(9)], cal0, cfg)).toEqual({ pct: 2, basis: 'prior' })
  expect(estimateTask(task, [h(1), h(9), h(3)], cal0, cfg)).toEqual({ pct: 3, basis: 'measured n=3' })
  expect(estimateTask({ ...task, est: 7 }, [h(1), h(9), h(3)], cal0, cfg)).toEqual({ pct: 7, basis: 'set' })
})

const mk = (n: number, section: string, size: 'S' | 'M' | 'L' | 'XL', value: number) => ({ n, done: false, section, text: `t${n}`, size, value, est: null })
const ctx = (remaining: number | null, section: string | null) => ({ remaining, section, history: [], cal: cal0, cfg })

test('recommend ranks by value/est, drops what does not fit, bonus breaks near-tie', () => {
  const r = recommend([mk(1, 'a', 'M', 3), mk(2, 'a', 'S', 3)], ctx(null, null))
  expect(r.picks.map(p => p.task.n)).toEqual([2, 1])
  const d = recommend([mk(1, 'a', 'XL', 5), mk(2, 'a', 'L', 3)], ctx(10, null))
  expect(d.dropped.map(p => p.task.n)).toEqual([1])
  expect(d.picks.map(p => p.task.n)).toEqual([2])
  const b = recommend([mk(1, 'a', 'S', 3), mk(2, 'b', 'S', 3)], ctx(null, 'b'))
  expect(b.picks[0]?.task.n).toBe(2)
})

const smp = (day: number, weeklyPct: number, costUSD: number, session = 's1'): Sample => ({ ts: new Date(Date.UTC(2026, 9, day, 12)).toISOString(), session, section: 'x', weeklyPct, fiveHourPct: null, costUSD })
const NOW = Date.UTC(2026, 9, 28, 12)

test('calibrate: median ratio, null when too few intervals', () => {
  const rows = [smp(20, 10, 0), smp(21, 14, 2), smp(22, 20, 4), smp(23, 22, 5), smp(24, 30, 9)]
  // ratios: 4/2=2, 6/2=3, 2/1=2, 8/4=2 -> median 2
  expect(calibrate(rows, NOW, cfg)).toEqual({ pctPerUSD: 2, intervals: 4 })
  expect(calibrate([smp(20, 10, 0), smp(21, 14, 2)], NOW, cfg)).toEqual({ pctPerUSD: null, intervals: 1 })
  expect(calibrate([smp(20, 10, 0), smp(21, 11, 2), smp(22, 12, 4)], NOW, cfg).pctPerUSD).toBeNull()
})

test('bandLine: null on pace, text when over allowance or too parallel', () => {
  expect(bandLine({ spentToday: 3, allowance: 5, parallel: 3 }, cfg)).toBeNull()
  expect(bandLine({ spentToday: 6, allowance: 5, parallel: 1 }, cfg)).toContain('over')
  expect(bandLine({ spentToday: 1, allowance: 5, parallel: 4 }, cfg)).toContain('4 parallel')
})

test('budgetText with empty inputs says limits unavailable', () => {
  const s = budgetText({ weekly: null, left: null, allowance: null, spent: null, parallel: 0, cal: cal0, tasks: [], history: [], cfg, sampleCount: 0 })
  expect(s).toContain('no weekly limit reading')
  expect(s).toContain('Open tasks: none')
})
