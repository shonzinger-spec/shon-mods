import { expect, test } from 'claude-code/testing'

import { bandText, dropKept, fmtIdle, isIgnoredTitle, mergeCands, mergeCfg, normTitle, pairKey, parseMatches, shouldCheck } from './lib'

const cfg = mergeCfg({})
const c = (id: string, idleMs: number) => ({ sessionId: id, title: id, score: 1, reason: 'title' as const, idleMs })

test('normTitle ignores case, punctuation and the Fork of prefix', () => {
  expect(normTitle('Fork of Fork of  Build: The Thing!')).toBe('build the thing')
  expect(normTitle(undefined)).toBe('')
})
test('ignored titles: empty and configured ones', () => {
  expect(isIgnoredTitle('New chat', cfg)).toBe(true)
  expect(isIgnoredTitle('  ', cfg)).toBe(true)
  expect(isIgnoredTitle('Real work', cfg)).toBe(false)
})
test('shouldCheck: prompt phase once, never for commands, meta, empty text or when disabled', () => {
  const base = { phase: 'prompt' as const, stage: 0, cfg, text: 'do the thing' }
  expect(shouldCheck(base)).toBe(true)
  expect(shouldCheck({ ...base, stage: 1 })).toBe(false)
  expect(shouldCheck({ ...base, hasCommand: true })).toBe(false)
  expect(shouldCheck({ ...base, isMeta: true })).toBe(false)
  expect(shouldCheck({ ...base, text: '  ' })).toBe(false)
  expect(shouldCheck({ ...base, cfg: mergeCfg({ enabled: false }) })).toBe(false)
  expect(shouldCheck({ phase: 'turn', stage: 1, cfg })).toBe(true)
  expect(shouldCheck({ phase: 'turn', stage: 2, cfg })).toBe(false)
})
test('pair memory is order-independent and filters candidates', () => {
  expect(pairKey('b', 'a')).toBe(pairKey('a', 'b'))
  expect(dropKept([c('x', 1), c('y', 2)], 'me', [pairKey('me', 'x')]).map(k => k.sessionId)).toEqual(['y'])
})
test('mergeCands unions by id, newest first, max 3', () => {
  expect(mergeCands([c('a', 50), c('b', 10)], [c('a', 5), c('c', 20), c('d', 30)]).map(k => k.sessionId)).toEqual(['a', 'b', 'c'])
})
test('band text and idle formatting', () => {
  expect(fmtIdle(2 * 3_600_000)).toBe('2h')
  expect(fmtIdle(10_000)).toBe('1m')
  expect(fmtIdle(5 * 86_400_000)).toBe('5d')
  expect(bandText({ ...c('a', 7_200_000), title: 'Build X' }, 2)).toBe('Looks like the same task as "Build X" (idle 2h) (+1 more).')
})
test('parseMatches survives junk', () => {
  expect(parseMatches('not json')).toEqual([])
  expect(parseMatches('{"matches":[{"sessionId":"a","title":"T","score":1,"reason":"title","idleMs":5}]}')[0]?.sessionId).toBe('a')
})
