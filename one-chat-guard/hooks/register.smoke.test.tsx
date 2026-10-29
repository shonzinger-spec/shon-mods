import { expect, test } from 'claude-code/testing'

const PROMPT = 'refactor the invoice exporter module to stream rows into the ledger writer with retries'
const MATCH = { matches: [{ sessionId: 'local_old', title: 'Ledger build', score: 1, reason: 'title', idleMs: 7_200_000 }] }
const textOf = (t: string) => ({ value: { content: [{ type: 'text', text: t }] } })
const BAND = { plugin: 'one-chat-guard', component: 'AbovePrompt', props: { hasSurvey: false } } as const
const SURFACES = ['terminal', 'desktop'] as const

type On = (ev: string, fn: (_: unknown, e: any) => unknown) => void
type Opt = { hang?: boolean; stdout?: string; exitCode?: number; throws?: boolean; title?: string; openFails?: boolean; config?: object; store?: Record<string, unknown> }

function wire(on: On, o: Opt = {}) {
  const runs: { argv: string[]; stdin: string }[] = []
  const opened: Record<string, unknown>[] = []
  const toasts: string[] = []
  const submitted: any[] = []
  const store = new Map<string, unknown>(Object.entries(o.store ?? {}))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => { submitted.push(e); return { text: e.text } })
  on('turn.complete', () => ({ text: '' }))
  on('fs.read', () => ({ value: JSON.stringify(o.config ?? { enabled: true, minJaccard: 0.55, ignoreTitles: ['New chat'] }) }))
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  on('process.run', (_, e) => {
    runs.push({ argv: e.argv, stdin: e.init?.stdin ?? '' })
    if (o.hang) return new Promise(() => {})
    if (o.throws) throw new Error('boom')
    return { value: { exitCode: o.exitCode ?? 0, stdout: o.stdout ?? JSON.stringify(MATCH), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('mcp.call', (_, e) => {
    if (e.tool === 'get_session') return textOf(JSON.stringify({ sessionId: 'local_me', title: o.title ?? '' }))
    if (e.tool === 'open_session_in') {
      opened.push(e.args)
      if (o.openFails) throw new Error('no such tool')
      return textOf('ok')
    }
    return textOf('')
  })
  on('ui.render', ($: any, e) => { const { Text } = $.ui.resolve(e as never) as any; return <Text>engine</Text> })
  return { runs, opened, toasts, submitted, store }
}

const settle = () => new Promise(r => setTimeout(r, 30))
const START = { cwd: '/w/app', surface: 'desktop', isInteractive: true } as const
const SUBMIT = { text: PROMPT, origin: { kind: 'composer' } } as never
const DONE = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never

async function bandText($: any, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ ...BAND, surface })
  const t = (await ui.find({ type: 'Text', text: /Looks like/ }))?.text as string | undefined
  return { ui, text: t }
}

test('band_shown_when_match: names the chat and its idle time, prompt unchanged and sent on stdin', async ($, on) => {
  const w = wire(on)
  await $.session.start(START)
  await $.prompt.submit(SUBMIT)
  await settle()
  expect(w.submitted[0].text).toBe(PROMPT)
  expect(w.runs.length).toBe(1)
  expect(w.runs[0]?.stdin).toBe(PROMPT)
  expect(w.runs[0]?.argv.join(' ')).not.toContain('refactor')
  expect(w.runs[0]?.argv).toContain('--cwd=/w/app')
  for (const surface of SURFACES) {
    const { ui, text } = await bandText($, surface)
    expect(text).toContain('Looks like the same task as "Ledger build" (idle 2h)')
    expect(await ui.find({ type: 'Button', key: 'open' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'keep' })).toBeDefined()
    await ui.unmount()
  }
})

test('prompt_not_held: next(e) has run while the lookup never settles', async ($, on) => {
  const w = wire(on, { hang: true })
  await $.session.start(START)
  void $.prompt.submit(SUBMIT)
  await settle()
  expect(w.runs.length).toBe(1)
  expect(w.submitted.length).toBe(1)
  expect(w.submitted[0].text).toBe(PROMPT)
})

test('no_band_without_match', async ($, on) => {
  wire(on, { stdout: '{"matches":[]}' })
  await $.session.start(START)
  await $.prompt.submit(SUBMIT)
  await settle()
  for (const surface of SURFACES) {
    const { ui, text } = await bandText($, surface)
    expect(text).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
    await ui.unmount()
  }
})

test('keep_dismisses_and_persists: pair stored, band gone, later checks do not bring it back', async ($, on) => {
  const w = wire(on)
  await $.session.start(START)
  await $.prompt.submit(SUBMIT)
  await settle()
  let { ui } = await bandText($, 'desktop')
  await ui.press({ key: 'keep' })
  await ui.unmount()
  expect(w.store.get('kept')).toEqual(['local_me|local_old'])
  ;({ ui } = await bandText($, 'terminal'))
  expect(await ui.find({ type: 'Text', text: /Looks like/ })).toBeUndefined()
  await ui.unmount()
  await $.turn.complete(DONE)
  const again = await bandText($, 'desktop')
  expect(again.text).toBeUndefined()
  await again.ui.unmount()
  expect(w.runs.length).toBe(1)
})

test('a kept pair is never offered again in a later chat check', async ($, on) => {
  wire(on, { store: { kept: ['local_me|local_old'] } })
  await $.session.start(START)
  await $.prompt.submit(SUBMIT)
  await settle()
  const { ui, text } = await bandText($, 'desktop')
  expect(text).toBeUndefined()
  await ui.unmount()
})

test('slash_command_submit_ignored (and meta prompts)', async ($, on) => {
  const w = wire(on)
  await $.session.start(START)
  await $.prompt.submit({ text: '/tidy now', origin: { kind: 'composer' }, command: { name: 'tidy', args: 'now' } } as never)
  await settle()
  await $.prompt.submit({ text: PROMPT, origin: { kind: 'plugin', name: 'x' }, isMeta: true } as never)
  await settle()
  expect(w.runs.length).toBe(0)
  await $.prompt.submit(SUBMIT)
  await settle()
  expect(w.runs.length).toBe(1)
})

test('checks_only_once_per_chat: one lookup at the first prompt, one at the first usable title', async ($, on) => {
  const w = wire(on, { title: 'Ledger build' })
  await $.session.start(START)
  await $.prompt.submit(SUBMIT)
  await settle()
  await $.prompt.submit(SUBMIT)
  await settle()
  expect(w.runs.length).toBe(1)
  await $.turn.complete(DONE)
  await $.turn.complete(DONE)
  expect(w.runs.length).toBe(2)
  expect(w.runs[1]?.argv).toContain('--title=Ledger build')
  expect(w.runs[1]?.stdin).toBe(PROMPT)
})

test('turn check waits for an auto title, skips ignored ones, gives up after 3 tries', async ($, on) => {
  const w = wire(on, { title: 'New chat' })
  await $.session.start(START)
  await $.prompt.submit(SUBMIT)
  await settle()
  for (let i = 0; i < 5; i++) await $.turn.complete(DONE)
  expect(w.runs.length).toBe(1)
})

for (const [name, o] of [['throws', { throws: true }], ['exit 1', { exitCode: 1 }], ['garbage output', { stdout: 'garbage' }]] as const) {
  test(`python_failure_shows_nothing (${name}), and the prompt still goes through`, async ($, on) => {
    const w = wire(on, o)
    await $.session.start(START)
    await $.prompt.submit(SUBMIT)
    await settle()
    expect(w.submitted[0].text).toBe(PROMPT)
    const { ui, text } = await bandText($, 'desktop')
    expect(text).toBeUndefined()
    await ui.unmount()
  })
}

test('open: switches to the chat and dismisses; if the app refuses, a toast names it and the band stays', async ($, on) => {
  const w = wire(on)
  await $.session.start(START)
  await $.prompt.submit(SUBMIT)
  await settle()
  let { ui } = await bandText($, 'desktop')
  await ui.press({ key: 'open' })
  await ui.unmount()
  expect(w.opened).toEqual([{ session_id: 'local_old', target: 'focus' }])
  ;({ ui } = await bandText($, 'desktop'))
  expect(await ui.find({ type: 'Text', text: /Looks like/ })).toBeUndefined()
  await ui.unmount()
})

test('open failure: toast, band stays', async ($, on) => {
  const w = wire(on, { openFails: true })
  await $.session.start(START)
  await $.prompt.submit(SUBMIT)
  await settle()
  const { ui } = await bandText($, 'desktop')
  await ui.press({ key: 'open' })
  expect(w.toasts.join(' ')).toContain('Ledger build')
  await ui.unmount()
  const again = await bandText($, 'desktop')
  expect(again.text).toContain('Ledger build')
  await again.ui.unmount()
})

test('disabled in config: no lookup', async ($, on) => {
  const w = wire(on, { config: { enabled: false } })
  await $.session.start(START)
  await $.prompt.submit(SUBMIT)
  await settle()
  expect(w.runs.length).toBe(0)
})
