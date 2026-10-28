import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { ArStatus, FollowUp } from '../types'
import { followUpLine, split } from './lib'

const fu = (over: Partial<FollowUp>): FollowUp => ({
  name: 'Acme HVAC', metro: 'Barrie', touch: 2, last_date: '2026-10-17', last_subject: 'acme.ca vs rival.ca in Barrie',
  subject_is_older: false, last_any_date: '2026-10-17', days_since: 4, overdue_days: 1, gap_flag: false, ...over,
})

const STATUS: ArStatus = {
  today: '2026-10-21',
  last_send_date: '2026-10-17',
  followups: [fu({}), fu({ name: 'Example Air', days_since: 58, overdue_days: 55, gap_flag: true, last_subject: '' })],
  first_touches: { source: 'logs/queued-2026-10-20.json', file_date: '2026-10-20', count: 2, names: ['Sample Heat Inc (Springfield)', 'Demo Mechanical'] },
  leads: ['Acme Heating (Springfield) — warm. Call, don\'t email.'],
  gmail_status: { date: '2026-10-20', text: 'no replies' },
  totals: {},
  repo: '/h/AutoRank',
}

test('follow-ups split into due and lapsed; each line has date and subject', () => {
  const { due, lapsed } = split(STATUS)
  expect(due.map(f => f.name)).toEqual(['Acme HVAC'])
  expect(lapsed.map(f => f.name)).toEqual(['Example Air'])
  expect(followUpLine(due[0] as FollowUp)).toBe('T2 Acme HVAC (Barrie) · last email 2026-10-17 “acme.ca vs rival.ca in Barrie”')
  expect(followUpLine(lapsed[0] as FollowUp)).toContain('(subject not logged)')
})

const PANE = {
  plugin: 'autorank-pane',
  component: 'Pane',
  requestId: 'autorank-pane',
  props: { title: 'AutoRank', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

function engine(on: On, stdout: string, exitCode = 0) {
  mock.env(on, { HOME: '/h' })
  on('command.register', () => ({ value: { command: 'autorank' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({ value: { exitCode, stdout, stderr: exitCode ? 'Error: no logs' : '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

const RUN = { command: 'autorank', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } } as never

test('/autorank shows follow-ups, first touches and leads in separate sections', async ($, on) => {
  engine(on, JSON.stringify(STATUS))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = await $.command.run(RUN)
  expect(String((r as { text?: string }).text)).toContain('1 follow-ups due')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Follow-ups due today/ }))?.text).toBe('Follow-ups due today (1)')
    expect((await ui.find({ type: 'Text', text: /^T2 Acme/ }))?.text).toContain('last email 2026-10-17')
    expect((await ui.find({ type: 'Text', text: /First touches queued/ }))?.text).toBe('First touches queued (2)')
    expect((await ui.find({ type: 'Text', text: /Acme Heating/ }))?.text).toContain('Call')
    expect((await ui.find({ type: 'Text', text: /lapsed/ }))?.text).toContain('Example Air')
    await ui.unmount()
  }
})

test('a failing collector shows its error, not a blank pane', async ($, on) => {
  engine(on, '', 1)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /collector failed/ }))?.text).toContain('no logs')
  await ui.unmount()
})
