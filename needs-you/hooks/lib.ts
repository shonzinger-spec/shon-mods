import type { ChatRow, Scan } from '../types'

const MIN = 60_000

export function parseScan(stdout: string): Scan | null {
  try {
    const d = JSON.parse(stdout) as { now_ms?: unknown; rows?: unknown }
    if (typeof d.now_ms !== 'number' || !Array.isArray(d.rows)) return null
    const rows = (d.rows as Partial<ChatRow>[]).filter(r => r && typeof r.sessionId === 'string' && typeof r.status === 'string') as ChatRow[]
    return { now_ms: d.now_ms, rows }
  } catch {
    return null
  }
}

// ids of chats the app says are running right now, from the list_sessions answer text.
export function runningIds(text: string): string[] {
  try {
    const d = JSON.parse(text) as unknown
    const arr = Array.isArray(d) ? d : (d as { sessions?: unknown })?.sessions
    if (!Array.isArray(arr)) return []
    return arr.filter(s => s && s.isRunning === true && typeof s.sessionId === 'string').map(s => s.sessionId as string)
  } catch {
    return []
  }
}

export function ageText(nowMs: number, thenMs: number | null): string {
  if (thenMs === null) return '?'
  const m = Math.max(0, Math.floor((nowMs - thenMs) / MIN))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`
}

export type Groups = { stalled: ChatRow[]; waiting: ChatRow[]; working: ChatRow[]; done: ChatRow[] }

// Stalled first, then waiting; inside a group the chat idle longest comes first.
export function group(scan: Scan, exclude: string | null = null): Groups {
  const g: Groups = { stalled: [], waiting: [], working: [], done: [] }
  for (const r of scan.rows) {
    if (r.sessionId === exclude) continue
    if (r.status in g) g[r.status as keyof Groups].push(r)
  }
  for (const k of Object.keys(g) as (keyof Groups)[]) g[k].sort((a, b) => (a.last_activity_ms ?? 0) - (b.last_activity_ms ?? 0))
  return g
}

export function statusText(g: Groups): string | undefined {
  const parts: string[] = []
  if (g.waiting.length) parts.push(`${g.waiting.length} waiting`)
  if (g.stalled.length) parts.push(`${g.stalled.length} stalled`)
  return parts.length ? parts.join(', ') : undefined
}

const KIND: Record<string, string> = {
  limit: 'hit a usage limit',
  error: 'ended with an error',
  unanswered: 'your last message got no reply',
}

export function why(r: ChatRow): string {
  if (r.status === 'stalled') {
    const base = KIND[r.kind ?? ''] ?? 'stalled'
    return r.kind === 'limit' && r.error ? `${base}: ${r.error}` : base
  }
  if (r.status === 'waiting') {
    if (!r.question) return 'waiting on you (question not found)'
    return r.question_source === 'summary' ? `${r.question} (app summary, not verbatim)` : r.question
  }
  return ''
}

export function rowLine(r: ChatRow, nowMs: number): string {
  return `${r.title} · ${ageText(nowMs, r.last_activity_ms)} · ${why(r)}`
}

// The same list as plain text: the answer to /needs-you when no pane is drawn.
export function listText(scan: Scan, exclude: string | null = null): string {
  const g = group(scan, exclude)
  const out: string[] = [`${g.stalled.length} stalled, ${g.waiting.length} waiting, ${g.working.length} working, ${g.done.length} done`]
  if (g.stalled.length) out.push('', 'Stalled', ...g.stalled.map(r => `- ${rowLine(r, scan.now_ms)} [#${r.sessionId}]`))
  if (g.waiting.length) out.push('', 'Waiting on you', ...g.waiting.map(r => `- ${rowLine(r, scan.now_ms)} [#${r.sessionId}]`))
  return out.join('\n')
}
