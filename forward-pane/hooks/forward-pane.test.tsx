import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { FwdJob, FwdStatus } from '../types'
import { sorted, tone } from './lib'

const job = (over: Partial<FwdJob>): FwdJob => ({
  label: 'com.x', name: 'x', schedule: 'Mon-Fri 08:00', running: false, pid: null, last_exit: 0,
  last_run: '2026-10-20T08:00', age_min: 60, stale: false, stale_reason: '', errors: [],
  trades: null, unit: 'trades', target_n: null, target_note: '', ...over,
})

const STATUS: FwdStatus = {
  generated_at: '2026-10-21T01:30:00',
  jobs: [
    job({ name: 'v62 OF-TICK forward', trades: 1, target_n: 60 }),
    job({ name: 'restart live practice', errors: ['FAILED NQ.F after 8 tries: [429] daily request limit'] }),
    job({ name: 'Lil Fish 4b', stale: true, stale_reason: 'missed run due Tue 09:10' }),
  ],
}

test('stale or failed jobs are red and listed first', () => {
  expect(tone(job({ stale: true }))).toBe('red')
  expect(tone(job({ last_exit: 1 }))).toBe('red')
  expect(tone(job({ last_exit: 1, running: true }))).toBe('green')
  expect(tone(job({ errors: ['x'] }))).toBe('yellow')
  expect(sorted(STATUS.jobs).map(j => j.name)).toEqual(['Lil Fish 4b', 'restart live practice', 'v62 OF-TICK forward'])
})

const PANE = {
  plugin: 'forward-pane',
  component: 'Pane',
  requestId: 'forward-pane',
  props: { title: 'Forward tests', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

function engine(on: On) {
  on('command.register', () => ({ value: { command: 'forward' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: JSON.stringify(STATUS), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

test('/forward fills the pane: stale job, its reason, errors, n vs target', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = await $.command.run({ command: 'forward', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } } as never)
  expect(String((r as { text?: string }).text)).toContain('1 red')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /STALE/ }))?.text).toContain('missed run due Tue 09:10')
    expect((await ui.find({ type: 'Text', text: /429/ }))?.text).toContain('daily request limit')
    expect((await ui.find({ type: 'Text', text: /1\/60/ }))?.text).toContain('1/60 trades')
    await ui.unmount()
  }
})
