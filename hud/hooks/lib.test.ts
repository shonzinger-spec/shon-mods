import { expect, test } from 'claude-code/testing'
import { arrow, effortCells, effortPct, parseEffort, parseMem, pill, runAnim, stale, stripText, swapColor, tween } from './lib.js'

test('effortCells fills 1..5 and unknown is empty', () => {
  expect(['low', 'medium', 'high', 'xhigh', 'max'].map(effortCells)).toEqual(['▰▱▱▱▱', '▰▰▱▱▱', '▰▰▰▱▱', '▰▰▰▰▱', '▰▰▰▰▰'])
  expect(effortCells('nope')).toBe('▱▱▱▱▱')
  expect(['low', 'max', 'nope'].map(effortPct)).toEqual([20, 100, 0])
})

test('arrow shows only for a recent change, in the right direction', () => {
  expect(arrow('low', 'high', 1000, 2000)).toBe('↑ ')
  expect(arrow('high', 'low', 1000, 2000)).toBe('↓ ')
  expect(arrow('low', 'high', 1000, 1000 + 91_000)).toBe('')
  expect(arrow(null, 'high', 1000, 2000)).toBe('')
  expect(arrow('high', 'high', 1000, 2000)).toBe('')
})

const F = '#8B5CF6'
const T = '#2E2A3D'
const txt = (p: ReturnType<typeof pill>) => p.map(x => x.text).join('')

test('pill is always width + 2 wide; NaN and out-of-range clamp', () => {
  for (const p of [0, 7, 50, 71, 99.9, 100, NaN, 150, -5]) expect([...txt(pill(p, 10, F, T, 'high'))].length).toBe(12)
  expect(pill(NaN, 10, F, T, '')).toEqual(pill(0, 10, F, T, ''))
  expect(pill(150, 10, F, T, '')).toEqual(pill(100, 10, F, T, ''))
})

test('pill 0 and 100: cap colors, no fill / all fill', () => {
  expect(pill(0, 4, F, T, '')).toEqual([{ text: '◖', color: T }, { text: '    ', backgroundColor: T }, { text: '◗', color: T }])
  expect(pill(100, 4, F, T, '')).toEqual([{ text: '◖', color: F }, { text: '    ', backgroundColor: F }, { text: '◗', color: F }])
})

test('pill 50: half filled, plain caps', () => {
  expect(pill(50, 4, F, T, '')).toEqual([
    { text: '◖', color: F }, { text: '  ', backgroundColor: F }, { text: '  ', backgroundColor: T }, { text: '◗', color: T },
  ])
})

test('pill 71 moves the edge in eighths and centers a colored label', () => {
  // 71% of 10 cells = 7.1 -> 57 eighths: 7 full, 1/8 block on cell 7
  const p = pill(71, 10, F, T, 'high')
  expect(txt(p)).toBe('◖   high▏  ◗')
  expect(p).toEqual([
    { text: '◖', color: F },
    { text: '   ', backgroundColor: F },
    { text: 'high', color: '#FFFFFF', backgroundColor: F, bold: true },
    { text: '▏', color: F, backgroundColor: T },
    { text: '  ', backgroundColor: T },
    { text: '◗', color: T },
  ])
  const q = pill(40, 10, F, T, '40%') // label spans filled and empty cells
  expect(q.filter(x => x.text === '4' || x.text === '0%').length).toBe(2)
  expect(q.find(x => x.text === '0%')).toEqual({ text: '0%', color: '#C9CED6', backgroundColor: T })
})

test('stale after 10 minutes, and for garbage', () => {
  expect(stale(0, 599_000)).toBe(false)
  expect(stale(0, 601_000)).toBe(true)
  expect(stale(NaN, 1)).toBe(true)
})

