import type { EngineInterface, Register } from 'claude-code'

import { line, type Verdict } from './lib'
import { parseCosts, parseJson, parsePolicy, variantsTried } from './policy'

let isTicking = false

async function readOr($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

// Every draw re-reads the verdict, the policy, the measured costs and the ledger, so a policy change
// or a hand-edited verdict.json shows on the next draw; nothing in the verdict file decides what shows.
async function refresh($: EngineInterface): Promise<void> {
  try {
    const home = (await $.env.get('HOME')) ?? ''
    const text = await readOr($, (await $.env.get('VERDICT_PATH')) ?? `${home}/.claude/verdict/latest.json`)
    let v: Verdict | null = null
    try {
      v = text === null ? null : (parseJson(text) as Verdict)
    } catch {
      v = null // half-written or broken file
    }
    let shown: string | undefined
    if (v && typeof v === 'object') {
      const policy = parsePolicy(await readOr($, (await $.env.get('VERDICT_POLICY')) ?? `${home}/.claude/verdict/policy.json`))
      const costs = parseCosts(await readOr($, (await $.env.get('VERDICT_COSTS')) ?? `${home}/.claude/mods-src/bad-data/bad-data.json`))
      const ledger = await readOr($, (await $.env.get('VERDICT_LEDGER')) ?? `${home}/Trading/_ledger/experiments.jsonl`)
      shown = line(v, await $.clock.now(), { policy, costs, variantsTried: variantsTried(policy, ledger, v.idea, v.variant) })
    }
    $.ui.status(shown)
  } catch {
    // a status line must never break a turn
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    if (!isTicking) {
      isTicking = true
      await $.clock.every(30000, () => void refresh($))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  }).catch(($, e, next) => next(e))
}
