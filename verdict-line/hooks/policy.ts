// policy: a faithful TS port of apply_policy() and its helpers from ~/Trading/_scratch/verdict.py.
// Pure (no $). Both ports are tested on the same cases (policy_cases.ts, owned by the Python side).

export type Basis = 'NET' | 'GROSS'
export type PolicyResult = { basis: Basis; cost_note: 'unmeasured' | null; blocked_by: string[]; verdict: string }
type Dict = Record<string, unknown>

const isDict = (x: unknown): x is Dict => typeof x === 'object' && x !== null && !Array.isArray(x)

// Python truthiness for the `x or ""` idiom (empty containers are falsy there too).
const truthy = (x: unknown): boolean =>
  Array.isArray(x) ? x.length > 0 : isDict(x) ? Object.keys(x).length > 0 : Boolean(x)

const PY_FLOAT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const PY_INF = /^[+-]?(inf|infinity)$/i

// _num: float(x), None for None / unparseable / NaN.
export function num(x: unknown): number | null {
  if (x === null || x === undefined) return null
  if (typeof x === 'boolean') return x ? 1 : 0
  if (typeof x === 'number') return Number.isNaN(x) ? null : x
  if (typeof x !== 'string') return null
  const s = x.trim()
  if (PY_INF.test(s)) return s.startsWith('-') ? -Infinity : Infinity
  return PY_FLOAT.test(s) ? Number(s) : null
}

function ruleOn(policy: unknown, name: string): boolean {
  const rules = isDict(policy) ? policy.rules : undefined
  return isDict(rules) && rules[name] === true
}

// ('NET' | 'GROSS', note). NET only when costs were applied at or above the measured floor.
export function basisOf(v: Dict, costs: unknown): [Basis, 'unmeasured' | null] {
  const cm = v.cost_model
  if (v.costs_applied !== true || !isDict(cm)) return ['GROSS', null]
  const rt = num(cm.rt_pts)
  if (rt === null) return ['GROSS', null]
  const sym = (truthy(cm.symbol) ? String(cm.symbol) : '').trim().toUpperCase()
  if (!sym) return ['GROSS', null] // no symbol, no floor to check against: the rule's field is missing
  const table = isDict(costs) ? costs : {}
  const m = table[sym]
  if (!isDict(m) || num(m.rt_pts) === null) return [rt > 0 ? 'NET' : 'GROSS', 'unmeasured']
  let floor = num(m.rt_pts) as number
  const open = num(m.rt_pts_open)
  if ((truthy(cm.session) ? String(cm.session) : '').toLowerCase() === 'open' && open !== null) floor = open
  return [rt >= floor ? 'NET' : 'GROSS', null]
}

function nullLost(v: Dict): boolean {
  const kind = v.null_kind
  const npf = num(v.null_pf)
  const pf = num(v.pf)
  const pct = num(v.null_pct)
  if (kind === 'flip') return npf !== null && pf !== null && npf < 1.0 && npf < pf
  if (kind === 'random_entry') {
    if (pct !== null) return pct >= 95
    return npf !== null && pf !== null && npf < pf
  }
  return false
}

// Only a PASS can be refused, and only to INCONCLUSIVE. blocked_by order: cost_gate, variant_counter, null_first.
export function applyPolicy(v: Dict, policy: unknown, costs: unknown, variantsTried: number | null): PolicyResult {
  const [basis, note] = basisOf(v, costs)
  let verdict = (truthy(v.verdict) ? String(v.verdict) : 'INCONCLUSIVE').toUpperCase()
  const blocked: string[] = []
  if (verdict === 'PASS') {
    if (ruleOn(policy, 'cost_gate') && basis !== 'NET') blocked.push('cost_gate')
    if (ruleOn(policy, 'variant_counter')) {
      const p0 = isDict(policy) ? policy : {}
      const limit = num(p0.variant_limit) ?? 20
      const alpha = num(p0.rc_alpha) ?? 0.05
      const p = num(v.p_value)
      const kind = (truthy(v.p_kind) ? String(v.p_kind) : '').toUpperCase()
      const rcOk = (kind === 'RC' || kind === 'SPA') && p !== null && p <= alpha
      // an RC/SPA p at or below alpha clears the rule whatever the count; only without one is the count needed
      if (!rcOk && (variantsTried === null || variantsTried > limit)) blocked.push('variant_counter')
    }
    if (ruleOn(policy, 'null_first') && !nullLost(v)) blocked.push('null_first')
    if (blocked.length) verdict = 'INCONCLUSIVE'
  }
  return { basis, cost_note: note, blocked_by: blocked, verdict }
}

// --- draw-time inputs, read the way verdict.py reads them ---

// load_policy: a missing or broken file means every rule off.
export function parsePolicy(text: string | null): Dict {
  if (text === null) return {}
  try {
    const p: unknown = JSON.parse(text)
    return isDict(p) ? p : {}
  } catch {
    return {}
  }
}

// load_costs: the `costs` section of bad-data.json, keys upper-cased, non-dict entries dropped; {} when unreadable.
export function parseCosts(text: string | null): Dict {
  if (text === null) return {}
  try {
    const doc: unknown = JSON.parse(text)
    const c = isDict(doc) ? doc.costs : undefined
    if (!isDict(c)) return {}
    return Object.fromEntries(Object.entries(c).filter(([, x]) => isDict(x)).map(([k, x]) => [k.toUpperCase(), x]))
  } catch {
    return {}
  }
}

// json.loads: Python's json writes non-finite floats as bare NaN / Infinity / -Infinity (allow_nan defaults on),
// which JSON.parse rejects. Decode them as Python reads them back: tokens outside strings become NaN / ±Infinity.
const NONFINITE: Record<string, number> = { NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity }
const MARK = '\u0000nonfinite:'
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // fall through: maybe Python's bare non-finite tokens
  }
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      out += ch
      if (ch === '\\') out += text[++i] ?? ''
      else if (ch === '"') inStr = false
      continue
    }
    const tok = ['-Infinity', 'Infinity', 'NaN'].find(t => text.startsWith(t, i))
    if (tok) {
      out += JSON.stringify(MARK + tok)
      i += tok.length - 1
      continue
    }
    if (ch === '"') inStr = true
    out += ch
  }
  return JSON.parse(out, (_k, x: unknown) => (typeof x === 'string' && x.startsWith(MARK) ? NONFINITE[x.slice(MARK.length)] : x))
}

// count_variants: distinct variant ids in the ledger for idea, plus this one. null when idea/variant unknown.
// A missing ledger (text null) counts only the file's own variant.
export function countVariants(ledgerText: string | null, idea: unknown, variant: unknown): number | null {
  if (!truthy(idea) || !truthy(variant)) return null
  const seen = new Set<unknown>([variant])
  for (const ln of (ledgerText ?? '').split('\n')) {
    let r: unknown
    try {
      r = parseJson(ln)
    } catch {
      continue
    }
    if (isDict(r) && r.idea === idea && truthy(r.variant) && (typeof r.variant === 'string' || typeof r.variant === 'number'))
      seen.add(r.variant)
  }
  return seen.size
}

// write_verdict's variants_tried: with variant_counter on and experiment_ledger off nothing is ever appended,
// so the ledger count would stay at 1 forever; verdict.py treats it as unknown (None) and the rule refuses PASS.
export function variantsTried(policy: unknown, ledgerText: string | null, idea: unknown, variant: unknown): number | null {
  if (ruleOn(policy, 'variant_counter') && !ruleOn(policy, 'experiment_ledger')) return null
  return countVariants(ledgerText, idea, variant)
}
