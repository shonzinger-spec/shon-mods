import type { Hook, Register } from 'claude-code'

import { DAY, GATE_MS, logSection, mergeCfg, parseRows, pickIdle, protectedCount, stillIdle, titleOf, wasSkipped, type Cfg, type Row } from './lib'

let started = false

type Ctx = Parameters<Hook<'turn.complete'>>[0]

const dir = async ($: Ctx) => `${(await $.env.get('HOME')) ?? ''}/.claude/mods-src/chat-tidy`

async function readText($: Ctx, path: string): Promise<string> {
  try {
    return String(await $.fs.read(path))
  } catch {
    return ''
  }
}

async function mkdirp($: Ctx, path: string): Promise<void> {
  await $.process.run(['mkdir', '-p', path.replace(/\/[^/]*$/, '')], { timeoutMs: 5000 })
}

async function appendRaw($: Ctx, path: string, text: string): Promise<void> {
  await $.process.run(
    ['/bin/sh', '-c', 'mkdir -p "$(dirname "$1")" && cat >> "$1"', 'sh', path],
    { stdin: text, timeoutMs: 5000 },
  )
}

async function loadCfg($: Ctx): Promise<Cfg> {
  let raw: Record<string, unknown> = {}
  try {
    raw = JSON.parse(await readText($, `${await dir($)}/config.json`))
  } catch {
    // defaults
  }
  const days = await $.store.get('idleDays').catch(() => undefined)
  return mergeCfg(typeof days === 'number' ? { ...raw, idleDays: days } : raw)
}

const textOf = (r: { content?: unknown }) => ((r.content ?? []) as { text?: string }[]).map(c => c.text ?? '').join('')

async function selfId($: Ctx): Promise<string | null> {
  try {
    const r = await $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: 'self' })
    const id = JSON.parse(textOf(r))?.sessionId
    return typeof id === 'string' && id ? id : null
  } catch {
    return null
  }
}

// Every chat, read-only from the app's own per-chat files (tools/scan_sessions.py).
// Falls back to the chat list tool, which only carries the newest ~40 chats.
async function allRows($: Ctx): Promise<Row[]> {
  try {
    const home = (await $.env.get('HOME')) ?? ''
    const r = await $.process.run(['/usr/bin/python3', '-I', `${home}/.claude/mods-src/chat-tidy/tools/scan_sessions.py`], { timeoutMs: 30_000 })
    if (r.exitCode === 0) {
      const rows = parseRows(r.stdout)
      if (rows.length) return rows
    }
  } catch {
    // fall through to the tool
  }
  return listRows($)
}

// The full list can be larger than one tool result may carry (169 chats came back
// as an "Error: result ... exceeds maximum allowed tokens" text). Ask for fewer:
// the list is newest first, so the oldest come into view as others get archived.
async function listRows($: Ctx): Promise<Row[]> {
  let last = 'no answer'
  for (const limit of [500, 120, 60]) {
    const r = await $.mcp.call('ccd_session_mgmt', 'list_sessions', { limit })
    const text = textOf(r)
    if ((r as { isError?: boolean }).isError || /^\s*Error\b/.test(text)) { last = text.slice(0, 120); continue }
    return parseRows(text)
  }
  throw new Error(`list_sessions refused every size: ${last}`)
}

// One run at a time across all open chats: mkdir is atomic. A lock older than 2 h is stale.
async function lock($: Ctx, D: string): Promise<boolean> {
  const r = await $.process.run(['/bin/sh', '-c',
    'L="$1/state/run.lock"; mkdir -p "$1/state"; if mkdir "$L" 2>/dev/null; then exit 0; fi; ' +
    'if [ $(( $(date +%s) - $(stat -f %m "$L") )) -gt 7200 ]; then rmdir "$L" && mkdir "$L" 2>/dev/null && exit 0; fi; exit 1', 'sh', D], { timeoutMs: 5000 })
  return r.exitCode === 0
}
const unlock = ($: Ctx, D: string) => $.process.run(['/bin/rmdir', `${D}/state/run.lock`], { timeoutMs: 5000 }).catch(() => undefined)

async function dryRun($: Ctx): Promise<string> {
  const cfg = await loadCfg($)
  const me = await selfId($)
  let rows: Row[]
  try {
    rows = await allRows($)
  } catch (err) {
    return `chat-tidy: cannot list chats (${String(err)})`
  }
  const picks = pickIdle(rows, await $.clock.now(), cfg, me ?? '')
  return [
    `Dry run (nothing touched, no backup). Idle limit ${cfg.idleDays} days, max ${cfg.maxPerRun} per run.`,
    picks.length ? 'Would archive:' : 'Nothing to archive.',
    ...picks.map(p => `  ${titleOf(p.row)} (${p.row.sessionId}, idle ${p.idleDays} d)`),
    `Protected: ${protectedCount(rows, picks)}`,
    me ? '' : 'Note: could not identify this chat; a real run would be skipped.',
  ].filter(Boolean).join('\n')
}

