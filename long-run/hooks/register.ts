import type { EngineInterface, Hook, Register } from 'claude-code'

import { backgroundId, denyText, durKey, isBacktest, LONG_MS, namedIds, notifyText, nudgeText, quickRun, reportsFailure, runDir, signature, type Pending } from './lib'

const PENDING = 'pending'

async function pending($: EngineInterface): Promise<Pending> {
  const v = await $.store.get(PENDING)
  return v && typeof v === 'object' ? (v as Pending) : {}
}

async function remember($: EngineInterface, id: string, sig: string, key: string, startedAt: number): Promise<void> {
  const p = await pending($)
  p[id] = { sig, key, startedAt }
  await $.store.set(PENDING, p)
}

// Store key for this command: its run directory plus its signature. An engine
// call that fails leaves that part empty rather than skipping the guard.
async function keyOf($: EngineInterface, cmd: string, sig: string): Promise<string> {
  let cwd = ''
  let home = ''
  try {
    cwd = (await $.session.cwd()) || ''
  } catch {}
  try {
    home = (await $.env.get('HOME')) ?? ''
  } catch {}
  return durKey(runDir(cmd, cwd, home), sig)
}

const guard: Hook<'tool.call'> = async ($, e, next) => {
  if (e.tool !== 'Bash') return next(e)
  const sig = signature(e.command)
  if (!isBacktest(sig)) return next(e)
  if (quickRun(e.command)) return next(e)
  const key = await keyOf($, e.command, sig)

  if (e.run_in_background !== true) {
    const last = (await $.store.get(key)) as { ms?: number } | undefined
    if (typeof last?.ms === 'number' && last.ms >= LONG_MS) return { deny: denyText(sig, last.ms) }
  }

  const start = await $.clock.now()
  const r = await next(e)
  // The command has run: from here nothing may throw into the .catch below,
  // which would call next (run the command) a second time.
  try {
    return await afterRun($, e.run_in_background === true, sig, key, r, start)
  } catch {
    return r
  }
}

type Result = Awaited<ReturnType<Parameters<Hook<'tool.call'>>[2]>>

// The Bash result's timedOutAfterMs: set when the command hit its timeout and
// the engine moved it to the background.
function timedOutMs(r: Result): number {
  const v = 'result' in r ? (r.result as { timedOutAfterMs?: unknown } | undefined)?.timedOutAfterMs : undefined
  return typeof v === 'number' ? v : 0
}

async function afterRun($: EngineInterface, isBackground: boolean, sig: string, key: string, r: Result, start: number): Promise<Result> {
  if (r.deny !== undefined) return r
  const end = await $.clock.now()

  // Started in the background, or moved there (timeout, Ctrl+B): wait for its notification.
  const id = 'result' in r ? backgroundId(r.result, r.text) : null
  if (isBackground || id) {
    if (id) await remember($, id, sig, key, start)
    // Moved off the foreground (its timeout, which defaults to 120 s, or
    // Ctrl+B) after 2+ minutes: it is long already, so keep that now and the
    // next foreground run is refused; the finish notification stores the total.
    const ms = Math.max(end - start, timedOutMs(r))
    if (!isBackground && ms >= LONG_MS) await $.store.set(key, { ms, at: end })
    return r
  }

  // Completed in the foreground. A long run is always kept; a short one replaces
  // the history only when it succeeded, so a quick crash does not clear it.
  const ms = end - start
  if (ms < LONG_MS) {
    if (!r.isError) await $.store.set(key, { ms, at: end })
    return r
  }
  await $.store.set(key, { ms, at: end })
  $.ui.notify(notifyText(sig, ms))
  if (r.isError) return r
  return { ...r, context: [...(r.context ?? []), nudgeText(sig, ms)] }
}

const watch: Hook<'prompt.submit'> = async ($, e, next) => {
  if (e.origin?.kind === 'task-notification') {
    const p = await pending($)
    const ids = namedIds(e.text, p)
    if (ids.length) {
      const now = await $.clock.now()
      for (const id of ids) {
        const { sig, key, startedAt } = p[id]!
        const ms = now - startedAt
        $.ui.notify(notifyText(sig, ms))
        // The finished run's real length replaces the history, so a run that
        // got quicker lifts the refusal; a quick failure leaves it in place.
        if (key && (ms >= LONG_MS || !reportsFailure(e.text))) await $.store.set(key, { ms, at: now })
        delete p[id]
      }
      await $.store.set(PENDING, p)
    }
  }
  return next(e)
}

export const register: Register = on => {
  // A failure in this mod must never touch the tool call or the prompt.
  on('tool.call', guard).catch(($, e, next) => next(e))
  on('prompt.submit', watch).catch(($, e, next) => next(e))
}
