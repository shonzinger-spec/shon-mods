import { expect, test } from 'claude-code/testing'

declare const setTimeout: (f: (v?: unknown) => void, ms: number) => unknown
const NOW = Date.parse('2026-10-28T00:00:00Z')
const DAY = 86_400_000
const ago = (d: number) => new Date(NOW - d * DAY).toISOString()
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
const text = (t: string) => ({ value: { content: [{ type: 'text', text: t }] } })
const ok = (code: number) => ({ value: { exitCode: code, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

const ROWS = [
  { sessionId: 'old', title: 'Old chat', lastActivityAt: ago(20) },
  { sessionId: 'new', title: 'New chat', lastActivityAt: ago(1) },
  { sessionId: 'me', title: 'Me', lastActivityAt: ago(30) },
]

type On = (ev: string, fn: (_: unknown, e: any) => unknown) => void
function wire(on: On, o: { backup: number; lastRun?: number; listMax?: number; locked?: boolean; runningNow?: string[] }) {
  const archived: string[] = []
  const toasts: string[] = []
  const argvs: string[][] = []
  const appended: string[] = []
  const written: Record<string, string> = {}
  on('env.get', () => ({ value: '/home/t' }))
  on('clock.now', () => ({ value: NOW }))
  on('store.get', () => ({ value: undefined }))
  on('fs.read', (_, e) => {
    const p = (e as { path: string }).path
    return { value: p.endsWith('last-run.json') && o.lastRun !== undefined ? JSON.stringify({ at: o.lastRun }) : '' }
  })
  on('fs.write', (_, e) => {
    written[(e as { path: string }).path] = String((e as { content?: string }).content ?? '')
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const x = e as { argv: string[]; init?: { stdin?: string } }
    argvs.push(x.argv)
    if (x.argv[0] === '/bin/sh' && x.argv[4]?.endsWith('archive-log.md')) appended.push(x.init?.stdin ?? '')
    if (x.argv[0] === '/bin/sh' && (x.argv[2] ?? '').includes('run.lock')) return ok(o.locked ? 1 : 0)
    return ok(x.argv[0] === '/usr/bin/python3' ? o.backup : 0)
  })
  on('mcp.call', (_, e) => {
    const m = e as { tool: string; args: { session_id?: string } }
    if (m.tool === 'get_session') {
      if (m.args.session_id === 'self') return text(JSON.stringify({ sessionId: 'me' }))
      const row = ROWS.find(r => r.sessionId === m.args.session_id)
      return text(JSON.stringify({ ...row, isRunning: o.runningNow?.includes(m.args.session_id ?? '') ?? false }))
    }
    if (m.tool === 'list_sessions') {
      const lim = (m.args as { limit?: number }).limit ?? 0
      return o.listMax !== undefined && lim > o.listMax ? text('Error: result (72,147 characters) exceeds maximum allowed tokens.') : text(JSON.stringify(ROWS))
    }
    if (m.tool === 'archive_session') {
      archived.push(m.args.session_id ?? '')
      return text('archived')
    }
    return text('')
  })
  return { archived, toasts, argvs, appended, written }
}

test('/tidy dry run lists the idle chat, archives nothing, runs no backup', async ($, on) => {
  const w = wire(on, { backup: 0 })
  const r = await $.command.run({ command: 'tidy', args: '', ...RUN })
  expect(JSON.stringify(r)).toContain('Old chat')
  expect(w.archived.length).toBe(0)
  expect(w.argvs.some(a => (a[1] ?? '').endsWith('backup_raw.py'))).toBe(false)
  expect(w.toasts.length).toBe(0)
})

test('/tidy now: backup ok archives exactly the idle chat, logs, one toast', async ($, on) => {
  const w = wire(on, { backup: 0 })
  await $.command.run({ command: 'tidy', args: 'now', ...RUN })
  expect(w.archived).toEqual(['old'])
  expect(w.appended.join('')).toContain('# chat-tidy archive log')
  expect(w.appended.join('')).toContain('- archived: Old chat (old, idle 20 d)')
  expect(w.toasts.length).toBe(1)
  expect(w.toasts[0]).toContain('archived 1 idle chats')
})

test('/tidy now: backup exit 1 archives nothing and toasts backup failed', async ($, on) => {
  const w = wire(on, { backup: 1 })
  await $.command.run({ command: 'tidy', args: 'now', ...RUN })
  expect(w.archived.length).toBe(0)
  expect(w.toasts.length).toBe(1)
  expect(w.toasts[0]).toContain('backup failed')
})

test('session.start with last-run 1 h old does nothing', async ($, on) => {
  const w = wire(on, { backup: 0, lastRun: NOW - 3_600_000 })
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await new Promise(r => setTimeout(r, 300))
  expect(w.archived.length).toBe(0)
  expect(w.argvs.some(a => (a[1] ?? '').endsWith('backup_raw.py'))).toBe(false)
})

test('session.start with no last-run claims the run then archives', async ($, on) => {
  const w = wire(on, { backup: 0 })
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (let i = 0; i < 100 && !w.archived.length; i++) await new Promise(r => setTimeout(r, 20))
  expect(w.archived).toEqual(['old'])
  expect(Object.keys(w.written).some(p => p.endsWith('last-run.json'))).toBe(true)
})

test('/tidy now: a list too big for one result falls back to a smaller size and still archives', async ($, on) => {
  const w = wire(on, { backup: 0, listMax: 120 })
  await $.command.run({ command: 'tidy', args: 'now', ...RUN })
  expect(w.archived).toEqual(['old'])
})

test('/tidy now while another chat holds the run lock does nothing', async ($, on) => {
  const w = wire(on, { backup: 0, locked: true })
  const r = await $.command.run({ command: 'tidy', args: 'now', ...RUN })
  expect(JSON.stringify(r)).toContain('another chat')
  expect(w.archived.length).toBe(0)
  expect(w.argvs.some(a => (a[1] ?? '').endsWith('backup_raw.py'))).toBe(false)
})

test('/tidy now re-checks each chat first: one that started running since the scan is not archived', async ($, on) => {
  const w = wire(on, { backup: 0, runningNow: ['old'] })
  await $.command.run({ command: 'tidy', args: 'now', ...RUN })
  expect(w.archived.length).toBe(0)
})
