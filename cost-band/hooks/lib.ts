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

/** Auto-handoff cap in USD (`handoff_usd`, default 20); 0 or negative disables, non-numbers fall back to 20. */
export function handoffCapOf(options: Readonly<Record<string, unknown>> | undefined): number {
  const v = options?.handoff_usd
  return typeof v === 'number' && Number.isFinite(v) ? v : 20
}

/** Auto-handoff is on unless `auto_handoff` is exactly false. */
export function autoHandoffOf(options: Readonly<Record<string, unknown>> | undefined): boolean {
  return options?.auto_handoff !== false
}

/** True once, at or over a positive cap, when no handoff was sent for this conversation yet. */
export function shouldHandoff(usd: number | undefined, cap: number, alreadySent: boolean): boolean {
  return !alreadySent && typeof usd === 'number' && Number.isFinite(usd) && cap > 0 && usd >= cap
}

/** The prompt submitted when the cap is hit: handoff, then a fresh chat (or a resume line), then stop. */
export function costHandoffPrompt(usd: number, cap: number): string {
  return [
    `[cost-band] This chat has cost ${usdText(usd)}, at or over the ${limitText(cap)} cap. Stop the current work and hand off. If a handoff for this conversation already exists in it, reuse that file instead of writing another.`,
    '1. Write the handoff. Use the context-handoff:handoff-save skill if it is available; otherwise save it as ~/.claude/handoffs/<YYYY-MM-DD>-<short-topic>.md when the working directory is the home folder, or as HANDOFF.md in the working directory (update it if it exists). Sections: Goal, Done (each item with its evidence: file path, command run, result), Remaining, Key decisions and why, Failed approaches (do not retry), Next steps, Blockers. Only write what a tool result in this chat shows; mark anything else UNVERIFIED.',
    '2. Offer a fresh chat. If the mcp__ccd_session__start_session tool exists (Claude Desktop), call it once with initiation "own_initiative", context "fresh", a short title, a prompt that tells the new chat to read the handoff file and continue from Next steps, and a background of at least 80 characters saying why the chat was split (cost cap) and where the handoff file is. The user clicks the card once to start it. If the tool does not exist, end with one line to paste into a new session that points at the handoff file.',
    '3. Then stop. Do not continue the task in this chat; tell me to carry on in the new chat.',
    'Keep tool calls few and output short.',
  ].join('\n')
}
