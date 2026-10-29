import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.UTC(2026, 9, 29, 12, 0, 0)
const sec = (daysAgo: number): number => Math.floor((NOW - daysAgo * 86_400_000) / 1000)

const BAND = {
  plugin: 'experiment-ledger',
  component: 'AbovePrompt',
  surface: 'desktop',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const
const START = { cwd: '/h', surface: 'desktop', isInteractive: true } as const
const cmd = (args: string) => ({ command: 'experiments', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false } }) as never

type Scan = { out: string; exit: number }

function engine(on: On, scan: string, ref: Scan = { out: scan, exit: 0 }) {
  const store = new Map<string, unknown>()
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/h' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('fs.stat', (_, e) =>
    e.path === '/h/Trading' ? { value: { kind: 'directory', size: 0, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' },
  )
  on('fs.read', () => ({ deny: 'ENOENT' }))
  on('process.run', (_, e) => ({ value: { exitCode: e.argv[0] === 'find' ? ref.exit : 0, stdout: e.argv[0] === 'find' ? ref.out : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    store.set((e as { key: string }).key, (e as { value: unknown }).value)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return clock
}

const OLD = `${sec(21)} /h/Trading/PREREG_v54.sha256\n${sec(8)} /h/Trading/PREREG_v60.sha256`

test('band renders when a pending prereg is 7+ days old, and the engine still draws beneath', async ($, on) => {
  const clock = engine(on, OLD)
  await $.session.start(START)
  await clock.advance(100)
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /prereg/ }))?.text).toBe('prereg: 2 waiting on a verdict, oldest 21d (v54). /experiments open')
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('no band when everything pending is under 7 days', async ($, on) => {
  const clock = engine(on, `${sec(3)} /h/Trading/PREREG_v60.sha256`)
  await $.session.start(START)
  await clock.advance(100)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /prereg/ })).toBeFalsy()
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('band hidden while a survey is up', async ($, on) => {
  const clock = engine(on, OLD)
  await $.session.start(START)
  await clock.advance(100)
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ type: 'Text', text: /prereg/ })).toBeFalsy()
  await ui.unmount()
})

test('band hidden once every pending prereg is acked, back after unack', async ($, on) => {
  const clock = engine(on, OLD)
  await $.session.start(START)
  await clock.advance(100)
  await $.command.run(cmd('open ack v54'))
  let ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /prereg/ }))?.text).toBe('prereg: 1 waiting on a verdict, oldest 8d (v60). /experiments open')
  await ui.unmount()
  await $.command.run(cmd('open ack v60'))
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /prereg/ })).toBeFalsy()
  await ui.unmount()
  await $.command.run(cmd('open unack v54'))
  ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /prereg/ }))?.text).toContain('oldest 21d (v54)')
  await ui.unmount()
})

test('the band is refreshed every 30 minutes', async ($, on) => {
  const ref: Scan = { out: `${sec(3)} /h/Trading/PREREG_v60.sha256`, exit: 0 }
  const clock = engine(on, '', ref)
  await $.session.start(START)
  await clock.advance(100)
  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /prereg/ })).toBeFalsy()
  await ui.unmount()
  // a new scan result shows up on the next tick
  ref.out = OLD
  await clock.advance(30 * 60 * 1000)
  ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /prereg/ }))?.text).toContain('oldest 21d (v54)')
  await ui.unmount()
})

test('a failed scan hides the band', async ($, on) => {
  const ref: Scan = { out: OLD, exit: 0 }
  const clock = engine(on, '', ref)
  await $.session.start(START)
  await clock.advance(100)
  ref.out = ''
  ref.exit = 1
  await clock.advance(30 * 60 * 1000)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /prereg/ })).toBeFalsy()
  await ui.unmount()
})
