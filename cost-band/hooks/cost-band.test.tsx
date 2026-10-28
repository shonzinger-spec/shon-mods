import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { bandLevel, bandText, cacheRatio, statusText, toastText } from './lib.ts'

const BAND = {
  plugin: 'cost-band',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

// 87% cache: 870 read / (870 + 100 + 30)
const TOK = { input_tokens: 30, output_tokens: 5, cache_read_input_tokens: 870, cache_creation_input_tokens: 100 }
const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const turn = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const }

type U = { usd?: number; tokens?: typeof TOK | null }

function engine(on: On, u: U, statuses: string[], toasts: string[] = []) {
  const clock = mock.clock(on)
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: { window: 200000, breakdown: { apiUsage: u.tokens === undefined ? TOK : u.tokens } },
      ...(u.usd === undefined ? {} : { cost: { usd: u.usd } }),
    } as never,
  }))
  on('ui.status', (_, e) => {
    statuses.push(String(e.text))
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(String(e.text))
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', (_, e) => ({ text: e.answer }) as never)
  return clock
}

test('lib: status text, ratio and band text', async () => {
  expect(statusText(12.34, cacheRatio(TOK))).toBe('$12.34 · cache 87%')
  expect(statusText(3, cacheRatio(ZERO))).toBe('$3.00 · cache –')
  expect(statusText(undefined, 0.5)).toBe('$? · cache 50%')
  expect(bandLevel(5, 20)).toBe(null)
  expect(bandLevel(16, 20)).toBe('amber')
  expect(bandLevel(20, 20)).toBe('red')
  expect(bandLevel(undefined, 20)).toBe(null)
  expect(bandText(16.2, 20, 0.87)).toBe('Session $16.20 of $20 limit (81%) · cache 87% · start a new session (save a handoff first)')
  expect(bandText(21, 20, 0.87)).toContain('(105%) · over limit')
})

test('cost 16.20 of 20 -> amber band and status line after a turn', async ($, on) => {
  const statuses: string[] = []
  engine(on, { usd: 16.2 }, statuses)
  await $.turn.complete(turn)
  expect(statuses.at(-1)).toBe('$16.20 · cache 87%')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /Session/ }))?.text).toBe(
      'Session $16.20 of $20 limit (81%) · cache 87% · start a new session (save a handoff first)',
    )
    await ui.unmount()
  }
})

test('cost 21 of 20 -> red band says over limit', async ($, on) => {
  const statuses: string[] = []
  engine(on, { usd: 21 }, statuses)
  await $.turn.complete(turn)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Session/ }))?.text).toContain('Session $21.00 of $20 limit (105%) · over limit')
  await ui.unmount()
})

test('amber and red bands still let the chain beneath draw', async ($, on) => {
  const statuses: string[] = []
  const u: U = { usd: 16.2 }
  engine(on, u, statuses)
  await $.turn.complete(turn)
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Session/ }))?.text).toContain('Session $16.20')
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
  u.usd = 21
  await $.turn.complete(turn)
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Session/ }))?.text).toContain('over limit')
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('cost 5 -> no band, the engine draws its own', async ($, on) => {
  const statuses: string[] = []
  engine(on, { usd: 5 }, statuses)
  await $.turn.complete(turn)
  expect(statuses.at(-1)).toBe('$5.00 · cache 87%')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  expect(await ui.find({ type: 'Text', text: /Session/ })).toBeFalsy()
  await ui.unmount()
})

test('zero tokens -> "cache –", never NaN', async ($, on) => {
  const statuses: string[] = []
  engine(on, { usd: 1, tokens: ZERO }, statuses)
  await $.turn.complete(turn)
  expect(statuses.at(-1)).toBe('$1.00 · cache –')
  expect(statuses.join(' ')).not.toContain('NaN')
})

test('no reading yet (apiUsage null) -> "cache –"', async ($, on) => {
  const statuses: string[] = []
  engine(on, { usd: 0, tokens: null }, statuses)
  await $.turn.complete(turn)
  expect(statuses.at(-1)).toBe('$0.00 · cache –')
})

