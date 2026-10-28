// variant-counter: pure logic. Variants are counted the way policy.ts's countVariants counts them
// (same idea, a truthy string/number variant id); p and limits are read with policy.ts's num().

import { countVariants, num, parseJson } from './policy'

type Dict = Record<string, unknown>
const isDict = (x: unknown): x is Dict => typeof x === 'object' && x !== null && !Array.isArray(x)

export type Limits = { limit: number; alpha: number }
export type Row = Dict & { idea: string; variant: string | number }
export type IdeaSummary = { idea: string; variants: number; rows: number; rcOk: boolean }

export const SCHEMAS = ['verdict/1', 'verdict/2']
export const MAX_AGE_DAYS = 7 // as verdict-line: an older latest.json is not "a new verdict"

// variant_limit and rc_alpha from a parsed policy.json, with verdict.py's defaults.
export function limitsOf(policy: unknown): Limits {
  const p = isDict(policy) ? policy : {}
  return { limit: num(p.variant_limit) ?? 20, alpha: num(p.rc_alpha) ?? 0.05 }
}

const hasVariant = (r: Dict) =>
  (typeof r.variant === 'string' && r.variant !== '') || (typeof r.variant === 'number' && r.variant !== 0)

// Ledger rows that name an idea and a variant, in file order; broken lines skipped. Rows with Python's bare
// Infinity/NaN (a run with no losing trade) are read, not dropped: they are the likeliest overfits.
export function rows(ledgerText: string): Row[] {
  const out: Row[] = []
  for (const ln of ledgerText.split('\n')) {
    let r: unknown
    try {
      r = parseJson(ln)
    } catch {
      continue
    }
    if (isDict(r) && typeof r.idea === 'string' && r.idea !== '' && hasVariant(r)) out.push(r as Row)
  }
  return out
}

// The row carries the reality-check / SPA p the rule asks for: p_kind RC|SPA and p <= alpha.
export function rcOk(r: Dict, alpha: number): boolean {
  const kind = String(r.p_kind ?? '').toUpperCase()
  const p = num(r.p_value)
  return (kind === 'RC' || kind === 'SPA') && p !== null && p <= alpha
}

// One entry per idea: distinct variants, rows, any RC/SPA p <= alpha. Most variants first.
export function summarize(all: Row[], alpha: number): IdeaSummary[] {
  const by = new Map<string, { vs: Set<string | number>; rows: number; rcOk: boolean }>()
  for (const r of all) {
    const s = by.get(r.idea) ?? { vs: new Set(), rows: 0, rcOk: false }
    s.vs.add(r.variant)
    s.rows += 1
    s.rcOk = s.rcOk || rcOk(r, alpha)
    by.set(r.idea, s)
  }
  return [...by.entries()]
    .map(([idea, s]) => ({ idea, variants: s.vs.size, rows: s.rows, rcOk: s.rcOk }))
    .sort((a, b) => b.variants - a.variants || a.idea.localeCompare(b.idea))
}

const fmt = (x: unknown, d: number) => {
  const n = num(x)
  return n === null ? '—' : n.toFixed(d)
}

export function missingText(ledgerPath: string): string {
  return [
    `no experiment ledger yet at ${ledgerPath}.`,
    'write_verdict() in ~/Trading/_scratch/verdict.py appends one line per call once the experiment_ledger rule',
    'is on in ~/.claude/verdict/policy.json; until then there are no variants to count.',
  ].join('\n')
}

// /variants with no argument.
export function listText(all: Row[], lim: Limits, ledgerPath: string): string {
  const ideas = summarize(all, lim.alpha)
  if (ideas.length === 0) return `the ledger at ${ledgerPath} has no rows with an idea and a variant yet.`
  const w = Math.min(32, Math.max(...ideas.map(i => i.idea.length)))
  const head = `${ideas.length} idea${ideas.length === 1 ? '' : 's'} in ${ledgerPath} (limit ${lim.limit}, RC/SPA alpha ${lim.alpha})`
  const body = ideas.map(i => {
    const over = i.variants > lim.limit
    return [
      `${over ? '⚠' : ' '} ${i.idea.padEnd(w)}`,
      `${String(i.variants).padStart(4)} variant${i.variants === 1 ? ' ' : 's'}`,
      `${String(i.rows).padStart(4)} run${i.rows === 1 ? ' ' : 's'}`,
      over ? `OVER ${lim.limit}` : '',
      `RC/SPA p<=${lim.alpha}: ${i.rcOk ? 'yes' : 'no'}`,
      over ? (i.rcOk ? '(PASS possible)' : '(PASS blocked)') : '',
    ].filter(Boolean).join('  ')
  })
  return [head, ...body].join('\n')
}

// /variants <idea>: one line per distinct variant (its latest run), oldest first.
export function ideaText(all: Row[], query: string, lim: Limits, ledgerPath: string): string {
  let mine = all.filter(r => r.idea === query)
  if (mine.length === 0) mine = all.filter(r => r.idea.toLowerCase() === query.toLowerCase())
  if (mine.length === 0) {
    const known = summarize(all, lim.alpha).slice(0, 10).map(i => i.idea)
    return `no runs for idea "${query}" in ${ledgerPath}.` + (known.length ? ` Ideas: ${known.join(', ')}` : '')
  }
  const idea = mine[0]!.idea
  const latest = new Map<string | number, { row: Row; runs: number }>()
  for (const r of mine) latest.set(r.variant, { row: r, runs: (latest.get(r.variant)?.runs ?? 0) + 1 })
  const n = latest.size
  const ok = mine.some(r => rcOk(r, lim.alpha))
  const over = n > lim.limit
  const head =
    `idea ${idea}: ${n} variant${n === 1 ? '' : 's'} tried, ${mine.length} run${mine.length === 1 ? '' : 's'} (limit ${lim.limit}). ` +
    (over
      ? `Over the limit: PASS needs an RC/SPA p <= ${lim.alpha}; ${ok ? 'one run has it' : 'no run has it'}.`
      : `RC/SPA p <= ${lim.alpha}: ${ok ? 'yes' : 'no'}.`)
  const body = [...latest.values()].map(({ row, runs }) => {
    const kind = String(row.p_kind ?? '') || 'p'
    return [
      `  ${String(row.variant)}`,
      String(row.date ?? '—').slice(0, 16),
      `PF ${fmt(row.pf, 2)}`,
      `t ${fmt(row.t_stat, 2)}`,
      `p ${fmt(row.p_value, 3)} ${kind}`,
      String(row.verdict ?? '—'),
      ...(runs > 1 ? [`(${runs} runs)`] : []),
    ].join(' · ')
  })
  return [head, ...body].join('\n')
}

// The toast for a newly seen verdict, or null. The count comes from the ledger plus the verdict's own
// variant (policy.ts countVariants), never from the file's variants_tried.
export type Seen = { key: string; text: string } | null
export function toastFor(v: unknown, ledgerText: string | null, lim: Limits, nowMs: number): Seen {
  if (!isDict(v) || !SCHEMAS.includes(String(v.schema))) return null
  const at = String(v.written_at ?? '')
  const ms = nowMs - Date.parse(at)
  if (Number.isFinite(ms) && ms > MAX_AGE_DAYS * 86400000) return null
  const n = countVariants(ledgerText, v.idea, v.variant)
  if (n === null || n <= lim.limit) return null
  return {
    key: JSON.stringify([v.idea, v.variant, at]),
    text: `idea ${String(v.idea)}: ${n} variants tried; PASS needs an RC/SPA p <= ${lim.alpha}`,
  }
}
