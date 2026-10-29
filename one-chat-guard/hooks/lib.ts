import type { Candidate } from '../types'

export type Cfg = { enabled: boolean; minJaccard: number; ignoreTitles: string[] }

export function mergeCfg(raw: unknown): Cfg {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const j = typeof r.minJaccard === 'number' && r.minJaccard > 0 && r.minJaccard <= 1 ? r.minJaccard : 0.55
  const ignore = Array.isArray(r.ignoreTitles) ? r.ignoreTitles.filter((t): t is string => typeof t === 'string') : ['New chat']
  return { enabled: r.enabled !== false, minJaccard: j, ignoreTitles: ignore }
}

// Same normalisation as tools/match.py norm_title: case-folded, leading "Fork of" dropped, punctuation gone.
export function normTitle(title: string | null | undefined): string {
  let t = (title ?? '').toLowerCase().trim()
  while (t.startsWith('fork of ')) t = t.slice(8).trim()
  return t.replace(/[^a-z0-9]+/g, ' ').trim()
}

export function isIgnoredTitle(title: string, cfg: Cfg): boolean {
  const n = normTitle(title)
  return n === '' || cfg.ignoreTitles.some(t => normTitle(t) === n)
}

export type CheckInput = { phase: 'prompt' | 'turn'; stage: number; cfg: Cfg; text?: string; hasCommand?: boolean; isMeta?: boolean }

// Each chat checks once per phase: at its first real prompt, and at its first finished turn.
export function shouldCheck(i: CheckInput): boolean {
  if (!i.cfg.enabled) return false
  if (i.phase === 'prompt') return i.stage < 1 && !i.hasCommand && !i.isMeta && (i.text ?? '').trim() !== ''
  return i.stage < 2
}

export const pairKey = (a: string, b: string) => [a, b].sort().join('|')

export function dropKept(cands: Candidate[], selfId: string, kept: string[]): Candidate[] {
  return cands.filter(c => !kept.includes(pairKey(selfId, c.sessionId)))
}

// Union by chat id, newest activity (smallest idle) first, at most 3.
export function mergeCands(a: Candidate[], b: Candidate[]): Candidate[] {
  const by = new Map<string, Candidate>()
  for (const c of [...a, ...b]) by.set(c.sessionId, c)
  return [...by.values()].sort((x, y) => x.idleMs - y.idleMs).slice(0, 3)
}

export function fmtIdle(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${Math.max(m, 1)}m`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}

export function bandText(c: Candidate, total: number): string {
  const more = total > 1 ? ` (+${total - 1} more)` : ''
  return `Looks like the same task as "${c.title}" (idle ${fmtIdle(c.idleMs)})${more}.`
}

export function parseMatches(stdout: string): Candidate[] {
  try {
    const j = JSON.parse(stdout) as { matches?: unknown }
    if (!Array.isArray(j.matches)) return []
    return j.matches
      .filter((m): m is Candidate => !!m && typeof m === 'object' && typeof (m as Candidate).sessionId === 'string')
      .map(m => ({ sessionId: m.sessionId, title: String(m.title ?? ''), score: Number(m.score) || 0, reason: m.reason === 'prompt' ? ('prompt' as const) : ('title' as const), idleMs: Number(m.idleMs) || 0 }))
      .slice(0, 3)
  } catch {
    return []
  }
}
