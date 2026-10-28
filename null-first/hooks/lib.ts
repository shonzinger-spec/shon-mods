// null-first: pure logic. The rule itself is policy.ts's (a copy shared byte for byte with verdict-line);
// this file only asks it and words the answer.

import { applyPolicy, num } from './policy'

type Dict = Record<string, unknown>

const NULL_FIRST_ONLY = { rules: { null_first: true } }
const SCHEMAS = ['verdict/1', 'verdict/2']
export const MAX_AGE_DAYS = 7
export const LIST_LAST = 15
export const LIST_IDEA_MAX = 100

const fmt = (x: unknown, d: number) => {
  const n = num(x)
  return n === null ? '—' : n.toFixed(d)
}
const str = (x: unknown) => (x === null || x === undefined ? '' : String(x))

// Would the null_first rule let this result count as a PASS? Asked of policy.ts with only that rule on.
export function nullLost(v: Dict): boolean {
  return !applyPolicy({ ...v, verdict: 'PASS' }, NULL_FIRST_ONLY, {}, null).blocked_by.includes('null_first')
}

// Why the rule fails, in words; null when it holds.
export function nullProblem(v: Dict): string | null {
  if (nullLost(v)) return null
  const kind = v.null_kind
  if (kind !== 'flip' && kind !== 'random_entry') return 'no null ran'
  const real = `real ${fmt(v.pf, 2)}`
  if (kind === 'flip') {
    const npf = num(v.null_pf)
    const why = npf !== null && num(v.pf) !== null && npf >= 1.0 && npf < (num(v.pf) as number) ? ' (flip must be < 1.0)' : ''
    return `null did not lose: flip PF ${fmt(v.null_pf, 2)} vs ${real}${why}`
  }
  if (num(v.null_pct) !== null) return `null did not lose: random_entry pct ${fmt(v.null_pct, 1)} (needs >= 95)`
  return `null did not lose: random_entry PF ${fmt(v.null_pf, 2)} vs ${real}`
}

// The toast for a new verdict, or null when there is nothing to say: unknown schema, a FAIL (the rule only
// gates a PASS), older than MAX_AGE_DAYS, or the rule holds.
export function toastFor(v: unknown, nowMs: number): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const d = v as Dict
  if (!SCHEMAS.includes(str(d.schema))) return null
  const verdict = str(d.verdict).toUpperCase() || 'INCONCLUSIVE'
  if (verdict === 'FAIL') return null
  const ms = nowMs - Date.parse(str(d.written_at))
  if (Number.isFinite(ms) && ms > MAX_AGE_DAYS * 86400000) return null
  const why = nullProblem(d)
  if (why === null) return null
  return `null-first: ${str(d.test || d.slug || d.idea).slice(0, 40)} ${verdict}: ${why}`
}

// One verdict, one key: (idea, variant, verdict date). A verdict/1 file has no idea: its test name stands in.
export function seenKey(v: Dict): string {
  return [str(v.idea || v.test || v.slug), str(v.variant), str(v.written_at)].join('|')
}

export function parseLedger(text: string | null): Dict[] {
  const rows: Dict[] = []
  for (const ln of (text ?? '').split('\n')) {
    if (!ln.trim()) continue
    try {
      const r: unknown = JSON.parse(ln)
      if (typeof r === 'object' && r !== null && !Array.isArray(r)) rows.push(r as Dict)
    } catch {
      // a half-written or foreign line
    }
  }
  return rows
}

function nullCell(r: Dict): string {
  const kind = r.null_kind
  if (kind !== 'flip' && kind !== 'random_entry') return 'no null'
  const pct = num(r.null_pct) === null ? '' : ` pct ${fmt(r.null_pct, 1)}`
  return `${kind} ${fmt(r.null_pf, 2)}${pct}`
}

// The rule result for a ledger row. verdict.py's ledger rows carried no null_pct key before it was added, and
// for random_entry the pct decides the rule, so such a row cannot be judged from its fields: the 'null_pf < pf'
// fallback is only for a verdict that had no pct. The row's own blocked_by is then the only record; without
// null_first in it the outcome is unknown (the policy switch may have been off when it was written).
function rowRule(r: Dict): string {
  if (r.null_kind === 'random_entry' && !('null_pct' in r)) {
    const blocked = Array.isArray(r.blocked_by) && r.blocked_by.includes('null_first')
    return blocked
      ? 'null-first FAIL (refused when written; random_entry pct not in the ledger)'
      : 'null-first unknown (random_entry pct not in the ledger)'
  }
  const why = nullProblem(r)
  return why === null ? 'null-first ok' : `null-first FAIL (${why})`
}

export function rowLine(r: Dict): string {
  return [
    str(r.date).slice(0, 16) || '?',
    str(r.idea) || '?',
    `PF ${fmt(r.pf, 2)}`,
    nullCell(r),
    str(r.verdict) || '?',
    rowRule(r),
  ].join('  ')
}

export type Inputs = { ledger: string | null; ledgerPath: string; latest: string | null; latestPath: string; ruleOn: boolean }

// The /nulls text. idea: '' for the last LIST_LAST rows, else every row of that idea (case-insensitive).
export function nullsText(inp: Inputs, idea: string): string {
  const out = [`null_first rule: ${inp.ruleOn ? 'on (blocks a PASS without a losing null)' : 'off (warn only)'}`]

  let latest: unknown = null
  try {
    latest = inp.latest === null ? null : JSON.parse(inp.latest)
  } catch {
    latest = null
  }
  if (typeof latest === 'object' && latest !== null && !Array.isArray(latest)) {
    const v = latest as Dict
    const why = nullProblem(v)
    out.push(
      `latest: ${str(v.test || v.slug || v.idea).slice(0, 40) || '?'}  ${str(v.verdict) || '?'}  PF ${fmt(v.pf, 2)}  ${nullCell(v)}  ` +
        (why === null ? 'null-first ok' : `null-first FAIL (${why})`),
    )
  } else {
    out.push(`latest: no readable verdict at ${inp.latestPath}`)
  }

  if (inp.ledger === null) {
    out.push(`No experiment ledger yet at ${inp.ledgerPath}; write_verdict() adds one row per test.`)
    return out.join('\n')
  }
  const all = parseLedger(inp.ledger)
  const q = idea.trim().toLowerCase()
  const rows = q ? all.filter(r => str(r.idea).toLowerCase() === q).slice(-LIST_IDEA_MAX) : all.slice(-LIST_LAST)
  if (rows.length === 0) {
    out.push(q ? `No ledger rows for idea "${idea.trim()}".` : 'The ledger has no rows yet.')
    return out.join('\n')
  }
  out.push(q ? `${rows.length} ledger row(s) for idea "${idea.trim()}":` : `Last ${rows.length} ledger row(s):`)
  for (const r of rows) out.push(rowLine(r))
  return out.join('\n')
}
