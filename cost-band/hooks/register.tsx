import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  autoHandoffOf,
  bandLevel,
  bandText,
  cacheRatio,
  costHandoffPrompt,
  handoffCapOf,
  limitOf,
  nudgeOf,
  shouldHandoff,
  statusText,
  toastText,
  usdText,
  type Level,
} from './lib.ts'

const snap = atom({ plugin: 'cost-band', key: 'snap' } as const, null)
const EVERY_MS = 60 * 1000

let isTicking = false

// Levels already toasted this conversation (each fires once), and the configured thresholds.
type Cfg = {
  limit: number
  nudge: number
  toasted: Set<Level>
  handoffCap: number
  autoHandoff: boolean
  handedOff: boolean
}

// Cost is the engine's own ledger (`cost.usd`, what /cost totals, the field session-health
// reads). The cache ratio is over the live window's last API response (`apiUsage`);
// `breakdown: 'summary'` estimates locally and sends no request.
async function refresh($: EngineInterface, cfg: Cfg): Promise<number | undefined> {
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    const usd = u.cost?.usd
    const ratio = cacheRatio(u.context.breakdown?.apiUsage)
    await update($, snap, () => ({ usd, ratio }))
    $.ui.status(statusText(usd, ratio))
    const level = bandLevel(usd, cfg.limit, cfg.nudge)
    if (level && typeof usd === 'number' && !cfg.toasted.has(level)) {
      cfg.toasted.add(level)
      if (level === 'red') cfg.toasted.add('amber')
      $.ui.toast(toastText(level, usd, cfg.limit))
    }
    return usd
  } catch {
    // never let a usage read break the session
    return undefined
  }
}

async function start($: EngineInterface, cfg: Cfg): Promise<void> {
  if (isTicking) return
  isTicking = true
  await $.clock.after(50, () => void refresh($, cfg))
  await $.clock.every(EVERY_MS, () => void refresh($, cfg))
}

export const register: Register = (on, options) => {
  const cfg: Cfg = {
    limit: limitOf(options),
    nudge: nudgeOf(options),
    toasted: new Set(),
    handoffCap: handoffCapOf(options),
    autoHandoff: autoHandoffOf(options),
    handedOff: false,
  }
  const { limit, nudge } = cfg

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await start($, cfg)
    return r
  }).catch(($, e, next) => next(e))

  // A /clear ends this conversation without a new session.start: the next one
  // toasts each level again. Any session end (clear, resume) starts the count over.
  on('session.end', async ($, e, next) => {
    cfg.toasted.clear()
    cfg.handedOff = false
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const usd = await refresh($, cfg)
    // Main loop, answered turns only (an Esc or an error must not start a paid turn), never from the 60 s timer: a prompt submitted here runs as its own turn after this one.
    if (e.agentId === undefined && e.reason === 'answer' && cfg.autoHandoff && shouldHandoff(usd, cfg.handoffCap, cfg.handedOff) && usd !== undefined) {
      cfg.handedOff = true
      // the red toast at the limit already says it; only a separate cap needs its own
      if (!cfg.toasted.has('red')) {
        $.ui.toast(`cost-band: session at ${usdText(usd)}, over the $${cfg.handoffCap} handoff cap — writing a handoff`)
      }
      void $.prompt.submit({ text: costHandoffPrompt(usd, cfg.handoffCap) }).catch(() => {
        cfg.handedOff = false
      })
    }
    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    const level = s ? bandLevel(s.usd, limit, nudge) : null
    if (e.props.hasSurvey || !s || !level || typeof s.usd !== 'number') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // draw above whatever the rest of the chain draws, so the bands beneath (health-band) still show
    const below = await next(e)
    return (
      <Box flexDirection="column">
        <Text color={level === 'red' ? 'red' : 'yellow'}>{bandText(s.usd, limit, s.ratio)}</Text>
        {below}
      </Box>
    )
  })
}
