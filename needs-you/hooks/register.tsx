import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChatRow, Scan, SentLog } from '../types'
import { CONTINUE_MESSAGE, delivered, due, limitLine, parseCommand, parseSent, resetText, resumable, sentKey, stillIdle } from './limit'
import { ageText, group, listText, parseScan, rowLine, runningIds, statusText } from './lib'

const PANE = 'needs-you'
const REFRESH_MS = 5 * 60_000
const scanAtom = atom({ plugin: 'needs-you', key: 'scan' } as const, null)
const errorAtom = atom({ plugin: 'needs-you', key: 'error' } as const, '')

const LIMIT_TICK_MS = 60_000
const RETRY_AFTER_FAILURE_MS = 15 * 60_000

let timerStarted = false
let selfCache: string | null = null
// auto mode does not hammer a chat the app refused: failures are retried after a pause
const failedAt = new Map<string, number>()

const textOf = (r: { content?: unknown }) => ((r.content ?? []) as { text?: string }[]).map(c => c.text ?? '').join('')

async function selfId($: EngineInterface): Promise<string | null> {
  if (selfCache) return selfCache
  try {
    const r = await $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: 'self' })
    const id = JSON.parse(textOf(r))?.sessionId
    selfCache = typeof id === 'string' && id ? id : null
  } catch {
    // chat stays in the list when its own id cannot be read
  }
  return selfCache
}

// Read-only: one list_sessions call (which chats are running now), then the scanner
// over the app's own per-chat files. Nothing is written anywhere.
async function refresh($: EngineInterface): Promise<Scan | null> {
  let running: string[] = []
  try {
    const l = await $.mcp.call('ccd_session_mgmt', 'list_sessions', { limit: 60 })
    running = runningIds(textOf(l))
  } catch {
    // running marks are best effort
  }
  try {
    const args = ['/usr/bin/python3', '-I', `${$.plugin.root}/tools/scan_chats.py`]
    if (running.length) args.push('--running', running.join(','))
    const run = await $.process.run(args, { timeoutMs: 30_000 })
    if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n').slice(-2).join(' ') || `exit ${run.exitCode}`)
    const scan = parseScan(run.stdout)
    if (!scan) throw new Error('scanner printed no chat list')
    await update($, scanAtom, () => scan)
    await update($, errorAtom, () => '')
    $.ui.status(statusText(group(scan, await selfId($))))
    return scan
  } catch (err) {
    await update($, errorAtom, () => `scan failed: ${String(err).slice(0, 200)}`)
    return null
  }
}

type Ctx = EngineInterface

// State lives beside the mod's source, like chat-tidy: sent.json, notified.json, runs.jsonl.
const stateDir = async ($: Ctx) => `${(await $.env.get('HOME')) ?? ''}/.claude/mods-src/needs-you/state`

async function readText($: Ctx, path: string): Promise<string> {
  try {
    return String(await $.fs.read(path))
  } catch {
    return ''
  }
}

async function writeJson($: Ctx, path: string, value: unknown): Promise<void> {
  await $.process.run(['/bin/mkdir', '-p', path.replace(/\/[^/]*$/, '')], { timeoutMs: 5000 })
  await $.fs.write(path, JSON.stringify(value))
}

async function appendRun($: Ctx, entry: Record<string, unknown>): Promise<void> {
  const at = await $.clock.now()
  await $.process.run(
    ['/bin/sh', '-c', 'mkdir -p "$(dirname "$1")" && cat >> "$1"', 'sh', `${await stateDir($)}/runs.jsonl`],
    { stdin: `${JSON.stringify({ at, ...entry })}\n`, timeoutMs: 5000 },
  ).catch(() => undefined)
}

// One acting chat at a time across all open chats: mkdir is atomic. A lock older than 10 min is stale.
async function lock($: Ctx, D: string): Promise<boolean> {
  const r = await $.process.run(['/bin/sh', '-c',
    'L="$1/limit.lock"; mkdir -p "$1"; if mkdir "$L" 2>/dev/null; then exit 0; fi; ' +
    'if [ $(( $(date +%s) - $(stat -f %m "$L") )) -gt 600 ]; then rmdir "$L" && mkdir "$L" 2>/dev/null && exit 0; fi; exit 1', 'sh', D], { timeoutMs: 5000 }).catch(() => null)
  return r?.exitCode === 0
}
const unlock = ($: Ctx, D: string) => $.process.run(['/bin/rmdir', `${D}/limit.lock`], { timeoutMs: 5000 }).catch(() => undefined)

const readSent = async ($: Ctx, file = 'sent.json'): Promise<SentLog> => parseSent(await readText($, `${await stateDir($)}/${file}`))

