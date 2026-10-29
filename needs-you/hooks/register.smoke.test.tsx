import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { CONTINUE_MESSAGE } from './limit'

const NOW = 1_800_000_000_000
const SCAN = {
  now_ms: NOW,
  rows: [
    { sessionId: 'w1', title: 'Propfarm handoff', status: 'waiting', kind: null, question: 'Start it here anyway?', question_source: 'wrap_up', last_activity_ms: NOW - 3_600_000, error: null },
    { sessionId: 's1', title: 'Cut off chat', status: 'stalled', kind: 'limit', question: null, question_source: null, last_activity_ms: NOW - 600_000, error: "You've hit your session limit" },
    { sessionId: 'r1', title: 'Busy chat', status: 'working', kind: null, question: null, question_source: null, last_activity_ms: NOW, error: null },
    { sessionId: 'd1', title: 'Finished chat', status: 'done', kind: null, question: null, question_source: null, last_activity_ms: NOW - 86_400_000, error: null },
    { sessionId: 'me', title: 'This chat', status: 'waiting', kind: null, question: 'self?', question_source: 'text', last_activity_ms: NOW, error: null },
  ],
}

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const PANE = {
  plugin: 'needs-you',
  component: 'Pane',
  requestId: 'needs-you',
  props: { title: 'Needs you', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const text = (t: string, isError = false) => ({ value: { content: [{ type: 'text', text: t }], isError } })

const LIMIT_AT = NOW - 3_600_000
const RESET_AT = NOW - 600_000
const limitRow = (id: string, title: string, o: Record<string, unknown> = {}) => ({
  sessionId: id, title, status: 'stalled', kind: 'limit', question: null, question_source: null,
  last_activity_ms: LIMIT_AT, error: "You've hit your session limit", error_at_ms: LIMIT_AT,
  limit: { kind: 'session', reset_at_ms: RESET_AT }, ...o,
})
const LIMIT_SCAN = { now_ms: NOW, rows: [limitRow('L1', 'Limit chat'), limitRow('L2', 'Not yet', { limit: { kind: 'session', reset_at_ms: NOW + 3_600_000 } })] }

function engine(on: On, o: { placed?: boolean; stdout?: string; exitCode?: number; openError?: boolean; sendError?: boolean; sendText?: string; sendThrows?: boolean; auto?: boolean; files?: Record<string, string>; sessionState?: Record<string, unknown> } = {}) {
  const sends: { id: string; message: string }[] = []
  const files: Record<string, string> = { ...o.files }
  const runs: string[] = []
  const clock = mock.clock(on, { now: NOW })
  const calls: { tool: string; args: Record<string, unknown> }[] = []
  const argvs: string[][] = []
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  mock.env(on, { HOME: '/home/t' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'needs-you' } }))
  on('ui.open', () => ({ value: o.placed === false ? { isPlaced: false, reason: 'too narrow' } : { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('store.get', () => ({ value: o.auto ? true : undefined }))
  on('store.set', () => ({ value: undefined }))
  on('fs.read', (_, e) => {
    return { value: files[(e as { path: string }).path] ?? '' }
  })
  on('fs.write', (_, e) => {
    files[(e as { path: string }).path] = String((e as { text?: string }).text ?? '')
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined }
  })
  on('ui.status', (_, e) => {
    statuses.push((e as { text?: string }).text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const x = e as { argv: string[]; init?: { stdin?: string } }
    if (x.argv[0] === '/bin/sh' || x.argv[0] === '/bin/mkdir' || x.argv[0] === '/bin/rmdir') {
      if ((x.init?.stdin ?? '') !== '') runs.push(x.init?.stdin ?? '')
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    argvs.push((e as { argv: string[] }).argv)
    return { value: { exitCode: o.exitCode ?? 0, stdout: o.stdout ?? JSON.stringify(SCAN), stderr: o.exitCode ? 'boom' : '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('mcp.call', (_, e) => {
    const m = e as { server: string; tool: string; args: Record<string, unknown> }
    calls.push({ tool: m.tool, args: m.args })
    if (m.tool === 'get_session') {
      const id = String((m.args as { session_id?: string }).session_id)
      return text(JSON.stringify(id === 'self' ? { sessionId: 'me' } : { sessionId: id, isRunning: false, ...o.sessionState }))
    }
    if (m.tool === 'send_message') {
      if (o.sendThrows) throw new Error('mcp down')
      sends.push({ id: String((m.args as { session_id?: string }).session_id), message: String((m.args as { message?: string }).message) })
      return text(o.sendError ? 'refused' : (o.sendText ?? 'Message sent. (delivery: delivered; message_id: m1)'), o.sendError)
    }
    if (m.tool === 'list_sessions') return text(JSON.stringify([{ sessionId: 'r1', isRunning: true }]))
    if (m.tool === 'open_session_in') return text(o.openError ? 'not a session you started' : 'ok', o.openError)
    return text('')
  })
  return { calls, argvs, toasts, statuses, sends, files, runs, clock }
}
const SENT = '/home/t/.claude/mods-src/needs-you/state/sent.json'

test('pane draws stalled, waiting and the collapsed counts on terminal and desktop', async ($, on) => {
  const w = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = await $.command.run({ command: 'needs-you', args: '', ...RUN })
  expect(String((r as { text?: string }).text)).toBe('needs-you: 1 waiting, 1 stalled.')
  // the scanner got the running chat id and ran isolated, read-only
  expect(w.argvs[0]?.slice(0, 2)).toEqual(['/usr/bin/python3', '-I'])
  expect(w.argvs[0]).toContain('r1')
  expect(w.statuses.at(-1)).toBe('1 waiting, 1 stalled')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Stalled/ }))?.text).toBe('Stalled (1)')
    expect((await ui.find({ type: 'Text', text: /^Waiting on you/ }))?.text).toBe('Waiting on you (1)')
    expect((await ui.find({ type: 'Text', text: /Start it here anyway/ }))?.text).toContain('Start it here anyway?')
    expect((await ui.find({ type: 'Text', text: /collapsed/ }))?.text).toContain('1 working')
    expect(await ui.find({ type: 'Text', text: /self\?/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('text list is the answer when the pane is not placed', async ($, on) => {
  engine(on, { placed: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = await $.command.run({ command: 'needs-you', args: '', ...RUN })
  const t = String((r as { text?: string }).text)
  expect(t).toContain('Stalled')
  expect(t).toContain('Propfarm handoff')
  expect(t).toContain('Start it here anyway?')
  expect(t).not.toContain('self?')
})

test('a failing scanner shows its error and does not blank the command', async ($, on) => {
  engine(on, { exitCode: 1 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = await $.command.run({ command: 'needs-you', args: '', ...RUN })
  expect(String((r as { text?: string }).text)).toContain('scan failed')
})

test('opening a chat the app refuses falls back to a toast naming it', async ($, on) => {
  const w = engine(on, { openError: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'needs-you', args: '', ...RUN })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'w1' })
  expect(w.calls.some(c => c.tool === 'open_session_in' && c.args.session_id === 'w1' && c.args.target === 'focus')).toBe(true)
  expect(w.toasts.some(t => t.includes('Propfarm handoff'))).toBe(true)
  await ui.unmount()
})

const limitPane = async ($: Engine) => {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'needs-you', args: '', ...RUN })
  return $.ui.mount({ ...PANE, surface: 'desktop' })
}

test('Continue shows only once the reset passed; pressing it sends the continue message, never the original prompt, and records it', async ($, on) => {
  const w = engine(on, { stdout: JSON.stringify(LIMIT_SCAN) })
  const ui = await limitPane($)
  expect(await ui.find({ type: 'Text', text: /resets / })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'continue-L2' })).toBeUndefined()
  await ui.press({ key: 'continue-L1' })
  expect(w.sends).toEqual([{ id: 'L1', message: CONTINUE_MESSAGE }])
  expect(JSON.parse(w.files[SENT] ?? '{}')[`L1:${LIMIT_AT}`]).toBe(NOW)
  expect(w.runs.join('')).toContain('"event":"sent"')
  // sent: the button is gone and the row says so
  expect(await ui.find({ type: 'Button', key: 'continue-L1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /continue message sent/ })).toBeDefined()
  expect(w.sends.length).toBe(1)
  await ui.unmount()
})

test('send failure leaves the chat listed as stalled and unrecorded, so it can be retried', async ($, on) => {
  const w = engine(on, { stdout: JSON.stringify(LIMIT_SCAN), sendError: true })
  const ui = await limitPane($)
  await ui.press({ key: 'continue-L1' })
  expect(w.sends.length).toBe(1)
  expect(w.files[SENT]).toBeUndefined()
  expect(w.runs.join('')).toContain('send-failed')
  expect(w.toasts.some(t => t.includes('could not continue'))).toBe(true)
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await again.find({ type: 'Text', text: /^Stalled/ }))?.text).toBe('Stalled (2)')
  expect(await again.find({ type: 'Button', key: 'continue-L1' })).toBeDefined()
  await again.unmount()
})

test('a send the app reports as not delivered (no error flag) is not recorded and is logged send-failed', async ($, on) => {
  const w = engine(on, { stdout: JSON.stringify(LIMIT_SCAN), sendText: 'Session archived. (delivery: rejected; message_id: -)' })
  const ui = await limitPane($)
  await ui.press({ key: 'continue-L1' })
  expect(w.sends.length).toBe(1)
  expect(w.files[SENT]).toBeUndefined()
  expect(w.runs.join('')).toContain('send-failed')
  expect(w.runs.join('')).not.toContain('"event":"sent"')
  await ui.unmount()
})

test('a chat that is running again is not sent to', async ($, on) => {
  const w = engine(on, { stdout: JSON.stringify(LIMIT_SCAN), sessionState: { isRunning: true } })
  const ui = await limitPane($)
  await ui.press({ key: 'continue-L1' })
  expect(w.sends.length).toBe(0)
  expect(w.files[SENT]).toBeUndefined()
  await ui.unmount()
})

test('/needs-you auto is off by default; the minute timer then only notifies, once', async ($, on) => {
  const w = engine(on, { stdout: JSON.stringify(LIMIT_SCAN) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(60_000)
  expect(w.sends.length).toBe(0)
  expect(w.toasts.filter(t => t.includes('usage limit reset')).length).toBe(1)
  expect(w.toasts.join('')).toContain('Limit chat')
  w.files['/home/t/.claude/mods-src/needs-you/state/limit-last.json'] = '{"at":0}'
  await w.clock.advance(60_000)
  expect(w.toasts.filter(t => t.includes('usage limit reset')).length).toBe(1)
})

test('auto on: the timer sends once per error after the grace period and never twice', async ($, on) => {
  const w = engine(on, { stdout: JSON.stringify({ ...LIMIT_SCAN, rows: [limitRow('L3', 'Auto chat', { limit: { kind: 'session', reset_at_ms: NOW - 6 * 60_000 } }), limitRow('L4', 'In grace', { limit: { kind: 'session', reset_at_ms: NOW - 2 * 60_000 } })] }), auto: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(60_000)
  expect(w.sends).toEqual([{ id: 'L3', message: CONTINUE_MESSAGE }])
  w.files['/home/t/.claude/mods-src/needs-you/state/limit-last.json'] = '{"at":0}'
  await w.clock.advance(60_000)
  expect(w.sends.length).toBe(1)
})

test('/needs-you resume lists ready chats and resume <n> sends to that one', async ($, on) => {
  const w = engine(on, { stdout: JSON.stringify(LIMIT_SCAN) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const list = await $.command.run({ command: 'needs-you', args: 'resume', ...RUN })
  expect(String((list as { text?: string }).text)).toContain('1. Limit chat')
  expect(String((list as { text?: string }).text)).not.toContain('Not yet')
  const r = await $.command.run({ command: 'needs-you', args: 'resume 1', ...RUN })
  expect(String((r as { text?: string }).text)).toContain('sent "continue" to "Limit chat"')
  expect(w.sends.map(s => s.id)).toEqual(['L1'])
})
