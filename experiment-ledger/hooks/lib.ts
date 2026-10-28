// experiment-ledger: pure logic for /experiments (no $). Reads the JSONL lines write_verdict() in
// ~/Trading/_scratch/verdict.py appends when policy rule experiment_ledger is on (LEDGER_KEYS there):
// date, slug, idea, variant, data_file, n_trades, pf, t_stat, p_value, p_kind, basis, null_kind, null_pf,
// verdict, blocked_by, script.

export type Row = Record<string, unknown> & { _i: number }
export type Ledger = { rows: Row[]; malformed: number }
// What the reader managed: the whole file, or only its tail (size and bytes kept, in bytes).
export type ReadInfo = { path: string; size: number; tailBytes: number | null }

export const RECENT = 15
export const TOP_IDEAS = 10
export const IDEA_CAP = 50
// $.process.run keeps at most 4 MiB of stdout, so the tail read stays under it.
export const READ_CAP = 4_000_000

const isDict = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

// Python's json.dumps (write_verdict, allow_nan default) writes bare NaN / Infinity / -Infinity, and
// build_index.py's json.loads reads them back, so this reader must too. Each such token outside a
// string becomes a marker string, and the reviver turns the marker back into the number.
const NONFINITE: Record<string, number> = { NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, '-Infinity': Number.NEGATIVE_INFINITY }
const MARK = '\u0000py-nonfinite:'

function parsePyJson(ln: string): unknown {
  try {
    return JSON.parse(ln)
  } catch (err) {
    let out = ''
    let inStr = false
    let found = false
    for (let i = 0; i < ln.length; i++) {
      const c = ln[i] as string
      if (inStr) {
        out += c
        if (c === '\\') out += ln[++i] ?? ''
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') {
        inStr = true
        out += c
        continue
      }
      const tok = ['-Infinity', 'Infinity', 'NaN'].find(t => ln.startsWith(t, i))
      if (tok) {
        out += JSON.stringify(MARK + tok)
        i += tok.length - 1
        found = true
        continue
      }
      out += c
    }
    if (!found) throw err
    return JSON.parse(out, (_k, v: unknown) =>
      typeof v === 'string' && v.startsWith(MARK) && v.slice(MARK.length) in NONFINITE ? NONFINITE[v.slice(MARK.length)] : v,
    )
  }
}

// One row per JSON object line. Blank lines are ignored; anything else that is not a JSON object is
// counted as malformed. `isTail`: the text starts mid-file, so its first line is a cut one and dropped.
export function parseLedger(text: string, isTail = false): Ledger {
  const lines = text.split('\n')
  if (isTail) lines.shift()
  const rows: Row[] = []
  let malformed = 0
  for (const ln of lines) {
    if (!ln.trim()) continue
    let r: unknown
    try {
      r = parsePyJson(ln)
    } catch {
      malformed++
      continue
    }
    if (!isDict(r)) {
      malformed++
      continue
    }
    rows.push({ ...r, _i: rows.length })
  }
  return { rows, malformed }
}

const dateOf = (r: Row): string => (r.date === null || r.date === undefined ? '' : String(r.date))

// Newest first, by (date text, line order): the key kill-ledger's build_index.py uses for "latest".
export function newestFirst(rows: readonly Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const da = dateOf(a)
    const db = dateOf(b)
    if (da !== db) return da < db ? 1 : -1
    return b._i - a._i
  })
}

const verdictOf = (r: Row): string => (r.verdict ? String(r.verdict).toUpperCase() : '?')
const ideaOf = (r: Row): string => (r.idea ? String(r.idea) : '')

