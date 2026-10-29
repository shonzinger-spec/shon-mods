// Step 6: /conductor session (start_session from Shon's typed text only), the pane's lines, and the
// band's thread/held counts. Pure helpers; no `$` here.
import { threads, type BusRow } from './envelope.ts'
import type { RouteRow } from './ledger.ts'
import type { Routes } from './routes.ts'

export const PANE_ID = 'conductor'
export const PANE_TITLE = 'Conductor'
export type Tab = 'routes' | 'bus'

/** A thread with a row inside this window is open (the same window that makes a send a reply). */
const OPEN_MS = 30 * 60 * 1000
const TITLE_MAX = 60
const ABOVE_OPUS = new Set(['fable'])
const ABOVE_HIGH = new Set(['xhigh', 'max'])

export type SessionPlan = { ok: true; args: Record<string, unknown>; title: string } | { ok: false; text: string }

/**
 * `/conductor session <class> <text…>`: every argument comes from the typed command or the route;
 * `background` is fixed text naming only the class and its route.
 */
export function sessionPlan(routes: Routes | null, cls: string, text: string): SessionPlan {
  if (!routes) return { ok: false, text: 'conductor session: routes not loaded' }
  const names = Object.keys(routes.classes)
  if (!cls || !text) return { ok: false, text: `Usage: /conductor session <class> <text…> (classes: ${names.join(', ')})` }
  const r = routes.classes[cls]
  if (!r) return { ok: false, text: `conductor session: unknown class "${cls}" (classes: ${names.join(', ')})` }
  const target = r.model === 'inherit' ? 'inherit' : `${r.model}/${r.effort ?? '-'}`
  if (ABOVE_OPUS.has(r.model) || (r.effort !== undefined && ABOVE_HIGH.has(r.effort)))
    return { ok: false, text: `conductor session: ${cls} needs ${target}; start_session can only start at or below opus/high — run it as a subagent` }
  const title = text.slice(0, TITLE_MAX)
  const args: Record<string, unknown> = {
    initiation: 'user_asked',
    context: 'fresh',
    title,
    prompt: text,
    background: `Started by Shon with /conductor session ${cls} (route ${target}, mode ${r.mode}). The prompt is exactly what Shon typed; conductor added nothing from any message.`,
  }
  if (r.model !== 'inherit') {
    args.model = r.model
    if (r.effort !== undefined) args.effort = r.effort
  }
  return { ok: true, args, title }
}

export function contentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map(b => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : '')).join('\n')
}

export const localIds = (text: string) => [...new Set(text.match(/local_[A-Za-z0-9_-]+/g) ?? [])]

const cut = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1)}…`)

export function openThreads(rows: readonly BusRow[], now: number): number {
  let n = 0
  for (const list of threads(rows).values()) if (list.some(r => now - Date.parse(r.ts) <= OPEN_MS)) n += 1
  return n
}

export const heldCount = (rows: readonly BusRow[]) => rows.filter(r => r.type === 'held').length

export function routeLines(rows: readonly RouteRow[]): string[] {
  if (!rows.length) return ['no routed spawns this session']
  return rows.slice(-20).map(r => {
    const target = r.suggestedModel === 'inherit' ? 'inherit' : `${r.suggestedModel}/${r.suggestedEffort ?? '-'}`
    return `${cut(r.description, 40)} → ${r.cls} ${target} · ${r.applied ? 'applied' : 'suggested'}${r.escalated ? ' · escalated' : ''}`
  })
}

export function busLines(rows: readonly BusRow[]): string[] {
  const out: string[] = []
  for (const [root, list] of threads(rows)) {
    out.push(`thread ${root} (${list.length})`)
    for (const r of list) out.push(r.type === 'send' ? `  → ${r.to ?? '?'} hop ${r.hop ?? '-'}: ${cut(r.text ?? '', 80)}` : `  ← ${r.from ?? '?'} hop ${r.hop ?? '-'}: ${cut(r.text ?? '', 80)}`)
  }
  for (const r of rows) if (r.type === 'held') out.push(`held: ${r.reason ?? '?'} — ${cut(r.text ?? '', 80)}`)
  for (const r of rows) if (r.type === 'flag') out.push(`flagged: ${r.to ?? '?'} — ${r.reason ?? ''}`)
  return out.length ? out : ['no bus traffic this session']
}
