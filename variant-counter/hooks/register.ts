import type { EngineInterface, Register } from 'claude-code'

import { ideaText, limitsOf, listText, missingText, rows, toastFor } from './lib'
import { parseJson, parsePolicy } from './policy'

const STORE_KEY = 'toasted' // keys of verdicts already toasted, kept between sessions
const KEEP = 500
let isTicking = false
let isChecking = false

async function readOr($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

// The same files verdict-line and verdict.py read, with the same env overrides.
async function paths($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  return {
    verdict: (await $.env.get('VERDICT_PATH')) ?? `${home}/.claude/verdict/latest.json`,
    policy: (await $.env.get('VERDICT_POLICY')) ?? `${home}/.claude/verdict/policy.json`,
    ledger: (await $.env.get('VERDICT_LEDGER')) ?? `${home}/Trading/_ledger/experiments.jsonl`,
  }
}

// Read latest.json as verdict-line does (every draw: session start, a 30 s tick, each turn end) and
// toast once per (idea, variant, written_at) whose idea is over variant_limit, policy switch or not.
async function check($: EngineInterface): Promise<void> {
  if (isChecking) return // the tick and a turn end can overlap; the next one catches up
  isChecking = true
  try {
    const p = await paths($)
    const text = await readOr($, p.verdict)
    if (text === null) return
    let v: unknown
    try {
      v = parseJson(text) // Python's json writes bare Infinity/NaN (pf with no losers, t with std 0)
    } catch {
      return // half-written file: the next read gets it
    }
    const lim = limitsOf(parsePolicy(await readOr($, p.policy)))
    const t = toastFor(v, await readOr($, p.ledger), lim, await $.clock.now())
    if (!t) return
    const raw = await $.store.get(STORE_KEY)
    const done = Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []
    if (done.includes(t.key)) return
    await $.store.set(STORE_KEY, [...done, t.key].slice(-KEEP))
    $.ui.toast(t.text)
  } catch {
    // a toast must never break a turn
  } finally {
    isChecking = false
  }
}

async function command($: EngineInterface, args: string): Promise<string> {
  const p = await paths($)
  const ledger = await readOr($, p.ledger)
  if (ledger === null) return missingText(p.ledger)
  const lim = limitsOf(parsePolicy(await readOr($, p.policy)))
  const all = rows(ledger)
  const q = args.trim()
  return q ? ideaText(all, q, lim, p.ledger) : listText(all, lim, p.ledger)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'variants', description: 'variant-counter: ideas by distinct variants tried; /variants <idea> lists its variants' })
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

  on('command.run', { command: 'variants' }, async ($, e) => ({ text: await command($, e.args) }))
}
