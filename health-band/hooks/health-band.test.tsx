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

test('issue rows are not drawn in the band (they live in the second-brain window)', async ($, on) => {
  const clock = engine(on, withStats(RED))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(100)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /credit|LSE daily|🔴|🟡/ })).toBeFalsy()
    expect((await ui.find({ type: 'Text', text: /^LSE / }))?.text).toBe('LSE 312/15000')
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

test('no Hide or Recheck buttons are drawn', async ($, on) => {
  const clock = engine(on, withStats(RED))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(100)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'hide' })).toBeFalsy()
  expect(await ui.find({ key: 'recheck' })).toBeFalsy()
  await ui.unmount()
})

test('/healthband still lists every issue', async ($, on) => {
  engine(on, RED)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = await $.command.run({ command: 'healthband', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(JSON.stringify(r)).toContain('Anthropic API credit error')
  expect(JSON.stringify(r)).toContain('LSE daily request limit')
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

// Push: a new red issue raises one native notification; nothing else does.
const CREDIT: HealthReport['issues'][number] = { level: 'red', check: 'api-credit', text: 'Anthropic API credit error in claude4b log (2h ago)' }
const GONE: HealthReport['issues'][number] = { level: 'red', check: 'lse-gone', text: 'LSE API v2 retired (HTTP 410): v3 port needed', affects: ['livepractice'] }
const AMBER: HealthReport['issues'][number] = { level: 'amber', check: 'lse-limit', text: 'LSE daily request limit hit in livepractice log (8h ago)' }
const report = (...issues: HealthReport['issues']): HealthReport => ({ level: issues.some(i => i.level === 'red') ? 'red' : issues.length ? 'amber' : 'ok', checked_at: 'x', issues })

async function notified(on: On, $: Engine, reports: HealthReport[], reply: 'sent' | 'denied' = 'sent'): Promise<{ notes: { text: string; title?: string }[]; drawn: () => Promise<string | undefined> }> {
  let current = reports[0]!
  const clock = engine(on, () => current)
  const notes: { text: string; title?: string }[] = []
  on('ui.notify', (_, e) => {
    notes.push({ text: e.text, title: e.title })
    return reply === 'denied' ? { deny: 'notifications refused' } : { value: { isSent: true, channel: 'terminal_bell' as const } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const [i, rep] of reports.entries()) {
    current = withStats(rep)
    await clock.advance(i === 0 ? 100 : EVERY_MS)
  }
  return {
    notes,
    drawn: async () => {
      const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
      const text = (await ui.find(LSE))?.text
      await ui.unmount()
      return text
    },
  }
}

test('notify: the first load never notifies, even with red issues already present', async ($, on) => {
  const r = await notified(on, $, [report(CREDIT, GONE)])
  expect(r.notes).toEqual([])
})

test('notify: a red issue that appears after the first load notifies once, titled health-band', async ($, on) => {
  const r = await notified(on, $, [report(), report(GONE), report(GONE), report(GONE)])
  expect(r.notes).toEqual([{ text: GONE.text, title: 'health-band' }])
})

test('notify: only the new red issue is announced, and amber issues never are', async ($, on) => {
  const r = await notified(on, $, [report(CREDIT), report(CREDIT, AMBER), report(CREDIT, AMBER, GONE)])
  expect(r.notes.map(n => n.text)).toEqual([GONE.text])
})

test('notify: an issue that clears and comes back is announced again', async ($, on) => {
  const r = await notified(on, $, [report(), report(GONE), report(), report(GONE)])
  expect(r.notes.map(n => n.text)).toEqual([GONE.text, GONE.text])
})

test('notify: a count that ticks up in the text is the same issue', async ($, on) => {
  const stale = (n: number) => ({ level: 'red' as const, check: 'data-flow', text: `ticks data stale: newest 2026-10-16 16:59, ${n} days behind (limit 10)` })
  const r = await notified(on, $, [report(), report(stale(12)), report(stale(13))])
  expect(r.notes).toHaveLength(1)
})

test('notify: a refused notification does not stop the checks', async ($, on) => {
  const r = await notified(on, $, [report(), report(GONE), report(GONE, CREDIT)], 'denied')
  expect(r.notes.map(n => n.text)).toEqual([GONE.text, CREDIT.text])
  expect(await r.drawn()).toBe('LSE 312/15000')
})
