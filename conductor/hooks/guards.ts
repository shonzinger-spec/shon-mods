// Step 5: send and receive guards (SPEC §5), pure over a GuardState the bus hooks own.
// Send guards refuse a send with a reason; receive guards hold (drop) a peer delivery.
// Receive guards never read the envelope: they count every peer delivery, header or not.

export const MIN = 60 * 1000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR

export const LIMITS = {
  maxHop: 4,
  perTarget: 6,
  perTargetWindowMs: 10 * MIN,
  pauseMs: 5 * MIN,
  sendsPerHour: 20,
  peerPerHour: 10,
  peerPerDay: 40,
  peerUsdPerDay: 25,
} as const

/** Modes that act without asking: a send there needs Shon's `/conductor ask`. */
export const UNATTENDED_MODES = new Set(['auto', 'bypassPermissions'])

export type GuardState = {
  /** Accepted sends: time and target. */
  sends: { ts: number; to: string }[]
  /** Last accepted text per target (duplicate guard). */
  lastText: Map<string, string>
  /** Per target: a send refused by the per-target cap pauses the target until this time. */
  pausedUntil: Map<string, number>
  /** Per target: sends before this time no longer count toward the per-target cap (a pause resets it). */
  windowStart: Map<string, number>
  /** Peer deliveries that counted (and wakeups), by time. */
  peer: number[]
  /** Spend of turns started by peer messages or wakeups. */
  spend: { ts: number; usd: number }[]
}

export function freshGuards(): GuardState {
  return { sends: [], lastText: new Map(), pausedUntil: new Map(), windowStart: new Map(), peer: [], spend: [] }
}

export type SendCheck = {
  to: string
  text: string
  /** The hop this send would carry. */
  hop: number
  now: number
  isSelf: boolean
  /** The target's permission mode when this session started it; undefined when unknown. */
  mode?: string
  /** Shon typed `/conductor ask` (one send). */
  ask: boolean
}

const norm = (t: string) => t.trim().replace(/\s+/g, ' ')

/** null when the send may go; else the refusal reason. Mutates only the pause bookkeeping. */
export function checkSend(st: GuardState, c: SendCheck): string | null {
  if (c.isSelf) return 'a session cannot message itself'
  if (c.mode !== undefined && UNATTENDED_MODES.has(c.mode) && !c.ask)
    return `the target runs in ${c.mode} mode; Shon must type /conductor ask first`
  if (c.hop > LIMITS.maxHop) return `thread reached ${LIMITS.maxHop} hops; start a new thread or ask Shon`
  if (st.lastText.get(c.to) === norm(c.text)) return 'the same text was just sent to this target'
  const paused = st.pausedUntil.get(c.to) ?? 0
  if (c.now < paused) return `sends to ${c.to} are paused for ${Math.ceil((paused - c.now) / 1000)}s`
  const since = Math.max(c.now - LIMITS.perTargetWindowMs, st.windowStart.get(c.to) ?? 0)
  const toTarget = st.sends.filter(s => s.to === c.to && s.ts > since).length
  if (toTarget >= LIMITS.perTarget) {
    const until = c.now + LIMITS.pauseMs
    st.pausedUntil.set(c.to, until)
    st.windowStart.set(c.to, until)
    return `more than ${LIMITS.perTarget} sends to ${c.to} in 10 minutes; paused 5 minutes`
  }
  const hour = st.sends.filter(s => s.ts > c.now - HOUR).length
  if (hour >= LIMITS.sendsPerHour) return `more than ${LIMITS.sendsPerHour} sends this hour`
  return null
}

export function recordSend(st: GuardState, to: string, text: string, now: number): void {
  st.sends.push({ ts: now, to })
  st.lastText.set(to, norm(text))
  prune(st, now)
}

/** null when a peer delivery may be queued; else why it is held. */
export function checkReceive(st: GuardState, now: number): string | null {
  prune(st, now)
  const hour = st.peer.filter(t => t > now - HOUR).length
  if (hour >= LIMITS.peerPerHour) return `more than ${LIMITS.peerPerHour} peer messages this hour`
  if (st.peer.length >= LIMITS.peerPerDay) return `more than ${LIMITS.peerPerDay} peer messages today`
  const usd = st.spend.reduce((n, s) => n + s.usd, 0)
  if (usd >= LIMITS.peerUsdPerDay) return `peer-started turns spent $${usd.toFixed(2)} today (cap $${LIMITS.peerUsdPerDay})`
  return null
}

function prune(st: GuardState, now: number): void {
  const day = now - DAY
  st.peer = st.peer.filter(t => t > day)
  st.spend = st.spend.filter(s => s.ts > day)
  st.sends = st.sends.filter(s => s.ts > now - HOUR)
}

// Prices as frugal's stats.py has them (the same table step 4's parity check prices with):
// substring match on the model id, first hit wins; $/MTok (input, output); cache read 0.1x, write 1.25x input.
const PRICES: [string, number, number][] = [
  ['haiku', 1, 5],
  ['sonnet-5', 2, 10],
  ['sonnet', 3, 15],
  ['opus-5-5', 4, 20],
  ['opus', 5, 25],
  ['fable', 10, 50],
]

export type StepUsage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }

export function costUsd(model: string | undefined, u: StepUsage): number {
  const hit = PRICES.find(([needle]) => (model ?? '').includes(needle)) ?? PRICES[PRICES.length - 1]
  const [, pin, pout] = hit
  return (
    ((u.input_tokens ?? 0) * pin +
      (u.output_tokens ?? 0) * pout +
      (u.cache_read_input_tokens ?? 0) * pin * 0.1 +
      (u.cache_creation_input_tokens ?? 0) * pin * 1.25) /
    1_000_000
  )
}
