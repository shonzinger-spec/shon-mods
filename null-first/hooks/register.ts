import type { EngineInterface, Register } from 'claude-code'

import { nullsText, seenKey, toastFor } from './lib'
import { parsePolicy } from './policy'

const SEEN = 'seen' // $.store key: keys of verdicts already looked at, newest last
const SEEN_MAX = 200
let isTicking = false
let isChecking = false

async function readOr($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function paths($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  return {
    latest: (await $.env.get('VERDICT_PATH')) ?? `${home}/.claude/verdict/latest.json`,
    policy: (await $.env.get('VERDICT_POLICY')) ?? `${home}/.claude/verdict/policy.json`,
    ledger: (await $.env.get('VERDICT_LEDGER')) ?? `${home}/Trading/_ledger/experiments.jsonl`,
  }
}

// Read latest.json as verdict-line does (session start, every turn, every 30 s) and toast once per verdict
// (idea, variant, written_at) whose null did not run or did not lose. The key is kept in $.store, so the same
// verdict never toasts again, in this session or the next. The policy switch plays no part here.
async function check($: EngineInterface): Promise<void> {
  if (isChecking) return
  isChecking = true
  try {
    const text = await readOr($, (await paths($)).latest)
    if (text === null) return
    let v: unknown
    try {
      v = JSON.parse(text)
    } catch {
      return // half-written file: the next look gets it
    }
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return
    const key = seenKey(v as Record<string, unknown>)
    const stored = await $.store.get(SEEN)
    const seen = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : []
    if (seen.includes(key)) return
    await $.store.set(SEEN, [...seen, key].slice(-SEEN_MAX))
    const t = toastFor(v, await $.clock.now())
    if (t) $.ui.toast(t)
  } catch {
    // a watcher must never break a turn
  } finally {
    isChecking = false
  }
}

async function nulls($: EngineInterface, args: string): Promise<string> {
  const p = await paths($)
  const policy = parsePolicy(await readOr($, p.policy)) as { rules?: Record<string, unknown> }
  return nullsText(
    {
      ledger: await readOr($, p.ledger),
      ledgerPath: p.ledger,
      latest: await readOr($, p.latest),
      latestPath: p.latest,
      ruleOn: typeof policy.rules === 'object' && policy.rules !== null && policy.rules.null_first === true,
    },
    args,
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'nulls', description: 'null-first: ledger rows with their null test and whether it lost, e.g. /nulls or /nulls <idea>' })
    await check($)
    if (!isTicking) {
      isTicking = true
      await $.clock.every(30000, () => void check($))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await check($)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'nulls' }, async ($, e) => {
    try {
      return { text: await nulls($, e.args) }
    } catch (err) {
      return { text: `null-first: could not read the ledger (${String(err).slice(0, 200)})` }
    }
  })
}
