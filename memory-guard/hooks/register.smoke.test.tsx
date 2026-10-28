import { expect, mock, test } from 'claude-code/testing'

const SYS = '2\ntotal = 39936.00M  used = 38606.88M  free = 1329.12M  (encrypted)\n17179869184\nThe system has 17179869184 (1048576 pages).\nSystem-wide memory free percentage: 14%\n'
const TOP = 'Processes: 9\n\nPID PPID MEM\n300 1 52000M\n400 1 3000M\n401 1 900M\n600 1 400M\n601 600 700M\n'
const PS = [
  ' 300 1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ' 400 1 /Applications/Slack.app/Contents/MacOS/Slack',
  ' 401 1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
  ' 600 1 /Users/x/Library/Application Support/Claude/claude-code/2.1/abc/claude.app/Contents/MacOS/claude',
  ' 601 600 npx -y @scope/some-server',
].join('\n') + '\n'
declare const setTimeout: (f: (v?: unknown) => void, ms: number) => unknown
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const wait = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++) await new Promise(r => setTimeout(r, 20))
}

type On = (ev: string, fn: (_: unknown, e: any) => unknown) => void
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wire(on: On, alertJson: string, toasts: string[], spy?: (e: { argv: string[]; init?: { stdin?: string } }) => void, ps = PS, ownClock = true) {
  on('env.get', () => ({ value: '/home/t' }))
  if (ownClock) on('clock.now', () => ({ value: 1_000_000 }))
  on('fs.read', (_: unknown, e: unknown) => ({ value: (e as { path: string }).path.endsWith('alert.json') ? alertJson : '' }))
  on('fs.write', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    spy?.(e as { argv: string[]; init?: { stdin?: string } })
    const argv = (e as { argv: string[] }).argv
    return ok(argv[0] === '/bin/sh' && (argv[2] ?? '').includes('sysctl') ? SYS : argv[0] === 'top' ? TOP : argv[0] === 'ps' ? ps : '')
  })
}