// Sends the continue message to one limit-stalled chat. Only a local app chat is addressed; the
// chat is checked again right before the send, and a failed send records nothing so the chat
// stays listed as stalled.
async function sendContinue($: Ctx, r: ChatRow, self: string | null, mode: 'auto' | 'manual'): Promise<{ ok: boolean; why: string }> {
  const fail = async (why: string) => {
    failedAt.set(sentKey(r), await $.clock.now())
    await appendRun($, { event: 'send-failed', mode, sessionId: r.sessionId, errorAt: r.error_at_ms, why })
    return { ok: false, why }
  }
  if (!self || r.sessionId === self) return { ok: false, why: 'will not send to this chat' }
  try {
    const g = await $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: r.sessionId })
    if ((g as { isError?: boolean }).isError || !stillIdle(textOf(g), r)) {
      await appendRun($, { event: 'skipped', mode, sessionId: r.sessionId, errorAt: r.error_at_ms, why: 'chat changed' })
      return { ok: false, why: 'the chat is running or changed since the scan' }
    }
    const res = await $.mcp.call('ccd_session_mgmt', 'send_message', { session_id: r.sessionId, message: CONTINUE_MESSAGE })
    if ((res as { isError?: boolean }).isError) return await fail(textOf(res).slice(0, 120) || 'the app refused the message')
    if (!delivered(textOf(res))) return await fail(textOf(res).slice(0, 120) || 'the app did not deliver the message')
  } catch (err) {
    return await fail(String(err).slice(0, 120))
  }
  const now = await $.clock.now()
  const sent = await readSent($)
  sent[sentKey(r)] = now
  await writeJson($, `${await stateDir($)}/sent.json`, sent).catch(() => undefined)
  failedAt.delete(sentKey(r))
  await appendRun($, { event: 'sent', mode, sessionId: r.sessionId, errorAt: r.error_at_ms })
  return { ok: true, why: '' }
}

// Once a minute, one chat (the lock) looks for chats whose limit has reset. Auto mode (off
// by default) sends once per error; otherwise a single toast says which chats can continue.
async function limitTick($: Ctx): Promise<void> {
  const D = await stateDir($)
  const now = await $.clock.now()
  try {
    const last = JSON.parse(await readText($, `${D}/limit-last.json`))?.at
    if (typeof last === 'number' && now - last < LIMIT_TICK_MS - 5000) return
  } catch {
    // missing or unreadable: go on
  }
  if (!(await lock($, D))) return
  try {
    await writeJson($, `${D}/limit-last.json`, { at: now })
    const self = await selfId($)
    if (!self) return
    const scan = await refresh($)
    if (!scan) return
    const sent = await readSent($)
    const auto = (await $.store.get('auto').catch(() => undefined)) === true
    if (auto) {
      for (const r of due({ ...scan, now_ms: now }, sent, self)) {
        const failed = failedAt.get(sentKey(r))
        if (failed !== undefined && now - failed < RETRY_AFTER_FAILURE_MS) continue
        const res = await sendContinue($, r, self, 'auto')
        $.ui.toast(res.ok ? `needs-you: sent "continue" to "${r.title}" after its usage limit reset.` : `needs-you: could not continue "${r.title}": ${res.why}`, { timeoutMs: 8000 })
      }
      return
    }
    const notified = await readSent($, 'notified.json')
    const fresh = resumable({ ...scan, now_ms: now }, sent, self).filter(r => !(sentKey(r) in notified))
    if (fresh.length === 0) return
    for (const r of fresh) notified[sentKey(r)] = now
    await writeJson($, `${D}/notified.json`, notified)
    $.ui.toast(`needs-you: usage limit reset for ${fresh.map(r => `"${r.title}"`).join(', ')}. Open /needs-you to continue.`, { timeoutMs: 10_000 })
  } finally {
    await unlock($, D)
  }
}

// Pane button and /needs-you resume <n>: rescan, then the same checks as auto mode minus the grace period.
async function continueChat($: Ctx, id: string): Promise<string> {
  const self = await selfId($)
  const scan = await refresh($)
  if (!scan) return 'scan failed'
  const r = resumable({ ...scan, now_ms: await $.clock.now() }, await readSent($), self).find(x => x.sessionId === id)
  if (!r) return 'that chat is no longer waiting to continue (already sent, running, or not past its reset)'
  const res = await sendContinue($, r, self, 'manual')
  return res.ok ? `sent "continue" to "${r.title}"` : `could not continue "${r.title}": ${res.why}`
}

// Focus works only for chats this chat started; for any other the app refuses, so the
// answer is a toast naming the chat to open from the sidebar.
async function openChat($: EngineInterface, id: string, title: string): Promise<void> {
  try {
    const r = await $.mcp.call('ccd_window', 'open_session_in', { session_id: id, target: 'focus' })
    if (!(r as { isError?: boolean }).isError) return
  } catch {
    // fall through to the toast
  }
  $.ui.toast(`needs-you: open "${title}" from the sidebar (the app only focuses chats this chat started).`, { timeoutMs: 8000 })
}

