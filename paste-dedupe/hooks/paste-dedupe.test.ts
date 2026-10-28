import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { dedupe, type Entry } from './lib.ts'

// A 20-line log: each line ~40 characters, well past MIN_LINES and MIN_CHARS.
const LOG = Array.from({ length: 20 }, (_, i) => `2026-10-27 07:${String(i).padStart(2, '0')}:00 INFO step ${i} finished ok`).join('\n')

test('a repeated paste becomes "same as message N"; the new words beside it stay', () => {
  const h: Entry[] = []
  expect(dedupe(`why does this fail?\n${LOG}`, h, 1).replaced).toEqual([])
  const d = dedupe(`${LOG}\nstill failing after the fix`, h, 2)
  expect(d.replaced).toEqual([{ msg: 1, lines: 20 }])
  expect(d.text).toBe(
    '[same as message 1: 20 lines identical to a paste there, starting "2026-10-27 07:00:00 INFO step 0 finished ok"]\nstill failing after the fix',
  )
})

test('a third repeat still points at the first message', () => {
  const h: Entry[] = []
  dedupe(LOG, h, 1)
  dedupe(`${LOG}\nagain`, h, 2)
  expect(dedupe(`once more\n${LOG}`, h, 3).replaced).toEqual([{ msg: 1, lines: 20 }])
})

test('only the shared run of a partly new paste is replaced', () => {
  const h: Entry[] = []
  dedupe(LOG, h, 1)
  const lines = LOG.split('\n')
  const changed = [...lines.slice(0, 12), 'NEW LINE that was not there before', ...lines.slice(12)].join('\n')
  const d = dedupe(changed, h, 2)
  expect(d.replaced).toEqual([{ msg: 1, lines: 12 }, { msg: 1, lines: 8 }])
  expect(d.text).toContain('\nNEW LINE that was not there before\n')
})

test('short repeats and trailing-space differences: under the minimum nothing changes', () => {
  const h: Entry[] = []
  const short = LOG.split('\n').slice(0, 7).join('\n')
  dedupe(short, h, 1)
  expect(dedupe(short, h, 2)).toEqual({ text: short, replaced: [] })
  const h2: Entry[] = []
  dedupe(LOG, h2, 1)
  const spaced = LOG.split('\n').map(l => `${l}   `).join('\n')
  expect(dedupe(spaced, h2, 2).replaced).toEqual([{ msg: 1, lines: 20 }])
})

test('a repeat inside an injected block is never rewritten', () => {
  const h: Entry[] = []
  dedupe(LOG, h, 1)
  const text = `<system-reminder>\n${LOG}\n</system-reminder>\nok`
  expect(dedupe(text, h, 2)).toEqual({ text, replaced: [] })
})

// `texts` is what entered, and the transcript: a rewind or /clear removes from it.
type Seen = { texts: string[]; toasts: string[] }
function engine(on: On, seen: Seen) {
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    seen.texts.push(e.text)
    return { text: e.text }
  })
  on('session.messages', () => ({ value: seen.texts.map(text => ({ role: 'user', text, toolUses: [] })) as never }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

const say = (text: string, kind: 'composer' | 'sdk' | 'task-notification' = 'composer') => ({
  text,
  wait: false,
  origin: { kind } as never,
})

test('the second paste of the same log reaches Claude as a reference, with one toast', async ($, on) => {
  const seen: Seen = { texts: [], toasts: [] }
  engine(on, seen)
  await $.prompt.submit(say(`look at this\n${LOG}`))
  await $.prompt.submit(say(`${LOG}\nand now?`, 'sdk'))
  expect(seen.texts[0]).toBe(`look at this\n${LOG}`)
  expect(seen.texts[1]).toStartWith('[same as message 1: 20 lines')
  expect(seen.texts[1]).toEndWith('\nand now?')
  expect(seen.toasts).toEqual(['paste-dedupe: 20 repeated lines sent as "same as message 1"'])
})

test('notifications are neither rewritten nor counted', async ($, on) => {
  const seen: Seen = { texts: [], toasts: [] }
  engine(on, seen)
  await $.prompt.submit(say(LOG, 'task-notification'))
  await $.prompt.submit(say(LOG))
  await $.prompt.submit(say(LOG, 'task-notification'))
  expect(seen.texts).toEqual([LOG, LOG, LOG])
  await $.prompt.submit(say(LOG))
  expect(seen.texts[3]).toStartWith('[same as message 1: 20 lines')
})

test('a new session start forgets earlier pastes', async ($, on) => {
  const seen: Seen = { texts: [], toasts: [] }
  engine(on, seen)
  await $.prompt.submit(say(LOG))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit(say(LOG))
  expect(seen.texts).toEqual([LOG, LOG])
  expect(seen.toasts).toEqual([])
})

test('a long near-miss paste stops at its comparison budget instead of stalling the prompt', () => {
  // 20 earlier prompts of 1000 short identical lines, then 19,800 such lines with
  // a different one every 290: every line starts 1280 runs that never make 300
  // characters. Unbudgeted this took over 10 s.
  const h: Entry[] = []
  for (let m = 1; m <= 20; m++) dedupe(Array.from({ length: 1000 }, () => 'y').join('\n'), h, m)
  const paste = Array.from({ length: 19800 }, (_, i) => (i % 290 === 289 ? 'z' : 'y')).join('\n')
  const t = performance.now()
  const d = dedupe(paste, h, 21)
  expect(performance.now() - t).toBeLessThan(1000)
  expect(d).toEqual({ text: paste, replaced: [] })
})

const LOG2 = Array.from({ length: 20 }, (_, i) => `Traceback line ${i}: File "orders.py", line ${100 + i}, in place_order`).join('\n')

test('after /clear (no session start fires) a repeat is sent whole, not as a reference', async ($, on) => {
  const seen: Seen = { texts: [], toasts: [] }
  engine(on, seen)
  await $.prompt.submit(say(`look at this\n${LOG}`))
  await $.prompt.submit(say('thanks'))
  seen.texts.splice(0) // /clear: the transcript is empty
  await $.prompt.submit(say(`${LOG}\nagain`))
  expect(seen.texts).toEqual([`${LOG}\nagain`])
  expect(seen.toasts).toEqual([])
})

test('a paste whose message was rewound or edited away is not referenced; numbering follows the transcript', async ($, on) => {
  const seen: Seen = { texts: [], toasts: [] }
  engine(on, seen)
  await $.prompt.submit(say(`first\n${LOG}`))
  await $.prompt.submit(say(`second\n${LOG2}`))
  seen.texts.pop() // rewind: message 2 is gone
  await $.prompt.submit(say(`${LOG2}\nretry`)) // the edit, now message 2
  expect(seen.texts[1]).toBe(`${LOG2}\nretry`)
  await $.prompt.submit(say(`${LOG2}\nagain`))
  expect(seen.texts[2]).toStartWith('[same as message 2: 20 lines')
  await $.prompt.submit(say(LOG))
  expect(seen.texts[3]).toStartWith('[same as message 1: 20 lines')
  expect(seen.toasts.length).toBe(2)
})
