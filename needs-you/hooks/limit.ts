import type { ChatRow, Scan, SentLog } from '../types'

// What is sent to a chat that was cut off by the usage limit. Never the original prompt:
// the interrupted turn may already have run tools, so a literal re-send repeats side effects.
export const CONTINUE_MESSAGE =
  'Your last turn was cut off by the usage limit. Continue from where you left off; check state before repeating any step.'

export const GRACE_MS = 5 * 60_000
// Auto mode never resumes a stall whose reset passed longer ago than this: old context is stale.
export const AUTO_MAX_AGE_MS = 6 * 60 * 60_000
// Same slack classify.py uses between errorAt and lastActivityAt.
const ACTIVITY_SLACK_MS = 10_000

export const sentKey = (r: Pick<ChatRow, 'sessionId' | 'error_at_ms'>): string => `${r.sessionId}:${r.error_at_ms}`

export function parseSent(text: string): SentLog {
  try {
    const d = JSON.parse(text) as unknown
    if (!d || typeof d !== 'object' || Array.isArray(d)) return {}
    return Object.fromEntries(Object.entries(d as Record<string, unknown>).filter(([, v]) => typeof v === 'number')) as SentLog
  } catch {
    return {}
  }
}

// A chat stalled by a usage limit whose reset time is known and whose error is the newest thing in it.
function limited(r: ChatRow, exclude: string | null): r is ChatRow & { error_at_ms: number; limit: { kind: 'session' | 'weekly' | 'rate'; reset_at_ms: number } } {
  return (
    r.sessionId !== exclude &&
    r.status === 'stalled' &&
    r.kind === 'limit' &&
    typeof r.error_at_ms === 'number' &&
    typeof r.limit?.reset_at_ms === 'number' &&
    (r.last_activity_ms === null || r.last_activity_ms <= r.error_at_ms + ACTIVITY_SLACK_MS)
  )
}

// Reset has passed and nothing was sent for this error yet: what the pane offers a Continue button for.
export function resumable(scan: Scan, sent: SentLog, exclude: string | null = null): ChatRow[] {
  return scan.rows
    .filter(r => limited(r, exclude) && scan.now_ms >= (r.limit?.reset_at_ms ?? Infinity) && !(sentKey(r) in sent))
    .sort((a, b) => (a.last_activity_ms ?? 0) - (b.last_activity_ms ?? 0))
}

// Rows the automatic mode may act on: resumable plus the grace period after the reset.
// Running, archived and routine chats never reach here (the scanner leaves them out or marks them working).
export function due(scan: Scan, sent: SentLog, exclude: string | null = null): ChatRow[] {
  return resumable(scan, sent, exclude).filter(r => {
    const reset = r.limit?.reset_at_ms ?? Infinity
    return scan.now_ms >= reset + GRACE_MS && scan.now_ms - reset <= AUTO_MAX_AGE_MS
  })
}

// send_message ends its result with "(delivery: <word>; message_id: ...)". Only delivered
// (turn started) and queued (runs when the chat's current work finishes) count as sent.
export function delivered(text: string): boolean {
  const tags = [...text.matchAll(/\(\s*delivery\s*:\s*([A-Za-z_-]+)/gi)]
  const w = tags.at(-1)?.[1]?.toLowerCase()
  return w === 'delivered' || w === 'queued'
}

// The get_session answer right before a send: still the same stall, nobody is in the chat.
export function stillIdle(text: string, r: ChatRow): boolean {
  try {
    const d = JSON.parse(text) as { isRunning?: unknown; isArchived?: unknown; errorAt?: unknown }
    if (!d || typeof d !== 'object') return false
    if (d.isRunning === true || d.isArchived === true) return false
    if (typeof d.errorAt === 'number' && d.errorAt !== r.error_at_ms) return false
    return true
  } catch {
    return false
  }
}

export function resetText(ms: number, nowMs: number): string {
  const d = new Date(ms)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const sameDay = new Date(nowMs).toDateString() === d.toDateString()
  return sameDay ? time : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`
}

// One line for a limit-stalled row: when it resets, or that it can continue now.
export function limitLine(r: ChatRow, nowMs: number, sent: SentLog): string | null {
  if (r.kind !== 'limit') return null
  const reset = r.limit?.reset_at_ms
  if (typeof reset !== 'number') return 'reset time not found'
  if (sentKey(r) in sent) return 'continue message sent'
  return nowMs >= reset ? `reset at ${resetText(reset, nowMs)}, ready to continue` : `resets ${resetText(reset, nowMs)}`
}

export type AutoCmd = { kind: 'auto'; on: boolean } | { kind: 'auto-status' } | { kind: 'resume'; n: number | null } | { kind: 'none' }

export function parseCommand(args: string): AutoCmd {
  const a = args.trim()
  const m = /^auto\s+(on|off)$/i.exec(a)
  if (m) return { kind: 'auto', on: m[1]!.toLowerCase() === 'on' }
  if (/^auto$/i.test(a)) return { kind: 'auto-status' }
  const r = /^resume(?:\s+(\d+))?$/i.exec(a)
  if (r) return { kind: 'resume', n: r[1] ? Number(r[1]) : null }
  return { kind: 'none' }
}