function cut(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}~` : s
}

// Python's text for a non-finite float (what build_index.py prints for pf inf).
function nonFinite(x: number): string {
  return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf'
}

function fixed(x: unknown, d: number): string {
  if (typeof x !== 'number') return '-'
  return Number.isFinite(x) ? x.toFixed(d) : nonFinite(x)
}

// Python's %.3g for a p-value.
function sig3(x: unknown): string {
  if (typeof x !== 'number') return '-'
  return Number.isFinite(x) ? String(Number(x.toPrecision(3))) : nonFinite(x)
}

export function rowLine(r: Row, withIdea: boolean): string {
  const parts = [dateOf(r).slice(0, 10) || '----------']
  if (withIdea) parts.push(cut(ideaOf(r) || '(no idea)', 20))
  parts.push(cut(r.variant === null || r.variant === undefined ? '-' : String(r.variant), 14))
  parts.push(`pf ${fixed(r.pf, 2)}`, `t ${fixed(r.t_stat, 2)}`)
  parts.push(`p ${sig3(r.p_value)}${r.p_kind ? ` ${String(r.p_kind)}` : ''}`)
  parts.push(r.basis ? String(r.basis) : '-')
  parts.push(r.null_kind ? `${String(r.null_kind)} ${fixed(r.null_pf, 2)}` : 'no-null')
  parts.push(verdictOf(r))
  const blocked = Array.isArray(r.blocked_by) ? r.blocked_by.map(String).filter(Boolean) : []
  if (blocked.length) parts.push(`blocked ${blocked.join(',')}`)
  return parts.join('  ')
}

function headLines(info: ReadInfo, led: Ledger, what: string): string[] {
  const bits = [what]
  if (led.malformed) bits.push(`${led.malformed} malformed line${led.malformed === 1 ? '' : 's'} skipped`)
  const out = [`${bits.join('; ')} (${info.path})`]
  if (info.tailBytes !== null)
    out.push(`read only the last ${mb(info.tailBytes)} of ${mb(info.size)}: older rows are not counted`)
  return out
}

const mb = (n: number): string => `${(n / 1e6).toFixed(1)} MB`

export function summaryText(led: Ledger, info: ReadInfo): string {
  const n = led.rows.length
  const out = headLines(info, led, `${n} row${n === 1 ? '' : 's'}`)
  if (n === 0) return out.join('\n')
  const byVerdict = new Map<string, number>()
  for (const r of led.rows) byVerdict.set(verdictOf(r), (byVerdict.get(verdictOf(r)) ?? 0) + 1)
  out.push(`verdicts: ${[...byVerdict].sort((a, b) => b[1] - a[1]).map(([v, c]) => `${v} ${c}`).join(' | ')}`)
  const sorted = newestFirst(led.rows)
  out.push(`${Math.min(RECENT, n)} most recent (newest first):`)
  for (const r of sorted.slice(0, RECENT)) out.push(`  ${rowLine(r, true)}`)
  const ideas = new Map<string, { count: number; latest: Row }>()
  for (const r of sorted) {
    const k = ideaOf(r) || '(no idea)'
    const cur = ideas.get(k)
    if (cur) cur.count++
    else ideas.set(k, { count: 1, latest: r }) // first seen in newest-first order is the latest
  }
  const top = [...ideas].sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1)).slice(0, TOP_IDEAS)
  out.push(`ideas (top ${top.length} of ${ideas.size} by rows; latest verdict):`)
  for (const [k, v] of top) out.push(`  ${cut(k, 30)}  ${v.count}  latest ${verdictOf(v.latest)} ${dateOf(v.latest).slice(0, 10)}`)
  return out.join('\n')
}

// Rows for one idea: the exact name first, else the same name ignoring case.
export function rowsFor(rows: readonly Row[], idea: string): Row[] {
  const q = idea.trim()
  const exact = rows.filter(r => ideaOf(r) === q)
  return exact.length ? exact : rows.filter(r => ideaOf(r).toLowerCase() === q.toLowerCase())
}

export function ideaText(led: Ledger, info: ReadInfo, idea: string): string {
  const q = idea.trim()
  const mine = newestFirst(rowsFor(led.rows, q))
  if (mine.length === 0) {
    const out = headLines(info, led, `no rows for idea "${q}"`)
    const near = [...new Set(led.rows.map(ideaOf).filter(k => k && k.toLowerCase().includes(q.toLowerCase())))].slice(0, 5)
    out.push(near.length ? `ideas containing "${q}": ${near.join(', ')}` : `${new Set(led.rows.map(ideaOf)).size} ideas in the ledger; /experiments lists them`)
    return out.join('\n')
  }
  const latest = mine[0] as Row
  const name = ideaOf(latest)
  const out = headLines(info, led, `${mine.length} row${mine.length === 1 ? '' : 's'} for idea "${name}"`)
  const killed = verdictOf(latest) === 'FAIL'
  out.push(`latest: ${rowLine(latest, false)}`)
  out.push(
    killed
      ? `kill-ledger: KILLED (latest is FAIL; entry ledger:${name}, raised when a prompt names it)`
      : `kill-ledger: not killed (latest is ${verdictOf(latest)}; only a latest FAIL counts)`,
  )
  out.push('rows (newest first):')
  for (const r of mine.slice(0, IDEA_CAP)) out.push(`  ${rowLine(r, false)}`)
  if (mine.length > IDEA_CAP) out.push(`  ... ${mine.length - IDEA_CAP} older rows omitted`)
  return out.join('\n')
}

export function missingText(path: string, ledgerRuleOn: boolean): string {
  return `no ledger yet: write_verdict() appends once policy rule experiment_ledger is on (now: ${ledgerRuleOn ? 'on' : 'off'}) (${path})`
}

// load_policy semantics: a missing or broken policy means every rule off.
export function ledgerRuleOn(policyText: string | null): boolean {
  if (policyText === null) return false
  try {
    const p: unknown = JSON.parse(policyText)
    return isDict(p) && isDict(p.rules) && p.rules.experiment_ledger === true
  } catch {
    return false
  }
}