test('parsers tolerate garbage; strip text has both halves', () => {
  expect(parseEffort('{{')).toBeNull()
  expect(parseEffort('')).toBeNull()
  expect(parseMem('{"level":"x"}')).toBeNull()
  const e = parseEffort('{"level":"high","ultracode":true,"reason":"r","source":"auto","at":1}')
  const m = parseMem('{"level":"warn","freePct":30,"memTotalMB":16384,"swapUsedMB":50,"swapTotalMB":100,"at":1}')
  const t = stripText(e, '', m)
  expect(t).toBe('effort ▰▰▰▱▱ high · ram 70% · swap 50%')
  expect(stripText(e, '↑ ', { ...m!, freePct: 31 })).toBe('effort ▰▰▰▱▱ ↑ high · ram 69% · swap 50%')
  expect(stripText(null, '', null)).toBe('')
})

test('tween ends exactly at the target, in equal steps', () => {
  expect(tween(60, 66, 6)).toEqual([61, 62, 63, 64, 65, 66])
  expect(tween(10, 3, 4).at(-1)).toBe(3)
  expect(tween(0.1, 0.7, 3).at(-1)).toBe(0.7)
  expect(tween(5, 9, 0)).toEqual([9])
})

test('swapColor: dim below 85, amber from 85, red from 97', () => {
  expect([0, 84, 85, 96, 97, 100].map(swapColor)).toEqual([null, null, '#F59E0B', '#F59E0B', '#EF4444', '#EF4444'])
})

test('runAnim plays every frame on one timer and stops it after the last', () => {
  let fire: () => void = () => undefined
  let made = 0
  let cancels = 0
  const every = (_ms: number, fn: () => void) => { made++; fire = fn; return { cancel: () => { cancels++ } } }
  const seen: number[] = []
  let done = 0
  runAnim(every, 80, [2, 3, 4], v => seen.push(v), () => done++)
  expect([made, cancels]).toEqual([1, 0])
  fire(); fire()
  expect([seen, cancels, done]).toEqual([[2, 3], 0, 0])
  fire()
  expect([seen, cancels, done]).toEqual([[2, 3, 4], 1, 1])
  fire()
  expect([seen.length, cancels]).toEqual([3, 1])
})

test('runAnim stop cancels once; no frames starts no timer', () => {
  let made = 0
  let cancels = 0
  const every = () => { made++; return { cancel: () => { cancels++ } } }
  const stop = runAnim(every, 80, [1, 2], () => undefined, () => undefined)
  stop(); stop()
  expect(cancels).toBe(1)
  let done = 0
  runAnim(every, 80, [], () => undefined, () => done++)
  expect([made, done]).toEqual([1, 1])
})

import { stripSvg, svgStrip } from './lib.js'
const SE = { level: 'high', ultracode: false, reason: '', source: 'auto' as const, at: 1 }
const SM = { level: 'ok' as const, freePct: 31, memTotalMB: 16384, swapUsedMB: 98, swapTotalMB: 100, at: 1 }

test('stripSvg: Savvy-style rounded tracks, dotted fill, head tags, twinkle css', () => {
  const s = stripSvg({ e: SE, arr: '', m: SM, motion: true })
  expect((s.match(/class="k"[^>]*rx="6"/g) ?? []).length).toBe(2)
  expect(s).toContain('fill="#8B5CF6"')
  expect(s).toContain('fill="#14B8A6"')
  expect(s).toMatch(/class="t[0-3]"/)
  expect(s).toContain('@keyframes tw')
  expect(s).toContain('>effort<')
  expect(s).toContain('>ram<')
  expect(s).toContain('>69%<')
  expect(s).toContain('prefers-reduced-motion')
  expect(svgStrip({ e: SE, arr: '', m: SM, motion: true }).w).toBeLessThanOrEqual(900)
})

test('stripSvg: motion off drops animation, critical is red, text escaped', () => {
  const s = stripSvg({ e: { ...SE, level: 'a<b&c>' }, arr: '', m: { ...SM, level: 'critical' }, motion: false })
  expect(s).not.toContain('prefers-reduced-motion')
  expect(s).not.toContain('@keyframes')
  expect(s).toContain('fill="#EF4444"')
  expect(s).toContain('a&lt;b&amp;c&gt;')
  expect(stripSvg({ e: SE, arr: '', m: null, motion: true })).not.toContain('>ram<')
})
