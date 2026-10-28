// Pure logic for cost-band: no engine calls here.

export type Tokens = {
  input_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** cache_read / (cache_read + cache_creation + input); null when the denominator is 0 or no reading. */
export function cacheRatio(t: Tokens | null | undefined): number | null {
  if (!t) return null
  const den = (t.cache_read_input_tokens || 0) + (t.cache_creation_input_tokens || 0) + (t.input_tokens || 0)
  return den > 0 ? (t.cache_read_input_tokens || 0) / den : null
}

export function cacheText(ratio: number | null): string {
  return ratio === null ? 'cache –' : `cache ${Math.round(ratio * 100)}%`
}

export function usdText(usd: number | undefined): string {
  return typeof usd === 'number' && Number.isFinite(usd) ? `$${usd.toFixed(2)}` : '$?'
}

/** "$12.34 · cache 87%" */
export function statusText(usd: number | undefined, ratio: number | null): string {
  return `${usdText(usd)} · ${cacheText(ratio)}`
}

export type Level = 'amber' | 'red'

/**
 * red at >= limit; amber at >= nudge when 0 < nudge < limit, else at >= 80% of the limit;
 * null below, or with no cost or no positive limit.
 */
export function bandLevel(usd: number | undefined, limit: number, nudge = 0): Level | null {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || !(limit > 0)) return null
  if (usd >= limit) return 'red'
  const amberAt = nudge > 0 && nudge < limit ? nudge : 0.8 * limit
  if (usd >= amberAt) return 'amber'
  return null
}

function limitText(limit: number): string {
  return Number.isInteger(limit) ? `$${limit}` : `$${limit.toFixed(2)}`
}

const NUDGE = 'start a new session (save a handoff first)'

/** "Session $16.20 of $20 limit (81%) · cache 87% · start a new session (save a handoff first)" */
export function bandText(usd: number, limit: number, ratio: number | null): string {
  const pct = Math.round((usd / limit) * 100)
  const over = usd >= limit ? ' · over limit' : ''
  return `Session ${usdText(usd)} of ${limitText(limit)} limit (${pct}%)${over} · ${cacheText(ratio)} · ${NUDGE}`
}

/** The one-time toast when the session first reaches a level. */
export function toastText(level: Level, usd: number, limit: number): string {
  return level === 'red'
    ? `cost-band: session at ${usdText(usd)}, at or over the ${limitText(limit)} limit — ${NUDGE}`
    : `cost-band: session at ${usdText(usd)} — ${NUDGE}`
}

export function limitOf(options: Readonly<Record<string, unknown>> | undefined): number {
  const v = options?.limit_usd
  return typeof v === 'number' && v > 0 ? v : 20
}

export function nudgeOf(options: Readonly<Record<string, unknown>> | undefined): number {
  const v = options?.nudge_usd
  return typeof v === 'number' && v > 0 ? v : 15
}