test('missing cost field -> "$?" status, no band, no throw', async ($, on) => {
  const statuses: string[] = []
  engine(on, {}, statuses)
  await $.turn.complete(turn)
  expect(statuses.at(-1)).toBe('$? · cache 87%')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Session/ })).toBeFalsy()
  await ui.unmount()
})

test('session start refreshes after 50 ms, then every 60 s', async ($, on) => {
  const statuses: string[] = []
  const u: U = { usd: 2 }
  const clock = engine(on, u, statuses)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(statuses.length).toBe(0)
  await clock.advance(100)
  expect(statuses.at(-1)).toBe('$2.00 · cache 87%')
  u.usd = 17
  await clock.advance(60000)
  expect(statuses.at(-1)).toBe('$17.00 · cache 87%')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Session/ }))?.text).toContain('Session $17.00 of $20 limit (85%)')
  await ui.unmount()
})

test('limit_usd from userConfig sets the threshold', { options: { limit_usd: 10 } }, async ($, on) => {
  const statuses: string[] = []
  engine(on, { usd: 9 }, statuses)
  await $.turn.complete(turn)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Session/ }))?.text).toContain('Session $9.00 of $10 limit (90%)')
  await ui.unmount()
})

test('nudge thresholds: below $15 nothing, $15 amber, $20 red', () => {
  expect(bandLevel(14.99, 20, 15)).toBe(null)
  expect(bandLevel(15, 20, 15)).toBe('amber')
  expect(bandLevel(19.99, 20, 15)).toBe('amber')
  expect(bandLevel(20, 20, 15)).toBe('red')
  // a nudge at or above the limit falls back to 80% of the limit
  expect(bandLevel(8, 10, 15)).toBe('amber')
  expect(bandLevel(7.99, 10, 15)).toBe(null)
  expect(toastText('amber', 15.2, 20)).toBe('cost-band: session at $15.20 — start a new session (save a handoff first)')
})

test('default config: band at $15 says start a new session; one toast at $15, one at $20', async ($, on) => {
  const statuses: string[] = []
  const toasts: string[] = []
  const u: U = { usd: 14 }
  engine(on, u, statuses, toasts)
  await $.turn.complete(turn)
  expect(toasts).toEqual([])
  u.usd = 15
  await $.turn.complete(turn)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Session/ }))?.text).toBe(
    'Session $15.00 of $20 limit (75%) · cache 87% · start a new session (save a handoff first)',
  )
  await ui.unmount()
  u.usd = 16
  await $.turn.complete(turn)
  expect(toasts).toEqual(['cost-band: session at $15.00 — start a new session (save a handoff first)'])
  u.usd = 20.5
  await $.turn.complete(turn)
  u.usd = 25
  await $.turn.complete(turn)
  expect(toasts.length).toBe(2)
  expect(toasts[1]).toBe('cost-band: session at $20.50, at or over the $20 limit — start a new session (save a handoff first)')
})

test('nudge_usd from userConfig moves the amber point', { options: { nudge_usd: 12 } }, async ($, on) => {
  const statuses: string[] = []
  const toasts: string[] = []
  engine(on, { usd: 12 }, statuses, toasts)
  await $.turn.complete(turn)
  expect(toasts.length).toBe(1)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Session/ }))?.text).toContain('Session $12.00 of $20 limit (60%)')
  await ui.unmount()
})

test('after /clear the next conversation toasts each level again', async ($, on) => {
  const statuses: string[] = []
  const toasts: string[] = []
  const u: U = { usd: 16 }
  engine(on, u, statuses, toasts)
  await $.turn.complete(turn)
  await $.turn.complete(turn)
  expect(toasts.length).toBe(1)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: '' } })
  await $.turn.complete(turn)
  expect(toasts).toEqual([
    'cost-band: session at $16.00 — start a new session (save a handoff first)',
    'cost-band: session at $16.00 — start a new session (save a handoff first)',
  ])
  u.usd = 21
  await $.turn.complete(turn)
  expect(toasts.length).toBe(3)
  expect(toasts[2]).toContain('at or over the $20 limit')
})
