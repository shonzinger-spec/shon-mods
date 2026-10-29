import { expect, test } from 'claude-code/testing'
declare const setTimeout: (fn: (v?: unknown) => void, ms: number) => unknown

const PANE = {
  plugin: 'brain-sync',
  component: 'Pane',
  requestId: 'brain-sync',
  props: { title: 'Second brain', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const RUN = { command: 'brain', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } } as const
const item = (sid8: string, status: string, reason = '') => ({ sid8, title: `Chat ${sid8}`, date: '2026-10-28', status, reason, job: status === 'failed' ? 'archive' : null, idle_min: 400, has_note: false })
const report = (failed: number, action = 'started') => JSON.stringify({
  generated_at: new Date().toISOString().slice(0, 19),
  totals: { total: 20, saved: 18 - failed, live: 2, failed, stuck: 0 },
  stages: { backup: 18, note: 18 - failed, melxis: 18 - failed, eligible: 18 },
  problems: Array.from({ length: failed }, (_, i) => item(`f000000${i}`, 'failed', 'note missing or out of date')),
  live: [item('11111111', 'live', 'in use')],
  heal: failed ? { action, job: 'archive', attempts: 1, cap: 5, next_at: Date.now() / 1000 + 600, history: [] } : { action: 'idle', job: null, attempts: 0, cap: 5, next_at: null, history: [] },
  jobs: { archive: { running: action === 'running', log: ['  FAILED abc auth'] }, melxis: { running: false, log: [] } },
})

test('the pane shows saved counts, failed chats and the rerun; failures pop it open', async ($, on) => {
  let current = report(1)
  const argvs: string[][] = []
  const opens: string[] = []
  const toasts: string[] = []
  on('command.register', () => ({ value: { command: 'brain' } }))
  on('ui.open', (_, e) => { opens.push(e.id); return { value: { isPlaced: true } } })
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  on('clock.every', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    argvs.push([...e.argv])
    if (/health_check/.test(e.argv[1] ?? '')) return { value: { exitCode: 0, stdout: '{"issues":[{"level":"red","text":"forward job X: last exit 1"}]}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: current, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(RUN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /not saved yet ·/ }))?.text).toBe('▲ 1 not saved yet · 17/18 saved')
    expect((await ui.find({ type: 'Text', text: /Chat f0000000/ }))?.text).toBe('Chat f0000000')
    expect((await ui.find({ type: 'Text', text: /Rerun started/ }))?.text).toBe('Rerun started: archive sync (try 1/5)')
    expect((await ui.find({ type: 'Text', text: /forward job X/ }))?.text).toBe('● forward job X: last exit 1')
    if (surface === 'desktop') expect((await ui.find({ type: 'Svg' })) !== undefined).toBe(true)
    await ui.unmount()
  }
  expect(argvs.find(a => /sync_status/.test(a[1] ?? ''))?.slice(-2)).toEqual(['--json', '--heal'])

  // The timer's next check (no click) finds more failures: the pane opens and a toast says so.
  current = report(3)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (let i = 0; i < 50 && !toasts.some(t => /3 chats not saved/.test(t)); i++) await new Promise(r => setTimeout(r, 10))
  expect(toasts.some(t => /3 chats not saved/.test(t))).toBe(true)
  expect(opens.filter(id => id === 'brain-sync').length >= 2).toBe(true)
  expect(await ui.find({ type: 'Button' })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /auto-check/ }))?.text).toMatch(/auto-check every 30 s/)
  expect(argvs.some(a => a.at(-1) === '--force')).toBe(false)
  await ui.unmount()
})

test('all saved reads green with no rerun button', async ($, on) => {
  on('command.register', () => ({ value: { command: 'brain' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: report(0), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.command.run(RUN)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /All .* saved/ }))?.text).toBe('● All 18 finished chats saved')
  expect(await ui.find({ type: 'Button' })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /chats/ }))?.text).toMatch(/20 chats\s+✓ 18 backed up\s+○ 2 not yet/)
  await ui.unmount()
})
