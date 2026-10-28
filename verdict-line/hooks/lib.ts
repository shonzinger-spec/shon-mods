// verdict-line: the status-line text for a verdict.json (schema verdict/1 or verdict/2).
// The verdict shown is re-checked against the current policy at draw time (policy.ts), never taken from the file.

import { applyPolicy, type PolicyResult } from './policy'

export type Gate = { name: string; metric: string; op: string; threshold: number; value: number | null; pass: boolean }
export type Verdict = {
  schema: string
  test: string
  slug?: string | null
  pf: number | null
  t_stat: number | null
  p_value: number | null
  p_kind?: string
  n_trades: number | null
  gates?: Gate[]
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  written_at: string
  // verdict/2 (all optional; untrusted: the line recomputes basis, blocked_by and verdict)
  idea?: string | null
  variant?: string | null
  costs_applied?: boolean | null
  cost_model?: { symbol?: string; rt_pts?: number; source?: string; session?: string } | null
  basis?: 'NET' | 'GROSS'
  null_kind?: string | null
  null_pf?: number | null
  null_pct?: number | null
  variants_tried?: number | null
  blocked_by?: string[]
}

// What the re-check needs: policy.json, bad-data.json costs, and variants_tried counted from the ledger.
export type Ctx = { policy: unknown; costs: unknown; variantsTried: number | null }
const RULES_OFF: Ctx = { policy: {}, costs: {}, variantsTried: null }
const SCHEMAS = ['verdict/1', 'verdict/2']

const ruleOn = (policy: unknown, name: string) =>
  typeof policy === 'object' && policy !== null && (policy as { rules?: Record<string, unknown> }).rules?.[name] === true

// The verdict to show. A file written already downgraded (INCONCLUSIVE with its own blocked_by) gets its
// reasons recomputed from the current policy as if it had been a PASS; the verdict itself never goes up.
export function effective(v: Verdict, ctx: Ctx): PolicyResult {
  const r = applyPolicy(v, ctx.policy, ctx.costs, ctx.variantsTried)
  if (r.verdict === 'INCONCLUSIVE' && Array.isArray(v.blocked_by) && v.blocked_by.length > 0)
    return { ...r, blocked_by: applyPolicy({ ...v, verdict: 'PASS' }, ctx.policy, ctx.costs, ctx.variantsTried).blocked_by }
  return r
}

export const MAX_AGE_DAYS = 7
const DOT: Record<Verdict['verdict'], string> = { PASS: '🟢', FAIL: '🔴', INCONCLUSIVE: '🟡' }

const fmt = (x: number | null | undefined, d: number) =>
  x === null || x === undefined || Number.isNaN(x) ? '—' : x === Infinity ? '∞' : x === -Infinity ? '-∞' : x.toFixed(d)

export function age(writtenAt: string, nowMs: number): string {
  const ms = nowMs - Date.parse(writtenAt)
  if (!Number.isFinite(ms)) return '?'
  const min = Math.max(0, Math.round(ms / 60000))
  if (min < 60) return `${min}m ago`
  if (min < 48 * 60) return `${Math.round(min / 60)}h ago`
  return `${Math.round(min / 1440)}d ago`
}

// undefined: nothing to show (no file, wrong schema, or older than MAX_AGE_DAYS).
// GROSS shows for a verdict/2 file whose costs fall short, and for a v1 file only while cost_gate is on
// (a v1 file carries no cost fields at all).
export function line(v: Verdict | null, nowMs: number, ctx: Ctx = RULES_OFF): string | undefined {
  if (!v || !SCHEMAS.includes(v.schema)) return undefined
  const ms = nowMs - Date.parse(v.written_at)
  if (Number.isFinite(ms) && ms > MAX_AGE_DAYS * 86400000) return undefined
  const eff = effective(v, ctx)
  if (!(eff.verdict in DOT)) return undefined
  const verdict = eff.verdict as Verdict['verdict']
  const gross = eff.basis === 'GROSS' && (v.schema === 'verdict/2' || ruleOn(ctx.policy, 'cost_gate'))
  const failed = (v.gates ?? []).filter(g => !g.pass).map(g => g.name)
  return [
    `${DOT[verdict]} ${verdict} ${String(v.test ?? '').slice(0, 40)}`,
    ...(gross ? ['GROSS'] : []),
    `PF ${fmt(v.pf, 2)}`,
    `t ${fmt(v.t_stat, 2)}`,
    `${v.p_kind ?? 'p'} p ${fmt(v.p_value, 3)}`,
    ...(v.n_trades === null || v.n_trades === undefined ? [] : [`n ${v.n_trades}`]),
    ...(failed.length ? [`failed: ${failed.join(',')}`] : []),
    ...(eff.blocked_by.length ? [`blocked: ${eff.blocked_by.join(',')}`] : []),
    age(v.written_at, nowMs),
  ].join(' · ')
}