async function runTidy($: Ctx): Promise<string> {
  const D = await dir($)
  const home = (await $.env.get('HOME')) ?? ''
  const logPath = `${home}/second-brain/archive/chats/archive-log.md`
  const nowMs = await $.clock.now()
  const iso = new Date(nowMs).toISOString()
  const cfg = await loadCfg($)
  const runRow = (row: object) => appendRaw($, `${D}/state/runs.jsonl`, JSON.stringify({ ts: iso, ...row }) + '\n').catch(() => undefined)
  const writeLog = async (lines: string[]) => {
    const head = (await readText($, logPath)) ? '' : '# chat-tidy archive log\n'
    await appendRaw($, logPath, head + logSection(iso, lines)).catch(() => undefined)
  }

  const me = await selfId($)
  if (!me) {
    await runRow({ event: 'skipped-run', reason: 'self id unavailable' })
    return 'chat-tidy: could not identify this chat, run skipped.'
  }

  let backupOk = false
  let backupWhy = ''
  try {
    const b = await $.process.run(['/usr/bin/python3', `${home}/second-brain/archive/chats/tools/backup_raw.py`], { timeoutMs: 300_000 })
    backupOk = b.exitCode === 0
    backupWhy = `exit ${b.exitCode}: ${(b.stderr || b.stdout).trim().split('\n').slice(-2).join(' | ').slice(0, 300)}`
  } catch (err) {
    backupOk = false
    backupWhy = String(err).slice(0, 300)
  }
  if (!backupOk) {
    await runRow({ event: 'backup-failed', why: backupWhy })
    await writeLog(['- backup failed: nothing archived'])
    const msg = 'chat-tidy: backup failed, archived nothing.'
    $.ui.toast(msg, { timeoutMs: 15_000 })
    return msg
  }

  let rows: Row[]
  try {
    rows = await allRows($)
  } catch (err) {
    await runRow({ event: 'list-failed', error: String(err) })
    return 'chat-tidy: chat list unavailable, nothing archived.'
  }
  const picks = pickIdle(rows, nowMs, cfg, me)
  const lines: string[] = ['- backup: ok']
  let n = 0
  for (const p of picks) {
    const id = p.row.sessionId
    let skipped: boolean
    try {
      const g = await $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: id })
      if ((g as { isError?: boolean }).isError || !stillIdle(textOf(g), nowMs - cfg.idleDays * DAY)) throw new Error('not idle now')
      const r = await $.mcp.call('ccd_session_mgmt', 'archive_session', {
        session_id: id,
        reason: `chat-tidy: idle ${cfg.idleDays}+ days, backed up to second brain`,
      })
      skipped = wasSkipped((r as { isError?: boolean }).isError, textOf(r))
    } catch {
      skipped = true
    }
    if (!skipped) n++
    lines.push(`- ${skipped ? 'skipped' : 'archived'}: ${titleOf(p.row)} (${id}, idle ${p.idleDays} d)`)
    await runRow({ event: skipped ? 'skipped' : 'archived', sessionId: id, title: titleOf(p.row), idleDays: p.idleDays })
  }
  if (picks.length) await writeLog(lines)
  await runRow({ event: 'run', candidates: picks.length, archived: n })
  if (n > 0) $.ui.toast(`chat-tidy: archived ${n} idle chats (${cfg.idleDays}+ days); all backed up. Restore from the sidebar's Archived filter.`, { timeoutMs: 15_000 })
  return `chat-tidy: archived ${n} of ${picks.length} idle chats (${cfg.idleDays}+ days), backup ok.`
}

// Claim first (so parallel chats do not double-run), then run.
async function maybeRun($: Ctx): Promise<void> {
  const D = await dir($)
  const now = await $.clock.now()
  try {
    const last = JSON.parse(await readText($, `${D}/state/last-run.json`))?.at
    if (typeof last === 'number' && now - last < GATE_MS) return
  } catch {
    // missing or unreadable: run
  }
  if (!(await lock($, D))) return
  try {
    await mkdirp($, `${D}/state/last-run.json`)
    await $.fs.write(`${D}/state/last-run.json`, JSON.stringify({ at: now }))
    await runTidy($)
  } finally {
    await unlock($, D)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'tidy', description: 'Archive chats idle 14+ days (backed up first). /tidy = dry run, /tidy now, /tidy days <n>' })
      if (!started) {
        started = true
        $.clock.every(60 * 60_000, () => void maybeRun($).catch(() => undefined))
      }
      void maybeRun($).catch(() => undefined)
    } catch {
      // never throw out of a hook
    }
    return next(e)
  })

  on('command.run', { command: 'tidy' }, async ($, e) => {
    try {
      const args = e.args.trim()
      if (/^now\b/.test(args)) {
        const D = await dir($)
        if (!(await lock($, D))) return { text: 'chat-tidy: another chat is running a tidy right now; try again in a minute.' }
        try { return { text: await runTidy($) } } finally { await unlock($, D) }
      }
      const m = /^days\s+(\d+)\s*$/.exec(args)
      if (/^days\b/.test(args)) {
        const n = m ? Number(m[1]) : 0
        if (n < 3) return { text: 'chat-tidy: usage /tidy days <n>, n must be 3 or more.' }
        await $.store.set('idleDays', n)
        return { text: `chat-tidy: idle limit set to ${n} days.` }
      }
      return { text: await dryRun($) }
    } catch (err) {
      return { text: `chat-tidy: ${String(err)}` }
    }
  })
}

