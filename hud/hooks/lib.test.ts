import { expect, test } from 'claude-code/testing'
import { arrow, bar, effortCells, effortColor, fillFrames, parseEffort, parseMem, runAnim, stale, stripText, swapColor, tween } from './lib.js'

test('effortCells fills 1..5 and unknown is empty', () => {
  expect(['low', 'medium', 'high', 'xhigh', 'max'].map(effortCells)).toEqual(['▰▱▱▱▱', '▰▰▱▱▱', '▰▰▰▱▱', '▰▰▰▰▱', '▰▰▰▰▰'])
  expect(effortCells('nope')).toBe('▱▱▱▱▱')
  expect(effortColor('xhigh')).toBe('magenta')
})

test('arrow shows only for a recent change, in the right direction', () => {
  expect(arrow('low', 'high', 1000, 2000)).toBe('↑ ')
  expect(arrow('high', 'low', 1000, 2000)).toBe('↓ ')
  expect(arrow('low', 'high', 1000, 1000 + 91_000)).toBe('')
  expect(arrow(null, 'high', 1000, 2000)).toBe('')
  expect(arrow('high', 'high', 1000, 2000)).toBe('')
})

test('bar always adds up to its width', () => {
  for (const p of [0, 7, 50, 70, 99.9, 100, NaN]) {
    const b = bar(p, 12)
    expect([...b.fill, ...b.track].length).toBe(12)
  }
  expect(bar(70).fill).toBe('████████▍')
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
  expect(t).toContain('⚡ high ▰▰▰▱▱ auto + team')
  expect(t).toContain('▣ RAM ')
  expect(t).toContain('  │  swap 50%')
  expect(stripText(null, '', null)).toBe('')
})

test('tween ends exactly at the target, in equal steps', () => {
  expect(tween(60, 66, 6)).toEqual([61, 62, 63, 64, 65, 66])
  expect(tween(10, 3, 4).at(-1)).toBe(3)
  expect(tween(0.1, 0.7, 3).at(-1)).toBe(0.7)
  expect(tween(5, 9, 0)).toEqual([9])
})

test('fillFrames goes one cell at a time, both ways', () => {
  expect(fillFrames(1, 4)).toEqual([2, 3, 4])
  expect(fillFrames(5, 3)).toEqual([4, 3])
  expect(fillFrames(2, 2)).toEqual([])
})

test('swapColor: dim below 85, yellow from 85, red from 97', () => {
  expect([0, 84, 85, 96, 97, 100].map(swapColor)).toEqual([null, null, 'yellow', 'yellow', 'red', 'red'])
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