async function continueFromPane($: Ctx, id: string): Promise<void> {
  $.ui.toast(`needs-you: ${await continueChat($, id)}`, { timeoutMs: 8000 })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'needs-you', description: 'Pane of every open chat that is stalled or waiting on you. /needs-you resume [n] continues a chat after its usage limit reset; /needs-you auto on|off.' })
      if (!timerStarted) {
        timerStarted = true
        $.clock.every(LIMIT_TICK_MS, () => void limitTick($).catch(() => undefined))
        $.clock.every(REFRESH_MS, () => {
          void (async () => {
            const open = await $.ui.panes()
            if (open.some(p => p.id === PANE)) await refresh($)
          })().catch(() => undefined)
        })
      }
    } catch {
      // never throw out of a hook
    }
    return next(e)
  })

  on('command.run', { command: 'needs-you' }, async ($, e) => {
    const cmd = parseCommand((e as { args?: string }).args ?? '')
    if (cmd.kind === 'auto') {
      await $.store.set('auto', cmd.on)
      return { text: cmd.on ? 'auto-continue is ON. A chat cut off by the usage limit gets one "continue" message 5 minutes after its reset. Turn off with /needs-you auto off.' : 'auto-continue is OFF.' }
    }
    if (cmd.kind === 'auto-status') {
      return { text: `auto-continue is ${(await $.store.get('auto').catch(() => undefined)) === true ? 'ON' : 'OFF'}.` }
    }
    if (cmd.kind === 'resume') {
      const self = await selfId($)
      const rs = await refresh($)
      if (!rs) return { text: `${await read($, errorAtom)}` }
      const ready = resumable({ ...rs, now_ms: await $.clock.now() }, await readSent($), self)
      if (cmd.n === null) {
        return { text: ready.length ? ['ready to continue (use /needs-you resume <n>)', ...ready.map((r, i) => `${i + 1}. ${r.title} (reset ${resetText(r.limit?.reset_at_ms ?? 0, rs.now_ms)})`)].join('\n') : 'needs-you: no chat is waiting to continue after a usage limit.' }
      }
      const pick = ready[cmd.n - 1]
      if (!pick) return { text: `no chat number ${cmd.n} in the ready list.` }
      return { text: `${await continueChat($, pick.sessionId)}` }
    }
    const scan = await refresh($)
    const self = await selfId($)
    const opened = await $.ui.open({ id: PANE, title: 'Needs you' })
    if (!scan) return { text: `${await read($, errorAtom)}` }
    // A pane the surface cannot place (too narrow) leaves the text list as the answer.
    if (!opened.isPlaced) return { text: listText(scan, self) }
    const s = statusText(group(scan, self))
    return { text: `${s ?? 'nothing waiting on you'}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const scan = await read($, scanAtom)
    const err = await read($, errorAtom)
    const sent = await readSent($)
    const nowMs = await $.clock.now()
    const head = (
      <Box>
        <Text dimColor>{scan ? 'read-only · ' : 'loading… '}</Text>
        <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
      </Box>
    )
    if (!scan) {
      return (
        <Box flexDirection="column">
          {head}
          {err !== '' && <Text color="red">{err}</Text>}
        </Box>
      )
    }
    const g = group(scan, selfCache)
    const canContinue = new Set(resumable({ ...scan, now_ms: nowMs }, sent, selfCache).map(r => r.sessionId))
    const chatRow = (r: (typeof g.waiting)[number]) => (
      <Box flexDirection="column">
        <Button key={r.sessionId} label={`${r.title} · ${ageText(scan.now_ms, r.last_activity_ms)}`} onPress={() => openChat($, r.sessionId, r.title)} />
        <Text color={r.status === 'stalled' ? 'red' : undefined}>{rowLine(r, scan.now_ms).split(' · ').slice(2).join(' · ')}</Text>
        {limitLine(r, nowMs, sent) !== null && <Text dimColor>{limitLine(r, nowMs, sent)}</Text>}
        {canContinue.has(r.sessionId) && <Button key={`continue-${r.sessionId}`} label="Continue" onPress={() => continueFromPane($, r.sessionId)} />}
      </Box>
    )
    return (
      <Box flexDirection="column">
        {head}
        {err !== '' && <Text color="red">{err}</Text>}
        <Text> </Text>
        <Text bold>Stalled ({g.stalled.length})</Text>
        {g.stalled.length === 0 && <Text dimColor>None.</Text>}
        {g.stalled.map(chatRow)}
        <Text> </Text>
        <Text bold>Waiting on you ({g.waiting.length})</Text>
        {g.waiting.length === 0 && <Text dimColor>None.</Text>}
        {g.waiting.map(chatRow)}
        <Text> </Text>
        <Text dimColor>
          {g.working.length} working · {g.done.length} done (collapsed)
        </Text>
      </Box>
    )
  })
}