test('session.start registers mem and a first tick fires exactly one warn toast', async ($, on) => {
  const names: string[] = []
  const toasts: string[] = []
  on('command.register', (_, e) => {
    names.push((e as { name: string }).name)
    return { value: { command: 'x' } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  wire(on, '', toasts)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await wait(() => toasts.length > 0)
  await new Promise(r => setTimeout(r, 100))
  expect(names).toEqual(['mem'])
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('warn')
})

test('a tick right after an alert fires no toast', async ($, on) => {
  const toasts: string[] = []
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  wire(on, JSON.stringify({ level: 'warn', at: 1_000_000 }), toasts)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await new Promise(r => setTimeout(r, 400))
  expect(toasts.length).toBe(0)
})

test('/mem lists Google Chrome', async ($, on) => {
  wire(on, '', [])
  const r = await $.command.run({ command: 'mem', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(JSON.stringify(r)).toContain('Google Chrome')
})

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

// Records osascript calls and actions.jsonl rows; ask answers come from `answers` in order.
function cleanWire(on: On, answers: string[], ownClock = true) {
  const osa: string[][] = []
  const rows: any[] = []
  wire(on, '', [], e => {
    if (e.argv[0] === 'osascript') osa.push(e.argv)
    if (e.argv[0] === '/bin/sh' && (e.argv[2] ?? '').includes('cat >>') && (e.argv[4] ?? '').endsWith('actions.jsonl')) rows.push(JSON.parse(e.init?.stdin ?? '{}'))
  }, PS, ownClock)
  // $.ui.ask is a tool.call of AskUserQuestion; answer it from the queue.
  on('tool.call', (_, e) => {
    const q = e as { tool: string; questions: { question: string }[] }
    const a = answers.shift() ?? ''
    return { result: { questions: q.questions, answers: { [q.questions[0]?.question ?? '']: a } }, text: a }
  })
  return { osa, rows }
}

test('/mem clean --dry-run lists Slack, quits nothing, logs one dry-run row', async ($, on) => {
  const { osa, rows } = cleanWire(on, [])
  const r = await $.command.run({ command: 'mem', args: 'clean --dry-run', ...RUN })
  const txt = JSON.stringify(r)
  expect(txt).toContain('Slack')
  expect(txt).not.toContain('Terminal 0.9G (')
  expect(osa.length).toBe(0)
  expect(rows.filter(x => x.action === 'dry-run').length).toBe(1)
})

test('/mem clean: pick Slack then Quit them runs exactly one osascript', async ($, on) => {
  const { osa, rows } = cleanWire(on, ['Slack 3.0G', 'Quit them'])
  await $.command.run({ command: 'mem', args: 'clean', ...RUN })
  expect(osa).toEqual([['osascript', '-e', 'tell application "/Applications/Slack.app" to quit']])
  expect(rows.map(x => x.action)).toContain('quit')
})

test('/mem clean: Cancel quits nothing', async ($, on) => {
  const { osa, rows } = cleanWire(on, ['Slack 3.0G', 'Cancel'])
  await $.command.run({ command: 'mem', args: 'clean', ...RUN })
  expect(osa.length).toBe(0)
  expect(rows.map(x => x.action)).toContain('cancelled')
})

test('band: Not now hides it; Let Claude clean it picks, confirms and quits one app', async ($, on) => {
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const clock = mock.clock(on, { now: 1_000_000 })
  const { osa } = cleanWire(on, ['Slack 3.0G', 'Quit them'], false)
  // Stands for the engine beneath the mod: what shows when the band passes.
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e as never) as any; return <Text>engine</Text> })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const BAND = { plugin: 'memory-guard', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } } as unknown as Parameters<typeof $.ui.mount>[0]
  let ui = await $.ui.mount(BAND)
  for (let i = 0; i < 20 && !(await ui.find({ type: 'Text', text: /Memory (warn|critical)/ })); i++) {
    await ui.unmount()
    await new Promise(r => setTimeout(r, 100))
    ui = await $.ui.mount(BAND)
  }
  expect(await ui.find({ type: 'Text', text: /Memory (warn|critical)/ })).toBeDefined()
  await ui.press({ key: 'clean' })
  // The press only starts the clean-up (a press must return fast); the timer runs it.
  expect(osa.length).toBe(0)
  await clock.advance(100)
  expect(osa).toEqual([['osascript', '-e', 'tell application "/Applications/Slack.app" to quit']])
  await ui.press({ key: 'later' })
  await ui.unmount()
  ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /Memory (warn|critical)/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('/mem clean: a single candidate still gets 2+ options, and a hung quit is logged and survived', async ($, on) => {
  const opts: string[][] = []
  const rows: any[] = []
  const answers = ['Slack 3.0G', 'Quit them']
  wire(on, '', [], e => {
    if (e.argv[0] === '/bin/sh' && (e.argv[2] ?? '').includes('cat >>') && (e.argv[4] ?? '').endsWith('actions.jsonl')) rows.push(JSON.parse(e.init?.stdin ?? '{}'))
    if (e.argv[0] === 'osascript') throw new Error('timed out')
  }, '400 1 /Applications/Slack.app/Contents/MacOS/Slack\n') // only Slack runs: exactly one candidate
  on('tool.call', (_, e) => {
    const q = e as { tool: string; questions: { question: string; options: { label: string }[] }[] }
    opts.push((q.questions[0]?.options ?? []).map(o => o.label))
    const a = answers.shift() ?? ''
    return { result: { questions: q.questions, answers: { [q.questions[0]?.question ?? '']: a } }, text: a }
  })
  const r = await $.command.run({ command: 'mem', args: 'clean', ...RUN })
  expect(opts.every(o => o.length >= 2)).toBe(true)
  expect(JSON.stringify(r)).toContain('no answer')
  expect(rows.some(x => x.action === 'quit' && x.exitCode === null)).toBe(true)
})
