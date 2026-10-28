import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import type { HealthReport, HealthStats } from '../types'

const BAND = {
  plugin: 'health-band',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

const RED: HealthReport = {
  level: 'red',
  checked_at: '2026-10-21T01:40:00-04:00',
  issues: [
    { level: 'amber', check: 'lse-limit', text: 'LSE daily request limit hit in livepractice log (8h ago)' },
    { level: 'red', check: 'api-credit', text: 'Anthropic API credit error in claude4b log (2h ago)' },
  ],
}
const OK: HealthReport = { level: 'ok', checked_at: 'x', issues: [] }
const STATS: HealthStats = {
  lse: { count: 312, limit: 15000 },
  jobs: [
    { agent: 'codex', ok: 2, running: 0, failed: 0 },
    { agent: 'cline', ok: 0, running: 1, failed: 0 },
    { agent: 'opencode', ok: 0, running: 0, failed: 1 },
  ],
  overhead_tokens: 91291,
}
const withStats = (r: HealthReport, stats: Partial<HealthStats> = {}): HealthReport => ({ ...r, stats: { ...STATS, ...stats } })

function engine(on: On, rep: HealthReport | (() => HealthReport)) {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'healthband' } }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: JSON.stringify(typeof rep === 'function' ? rep() : rep), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  // the engine's own band, drawn when the plugin passes
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return clock
}

test('a red report shows the band, red issue first', async ($, on) => {
  const clock = engine(on, RED)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(100)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /credit/ }))?.text).toContain('🔴 Anthropic API credit error')
    expect((await ui.find({ type: 'Text', text: /LSE daily/ }))?.text).toContain('🟡')
    await ui.unmount()
  }
})

test('before the first check runs, nothing is drawn', async ($, on) => {
  engine(on, RED)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /credit/ })).toBeFalsy()
  await ui.unmount()
})

test('all clear with no gauges draws nothing of its own', async ($, on) => {
  const clock = engine(on, OK)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(100)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  expect(await ui.find({ type: 'Text', text: /🔴|🟡/ })).toBeFalsy()
  await ui.unmount()
})

test('Hide removes the issue rows, the gauges stay', async ($, on) => {
  const clock = engine(on, withStats(RED))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(100)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /credit/ }))?.text).toContain('credit')
  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: /credit/ })).toBeFalsy()
  expect((await ui.find(LSE))?.text).toBe('LSE 312/15000')
  await ui.unmount()
})

const LSE = { type: 'Text', text: /^LSE / } as const
const JOBS = { type: 'Text', text: /^ \| (agent jobs|no agent jobs|.* (ok|running|failed) \d)/ } as const
const OVERHEAD = { type: 'Text', text: /^ \| overhead/ } as const
const EVERY_MS = 5 * 60 * 1000

// One engine per test: each report is what the next check reads, drawn on each surface.
async function eachReport($: Engine, on: On, reports: HealthReport[], body: (ui: Mounted<'terminal' | 'desktop', 'AbovePrompt'>) => Promise<void>, surfaces: readonly ('terminal' | 'desktop')[] = ['desktop']) {
  let current = reports[0]!
  const clock = engine(on, () => current)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const [i, rep] of reports.entries()) {
    current = rep
    await clock.advance(i === 0 ? 100 : EVERY_MS)
    for (const surface of surfaces) {
      const ui = await $.ui.mount({ ...BAND, surface })
      await body(ui)
      await ui.unmount()
    }
  }
}

// Guard: fails if any of the three gauges is dropped from the band, or a removed item comes back.
test('the band draws all three gauges, and no context, 5h or weekly-reset item', async ($, on) => {
  await eachReport($, on, [withStats(OK), withStats(RED)], async ui => {
    expect((await ui.find(LSE))?.text).toBe('LSE 312/15000')
    expect((await ui.find(JOBS))?.text).toBe(' | Codex ok 2 · Cline running 1 · opencode failed 1')
    expect((await ui.find(OVERHEAD))?.text).toBe(' | overhead ~91.3k tok/turn')
    expect(await ui.find({ type: 'Text', text: /context|\b5h\b|reset|weekly/i })).toBeFalsy()
  }, ['terminal', 'desktop'])
})

test('all clear with gauges draws only the gauges, and the band beneath still draws', async ($, on) => {
  await eachReport($, on, [withStats(OK)], async ui => {
    expect((await ui.find(LSE))?.text).toBe('LSE 312/15000')
    expect(await ui.find({ type: 'Text', text: /🔴|🟡/ })).toBeFalsy()
    expect(await ui.find({ key: 'hide' })).toBeFalsy()
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  })
})

test('LSE gauge: plain to 10000, yellow above 10000, red above 14000', async ($, on) => {
  const cases: [number, string | undefined][] = [[312, undefined], [10000, undefined], [10001, 'yellow'], [14000, 'yellow'], [14001, 'red']]
  const seen: [string | undefined, unknown][] = []
  await eachReport($, on, cases.map(([count]) => withStats(OK, { lse: { count, limit: 15000 } })), async ui => {
    const el = await ui.find(LSE)
    seen.push([el?.text, el?.props.color])
  })
  expect(seen).toEqual(cases.map(([count, color]) => [`LSE ${count}/15000`, color]))
})

test('LSE gauge reads unavailable when the call log is unreadable', async ($, on) => {
  await eachReport($, on, [withStats(OK, { lse: null })], async ui => {
    expect((await ui.find(LSE))?.text).toBe('LSE unavailable')
  })
})

test('agent jobs: one segment per agent, each state with its count', async ($, on) => {
  const jobs = [
    { agent: 'opencode', ok: 2, running: 0, failed: 1 },
    { agent: 'copilot', ok: 1, running: 0, failed: 0 },
    { agent: 'newbot', ok: 0, running: 1, failed: 0 },
  ]
  await eachReport($, on, [withStats(OK, { jobs })], async ui => {
    expect((await ui.find(JOBS))?.text).toBe(' | opencode ok 2 failed 1 · Copilot ok 1 · newbot running 1')
  })
})

test('agent jobs: none today, and unavailable', async ($, on) => {
  const seen: (string | undefined)[] = []
  await eachReport($, on, [withStats(OK, { jobs: [] }), withStats(OK, { jobs: null })], async ui => {
    seen.push((await ui.find(JOBS))?.text)
  })
  expect(seen).toEqual([' | no agent jobs today', ' | agent jobs unavailable'])
})

test('overhead gauge: tokens per turn, small counts unrounded, unavailable when unmeasured', async ($, on) => {
  const cases: [number | null, string][] = [[91291, ' | overhead ~91.3k tok/turn'], [640, ' | overhead ~640 tok/turn'], [null, ' | overhead unavailable']]
  const seen: (string | undefined)[] = []
  await eachReport($, on, cases.map(([overhead_tokens]) => withStats(OK, { overhead_tokens })), async ui => {
    seen.push((await ui.find(OVERHEAD))?.text)
  })
  expect(seen).toEqual(cases.map(([, text]) => text))
})
