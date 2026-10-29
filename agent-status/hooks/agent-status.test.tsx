import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-29T12:00:00Z')
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString()
const START = { cwd: '/', surface: 'desktop', isInteractive: true } as const
const RUN = { args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } } as const
const PANE = { plugin: 'agent-status', component: 'Pane', requestId: 'agent-status', props: { title: 'Coding agents', isFocused: false, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const BAND = { plugin: 'agent-status', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } } as any

type A = Record<string, unknown>
const agent = (id: string, o: A = {}): A => ({ id, name: id, model: `x/${id}`, model_label: `Model ${id}`, works: true, state: 'ok', reason: null, user_fix: null, last_run: null, fallback: ['GLM 5.3 Flash'], checked: 'cache', ...o })
const health = (agents: A[], events: A[] = []) => JSON.stringify({ checked_at: iso(3), agents, events })
const MIXED = [
  agent('opencode', { model_label: 'DeepSeek V4.1 Flash (free)', last_run: { at: iso(3), verdict: 'PASS' } }),
  agent('codex', { works: false, state: 'down', reason: 'quota exhausted' }),
  agent('atlarix', { works: false, state: 'down', reason: 'not signed in', user_fix: { label: 'Sign in', command: 'atlarix login' } }),
  agent('amp', { works: null, state: 'unknown', reason: 'no recent run' }),
]
const ctxEvent = (minAgo: number) => ({ at: iso(minAgo), lane: 'opencode', kind: 'context-switch', from: 'DeepSeek V4.1 Flash', to: 'GLM 5.3 Flash', text: 'opencode ran out of context on DeepSeek V4.1 Flash, switching to GLM 5.3 Flash' })

type Argv = { argv: string[] }
function wire(on: any, state: { out: string; code?: number; stderr?: string; runs: string[][]; toasts: string[]; opens?: string[] }, entries: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, entries)
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('ui.open', (_: unknown, e: any) => { state.opens?.push(e.id); return { value: { isPlaced: true } } })
  on('ui.toast', (_: unknown, e: any) => { state.toasts.push(e.text); return { value: undefined } })
  on('fs.read', () => ({ value: '' }))
  on('process.run', (_: unknown, e: any) => {
    state.runs.push([...(e as Argv).argv])
    return { value: { exitCode: state.code ?? 0, stdout: state.out, stderr: state.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', ($: any, e: any) => { const { Text } = $.ui.resolve(e) as any; return <Text>engine</Text> })
  return clock
}
const fresh = () => ({ out: health(MIXED), runs: [] as string[][], toasts: [] as string[] })
const scriptRuns = (s: { runs: string[][] }) => s.runs.filter(r => /agent_health/.test(r[1] ?? ''))
const buttons = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((x: any) => x.props.label)
const texts = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((x: any) => x.text).join(' | ')

test('pane renders a mixed fleet on every surface; fix button only with user_fix', async ($, on) => {
  const s = fresh()
  const clock = wire(on, s)
  await $.session.start(START)
  await clock.settle()
  expect(scriptRuns(s)[0]?.slice(-1)).toEqual(['--json'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const all = await texts(ui)
    expect(all).toContain('1 of 4 working')
    expect(all).toContain('[DeepSeek V4.1 Flash (free)]')
    expect(all).toContain('· quota exhausted')
    expect(all).toContain('then: GLM 5.3 Flash')
    expect((await ui.findAll({ type: 'Text', text: /^Yes$/ })).length).toBe(1)
    expect((await ui.findAll({ type: 'Text', text: /^No$/ })).length).toBe(2)
    expect((await ui.findAll({ type: 'Text', text: /^Unknown$/ })).length).toBe(1)
    expect((await buttons(ui)).filter((l: string) => l === 'Recheck').length).toBe(4)
    expect((await buttons(ui)).filter((l: string) => l === 'Sign in').length).toBe(1)
    // Recheck x4, the one fix, Check now: no other agent gets a fix button
    expect((await buttons(ui)).sort()).toEqual(['Check now', 'Recheck', 'Recheck', 'Recheck', 'Recheck', 'Sign in'])
    if (surface === 'desktop') expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThanOrEqual(5)
    await ui.unmount()
  }
})

test('Recheck pings one agent and shows a spinner row meanwhile', async ($, on) => {
  const s = fresh()
  const clock = wire(on, s)
  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  s.out = health([agent('codex', { works: true, state: 'ok' })])
  await ui.press({ plugin: 'agent-status', key: 're-codex' })
  const ping = scriptRuns(s).at(-1)
  expect(ping?.slice(-3)).toEqual(['--json', '--ping', 'codex'])
  await clock.advance(1000)
  expect(await texts(ui)).toContain('2 of 4 working')
  expect(await ui.find({ type: 'Text', text: /checking…/ })).toBeUndefined()
  await ui.unmount()
})

test('command fix opens Terminal through osascript; quotes and $ cannot break out', async ($, on) => {
  const s = fresh()
  s.out = health([agent('atlarix', { works: false, state: 'down', user_fix: { label: 'Sign in', command: 'echo "hi" && echo $HOME \\ x' } })])
  const clock = wire(on, s)
  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ plugin: 'agent-status', key: 'fix-atlarix' })
  const osa = s.runs.find(r => r[0] === 'osascript')!
  expect(osa).toBeDefined()
  expect(osa[2]).toBe('tell application "Terminal" to do script "echo \\"hi\\" && echo $HOME \\\\ x"')
  // the literal ends only at the final quote: every other quote is escaped
  const lit = osa[2]!.slice(osa[2]!.indexOf('do script ') + 10)
  expect(lit.slice(1, -1).replace(/\\\\/g, '').match(/(?<!\\)"/)).toBeNull()
  await ui.unmount()
})

test('url fix opens the browser; a non-http url is refused', async ($, on) => {
  const s = fresh()
  s.out = health([agent('copilot', { works: false, state: 'down', user_fix: { label: 'Open login', url: 'https://github.com/login/device' } }), agent('amp', { works: false, state: 'down', user_fix: { label: 'Bad', url: 'file:///etc/passwd' } })])
  const clock = wire(on, s)
  await $.session.start(START)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ plugin: 'agent-status', key: 'fix-copilot' })
  expect(s.runs.some(r => r[0] === 'open' && r[1] === 'https://github.com/login/device')).toBe(true)
  await ui.press({ plugin: 'agent-status', key: 'fix-amp' })
  expect(s.runs.filter(r => r[0] === 'open').length).toBe(1)
  await ui.unmount()
})

test('band shows for a user_fix-down agent and a recent context event, hides otherwise, and dismisses', async ($, on) => {
  const s = fresh()
  const clock = wire(on, s)
  await $.session.start(START)
  await clock.settle()
  let ui = await $.ui.mount(BAND)
  expect(await texts(ui)).toContain('atlarix needs you: Sign in')
  expect(await buttons(ui)).toContain('Sign in')
  await ui.press({ plugin: 'agent-status', key: 'dismiss' })
  await ui.unmount()
  ui = await $.ui.mount(BAND)
  expect(await texts(ui)).toBe('engine')
  await ui.unmount()

  // down without user_fix, and a stale (45 min) event: nothing to show
  s.out = health([agent('codex', { works: false, state: 'down', reason: 'quota' })], [ctxEvent(45)])
  await ($ as any).command.run({ command: 'agent-status', ...RUN })
  await clock.settle()
  ui = await $.ui.mount(BAND)
  expect(await texts(ui)).toBe('engine')
  await ui.unmount()

  // a 5 min old event shows, even after the earlier dismiss
  s.out = health([agent('codex')], [ctxEvent(5)])
  await ($ as any).command.run({ command: 'agent-status', ...RUN })
  await clock.settle()
  ui = await $.ui.mount(BAND)
  expect(await texts(ui)).toContain('opencode ran out of context on DeepSeek V4.1 Flash, switching to GLM 5.3 Flash')
  await ui.unmount()
})

test('toast fires once on works->down and once per new context event', async ($, on) => {
  const s = fresh()
  s.out = health([agent('codex'), agent('amp')])
  const clock = wire(on, s)
  await $.session.start(START)
  await clock.settle()
  expect(s.toasts).toEqual([])
  s.out = health([agent('codex', { works: false, state: 'down', reason: 'quota exhausted' }), agent('amp')], [ctxEvent(2)])
  await clock.advance(5 * 60_000)
  await clock.settle()
  expect(s.toasts.filter(t => /codex stopped working: quota exhausted/.test(t)).length).toBe(1)
  expect(s.toasts.filter(t => /ran out of context/.test(t)).length).toBe(1)
  await clock.advance(5 * 60_000)
  await clock.settle()
  expect(s.toasts.length).toBe(2)
  s.out = health([agent('codex', { works: false, state: 'down' }), agent('amp')], [ctxEvent(2), { ...ctxEvent(1), lane: 'cline' }])
  await clock.advance(5 * 60_000)
  await clock.settle()
  expect(s.toasts.length).toBe(3)
})

test('a failing script shows a quiet failure line and keeps the last data; the prompt never blocks', async ($, on) => {
  const s = fresh()
  const clock = wire(on, s)
  await $.session.start(START)
  await clock.settle()
  s.code = 1
  s.stderr = 'Traceback\nTimeoutError: agent_health took too long'
  await clock.advance(5 * 60_000)
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const all = await texts(ui)
  expect(all).toContain('health check failed: TimeoutError: agent_health took too long')
  expect(all).toContain('1 of 4 working')
  await ui.unmount()
  s.code = 0
  s.out = 'not json'
  await clock.advance(5 * 60_000)
  await clock.settle()
  const ui2 = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await texts(ui2)).toContain('health check failed: script printed no agent list')
  await ui2.unmount()
})

test('the 5 minute timer re-runs the script', async ($, on) => {
  const s = fresh()
  const clock = wire(on, s)
  await $.session.start(START)
  await clock.settle()
  const n = scriptRuns(s).length
  expect(n).toBe(1)
  await clock.advance(5 * 60_000)
  await clock.settle()
  expect(scriptRuns(s).length).toBe(n + 1)
  await clock.advance(5 * 60_000)
  await clock.settle()
  expect(scriptRuns(s).length).toBe(n + 2)
})

test('/coders is an alias that opens the same pane', async ($, on) => {
  const opens: string[] = []
  const s = { ...fresh(), opens }
  const clock = wire(on, s)
  await $.session.start(START)
  const r = await ($ as any).command.run({ command: 'coders', ...RUN })
  await clock.settle()
  expect(opens).toContain('agent-status')
  expect(JSON.stringify(r)).toContain('Coding agents')
})
