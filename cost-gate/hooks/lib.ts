// cost-gate: pure scanning and formatting logic (no engine calls), unit-tested in cost-gate.test.ts.

export type Kind = 'zero' | 'negative' | 'below-floor'
export type Finding = { line: number; name: string; value: number; kind: Kind; snippet: string }
export type CostRow = { rt_pts?: unknown; rt_pts_open?: unknown; source?: unknown }
export type Costs = Record<string, CostRow>
// `named`: every measured symbol the file names; `mixed`: the file also names
// another market, so the floor holds only on lines that name a measured symbol.
export type Floor = { symbol: string; rtPts: number; named?: string[]; mixed?: boolean }

// Word parts that make a name a trading cost. `spread` alone is a price spread,
// so only `spread_cost` (through `cost`) counts.
const COST_PARTS = new Set(['commission', 'commissions', 'comm', 'comms', 'fee', 'fees', 'slippage', 'slip', 'slips', 'cost', 'costs'])
// Parts that make the name something other than the cost setting: running
// totals, counters, tolerances, lookups.
const NOT_SETTING = new Set([
  'total', 'tot', 'cum', 'cumul', 'cumulative', 'sum', 'acc', 'accum', 'running', 'paid', 'basis',
  'n', 'num', 'count', 'cnt', 'idx', 'index', 'col', 'column', 'key', 'name', 'label', 'flag',
  'func', 'fn', 'opportunity', 'avg', 'mean', 'max', 'min', 'std',
  // prop-firm account fees, not per-trade costs
  'eval', 'funded', 'monthly', 'mo', 'subscription', 'activation', 'reset',
  // additive tweaks on top of a base cost: 0 is the baseline, not a zero cost
  'extra', 'shift', 'sens', 'delta', 'bump', 'adj',
])
const POINT_PARTS = new Set(['pts', 'pt', 'points', 'point'])
// Units we must not guess: dollars and ticks get the zero/negative check only.
const OTHER_UNITS = new Set(['usd', 'dollar', 'dollars', 'tick', 'ticks', 'bps', 'bp', 'pct', 'percent'])

export function parts(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/_+/)
    .map(p => p.replace(/\d+$/, ''))
    .filter(Boolean)
}

export type NameInfo = { isCost: boolean; isPoints: boolean }

export function nameInfo(name: string): NameInfo {
  const ps = parts(name)
  const isCost = ps.some(p => COST_PARTS.has(p)) && !ps.some(p => NOT_SETTING.has(p))
  const isPoints = ps.some(p => POINT_PARTS.has(p)) && !ps.some(p => OTHER_UNITS.has(p))
  return { isCost, isPoints }
}

const NUM = String.raw`([-+]?\s*(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)`
const END = String.raw`\s*(?=[,)\]};#]|$)`
// `name = 0`, `self.name: float = 0.0`, `f(name=0)`, `def f(name=0)`.
const ASSIGN = new RegExp(String.raw`(?<![\w.])(?:[A-Za-z_]\w*\.)*([A-Za-z_]\w*)\s*(?::\s*[A-Za-z_][\w.\[\], ]*)?=(?!=)\s*${NUM}${END}`, 'g')
// `'name': 0` in a dict literal.
const DICT = new RegExp(String.raw`['"]([A-Za-z_]\w*)['"]\s*:\s*${NUM}${END}`, 'g')
// `add_argument('--name', ..., default=0)` on one line.
const ARGPARSE = new RegExp(String.raw`add_argument\(\s*['"]-{1,2}([\w-]+)['"][^#]*?\bdefault\s*=\s*${NUM}${END}`, 'g')

// Drops a trailing `# comment`, leaving `#` inside string literals alone.
export function stripComment(line: string): string {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '#') return line.slice(0, i)
  }
  return line
}

// Empties string literals so `"slip=0"` inside a message is not an assignment.
export function blankStrings(code: string): string {
  return code.replace(/(['"])(?:\\.|(?!\1).)*\1/g, '""')
}

// A per-side value is half a round trip: per side / fill / leg, each way,
// one-way, or charged on entry and exit.
const PER_SIDE = /\b(?:per|each)[ _-]?(?:side|fill|leg|way|execution)s?\b|\/\s*(?:side|fill|leg)\b|\bone[ _-]?way\b|\bentry\s*(?:\+|and|&)\s*(?:each\s+)?exit/i
const SIDE_PARTS = new Set(['side', 'fill', 'leg'])
// Parts of a cost component: the floor is the TOTAL round trip, so slippage,
// commission and fee values are summed before the comparison.
const COMPONENT_PARTS = new Set(['commission', 'commissions', 'comm', 'comms', 'fee', 'fees', 'slippage', 'slip', 'slips'])
// Futures roots with no measured cost: a line naming one is in that market's
// points, so the NQ floor says nothing about it.
const OTHER_ROOTS = /(?<![A-Za-z])(?:M?ES|M?GC|M?CL|M?YM|RTY|M2K|ZN|ZB|ZF|SI|SIL|HG|NG|6E|6J|M6E)(?![A-Za-z])/

const isComponent = (name: string) => parts(name).some(p => COMPONENT_PARTS.has(p))

// The code doubles the name (`2 * NAME`, `NAME * 2`, `2 * (NAME + ...)`): it is per side.
function doubled(name: string, whole: string): boolean {
  const two = String.raw`(?<![\w.])2(?:\.0*)?`
  const n = String.raw`(?<![\w.])${name}(?!\w)`
  return new RegExp(`${two}\\s*\\*\\s*(?:${n}|\\([^)]*${n})|${n}\\s*\\*\\s*${two}(?![\\w.])`).test(whole)
}

// `unknown`: a component is set to an expression we cannot evaluate, so the
// round-trip sum is unknown and components get no below-floor verdict.
type Rt = { whole: string; parts: Map<string, number>; unknown: boolean }

// Round-trip points of one value.
function rtOf(name: string, value: number, raw: string, whole: string): number {
  const perSide =
    parts(name).some(p => SIDE_PARTS.has(p)) || PER_SIDE.test(raw.slice(raw.indexOf('#') + 1 || raw.length)) || doubled(name, whole)
  return perSide ? 2 * value : value
}

type LineCtx = { raw: string; floor: Floor | null; rt: Rt }

function judge(name: string, value: number, info: NameInfo, ctx: LineCtx): Kind | null {
  if (value === 0) return 'zero'
  if (value < 0) return 'negative'
  const { floor, raw, rt } = ctx
  if (!floor || !info.isPoints || OTHER_ROOTS.test(raw)) return null
  if (floor.mixed && !(floor.named ?? [floor.symbol]).some(s => token(s).test(raw))) return null
  const own = rtOf(name, value, raw, rt.whole)
  if (!isComponent(name)) return own < floor.rtPts ? 'below-floor' : null
  if (rt.unknown) return null
  // a component: the sum of every component the file sets, this one included
  const sum = new Map(rt.parts)
  sum.set(name, Math.max(sum.get(name) ?? 0, own))
  return [...sum.values()].reduce((a, b) => a + b, 0) < floor.rtPts ? 'below-floor' : null
}

// A line building a trade/result record (`pnl=0.0, commission=0.0, ...`): the
// zero is the empty field of an open trade, not a cost setting.
const RECORD = /\b(?:\w+_)?pnl\s*=[^=]|\bexit_reason\s*=[^=]|['"](?:\w+_)?pnl['"]\s*:|['"]profitable['"]\s*:/i

// Statement-level names the text later re-assigns to something other than a
// number (`slip_in = 0.0` then `slip_in = tick`, or `self.slippage = p - s`,
// keyed by the last attribute): loop or instance state, not a setting.
function reassigned(text: string): Set<string> {
  const out = new Set<string>()
  for (const line of text.split('\n')) {
    for (const stmt of stripComment(line).split(';')) {
      const m = /^\s*(?:[A-Za-z_]\w*\.)*([A-Za-z_]\w*)\s*=(?!=)\s*(.+)$/.exec(stmt)
      const rhs = (m?.[2] ?? '').trim()
      // a kwarg line inside a call (`name=x,`) is not a re-assignment
      if (m && !/[,(]$|,\s*[A-Za-z_]\w*\s*=(?!=)/.test(rhs) && !new RegExp(`^${NUM}$`).test(rhs)) out.add(m[1] ?? '')
    }
  }
  return out
}

// Names the text accumulates into (`fees += x`): a running total starting at 0.
function accumulators(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/(?<![\w.])(?:[A-Za-z_]\w*\.)*([A-Za-z_]\w*)\s*(?:\+=|-=|=\s*\1\s*[+-])/g)) out.add(m[1] ?? '')
  return out
}

type Hit = { line: number; name: string; value: number; info: NameInfo; raw: string; t: string; silenced: boolean }

type CodeLine = { idx: number; raw: string; t: string }

// The code lines of the text: docstrings and whole-line comments dropped.
function codeLines(text: string): CodeLine[] {
  const out: CodeLine[] = []
  let inDoc = false
  text.split('\n').forEach((raw, idx) => {
    const t = raw.trim()
    const triples = (t.match(/"""|'''/g) ?? []).length
    if (inDoc) {
      if (triples % 2 === 1) inDoc = false
      return
    }
    if (triples % 2 === 1) {
      inDoc = true
      return
    }
    if (!t.startsWith('#')) out.push({ idx, raw, t })
  })
  return out
}

// A class whose name ends in one of these, or that has a pnl / exit_* field, is
// a trade or result record: its `name: T = 0` fields are empty slots, not settings.
const RECORD_CLASS = new Set(['trade', 'trades', 'fill', 'fills', 'report', 'reports', 'result', 'results', 'record', 'records'])
const RECORD_FIELD = /^\s*(?:\w+_)?pnl\s*:|^\s*exit_(?:reason|time|price|ts|px)\s*:/i
const FIELD = /^\s*([A-Za-z_]\w*)\s*:[^=]+=(?!=)/

type Records = { lines: Set<number>; recordNames: Set<string>; settingNames: Set<string> }

// Annotated class fields of the text: the lines inside record classes, and the
// field names of record and of other classes.
function records(text: string): Records {
  const out: Records = { lines: new Set(), recordNames: new Set(), settingNames: new Set() }
  const lines = text.split('\n')
  const indent = (l: string) => l.length - l.trimStart().length
  lines.forEach((line, i) => {
    const m = /^(\s*)class\s+([A-Za-z_]\w*)/.exec(line)
    if (!m) return
    const body: number[] = []
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] ?? ''
      if (l.trim() !== '' && indent(l) <= (m[1] ?? '').length) break
      body.push(j)
    }
    const isRecord = RECORD_CLASS.has(parts(m[2] ?? '').pop() ?? '') || body.some(j => RECORD_FIELD.test(lines[j] ?? ''))
    for (const j of body) {
      const f = FIELD.exec(stripComment(lines[j] ?? ''))
      if (!f) continue
      if (isRecord) {
        out.lines.add(j)
        out.recordNames.add(f[1] ?? '')
      } else out.settingNames.add(f[1] ?? '')
    }
  })
  return out
}

// Every literal cost setting in the text, before judging. `ctx` is the file the
// text lands in (the whole file after an Edit): running totals, re-assigned
// state and record classes are read from it as well.
function settings(text: string, ctx: string = text): Hit[] {
  const out: Hit[] = []
  const acc = accumulators(ctx)
  const moved = reassigned(ctx)
  const rec = records(text)
  const recCtx = ctx === text ? rec : records(ctx)
  for (const { idx, raw, t } of codeLines(text)) {
    const code = stripComment(raw)
    if (RECORD.test(code)) continue
    const field = FIELD.exec(code)?.[1]
    if (field !== undefined && (rec.lines.has(idx) || (recCtx.recordNames.has(field) && !recCtx.settingNames.has(field)))) continue
    const hits: [string, string][] = []
    const bare = blankStrings(code)
    for (const m of bare.matchAll(ASSIGN)) {
      const name = m[1] ?? ''
      // a plain statement `x = 0` whose name the text re-assigns later is state
      const isStatement = /^\s*$|;\s*$/.test(bare.slice(0, m.index ?? 0))
      if (isStatement && moved.has(name)) continue
      hits.push([name, m[2] ?? ''])
    }
    for (const m of code.matchAll(DICT)) hits.push([m[1] ?? '', m[2] ?? ''])
    for (const m of code.matchAll(ARGPARSE)) hits.push([(m[1] ?? '').replace(/-/g, '_'), m[2] ?? ''])
    for (const [name, num] of hits) {
      const info = nameInfo(name)
      if (!info.isCost || acc.has(name)) continue
      const value = Number(num.replace(/\s+/g, ''))
      if (!Number.isFinite(value)) continue
      out.push({ line: idx + 1, name, value, info, raw, t, silenced: /#\s*cost-ok\b/.test(t) })
    }
  }
  return out
}

const LITERAL = new RegExp(String.raw`^${NUM}$`)
const STMT = /^\s*(?:[A-Za-z_]\w*\.)*([A-Za-z_]\w*)\s*(?::[^=]*)?=(?!=)\s*(.+?)\s*$/

// Literal constants the text sets at statement level (`PTVAL_MNQ = 2`); a name
// set to two different literals is dropped.
function constants(text: string): Map<string, number> {
  const out = new Map<string, number>()
  const clash = new Set<string>()
  for (const { raw } of codeLines(text)) {
    const m = /^\s*([A-Za-z_]\w*)\s*(?::[^=]*)?=(?!=)\s*(.+?)\s*$/.exec(stripComment(raw))
    if (!m || !LITERAL.test(m[2] ?? '')) continue
    const name = m[1] ?? ''
    const v = Number((m[2] ?? '').replace(/\s+/g, ''))
    if (out.has(name) && out.get(name) !== v) clash.add(name)
    out.set(name, v)
  }
  for (const n of clash) out.delete(n)
  return out
}

// The value of `+ - * / ( )` arithmetic over numbers and known constants, or
// null when anything else is in it.
export function evalExpr(src: string, consts: Map<string, number>): number | null {
  const toks = src.match(/\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+|[A-Za-z_][\w.]*|\S/g) ?? []
  let i = 0
  const atom = (): number | null => {
    const t = toks[i++]
    if (t === undefined) return null
    if (t === '(') {
      const v = sum()
      return toks[i++] === ')' ? v : null
    }
    if (t === '-' || t === '+') {
      const v = atom()
      return v === null ? null : t === '-' ? -v : v
    }
    if (/^[\d.]/.test(t)) return Number(t)
    return consts.get(t) ?? null
  }
  const prod = (): number | null => {
    let v = atom()
    while (v !== null && (toks[i] === '*' || toks[i] === '/')) {
      const op = toks[i++]
      const r = atom()
      v = r === null ? null : op === '*' ? v * r : v / r
    }
    return v
  }
  const sum = (): number | null => {
    let v = prod()
    while (v !== null && (toks[i] === '+' || toks[i] === '-')) {
      const op = toks[i++]
      const r = prod()
      v = r === null ? null : op === '+' ? v + r : v - r
    }
    return v
  }
  const v = sum()
  return v !== null && i === toks.length && Number.isFinite(v) ? v : null
}

// Round-trip points of each positive points component the whole file sets
// (largest value per name): literals, and statements whose right-hand side is
// arithmetic over the file's literal constants (`COMM_PT = 0.62 / PTVAL_MNQ`).
// A component set to anything we cannot evaluate makes the sum unknown.
function componentsOf(whole: string): { parts: Map<string, number>; unknown: boolean } {
  const out = new Map<string, number>()
  const keep = (name: string, value: number, raw: string) => out.set(name, Math.max(out.get(name) ?? 0, rtOf(name, value, raw, whole)))
  for (const h of settings(whole)) {
    if (h.value <= 0 || !h.info.isPoints || !isComponent(h.name) || OTHER_ROOTS.test(h.raw)) continue
    keep(h.name, h.value, h.raw)
  }
  const consts = constants(whole)
  let unknown = false
  for (const { raw } of codeLines(whole)) {
    if (OTHER_ROOTS.test(raw)) continue
    for (const stmt of blankStrings(stripComment(raw)).split(';')) {
      const m = STMT.exec(stmt)
      const name = m?.[1] ?? ''
      const info = nameInfo(name)
      if (!m || !info.isCost || !info.isPoints || !isComponent(name)) continue
      // a kwarg line inside a call (`name=x,`) passes a value through
      const rhs = (m[2] ?? '').replace(/,$/, '').trim()
      if (LITERAL.test(rhs) || /[,(]/.test(rhs.replace(/\([^()]*\)/g, '')) || /\($/.test(rhs)) continue
      // an alias of another component (`slip_pts = SLIP_PTS`) adds nothing
      if (/^[A-Za-z_][\w.]*$/.test(rhs) && isComponent(rhs.split('.').pop() ?? '')) continue
      const v = evalExpr(rhs, consts)
      if (v === null) unknown = true
      else if (v > 0) keep(name, v, raw)
    }
  }
  return { parts: out, unknown }
}

// `text` is what the call adds; `whole` is the file as it now is (for an Edit),
// which says whether a value is doubled and what the other components are.
export function scan(text: string, floor: Floor | null, whole: string = text): Finding[] {
  const out: Finding[] = []
  const rt: Rt = { whole, ...(floor ? componentsOf(whole) : { parts: new Map<string, number>(), unknown: false }) }
  const seen = new Set<string>()
  for (const h of settings(text, whole)) {
    const key = `${h.line}:${h.name}`
    if (h.silenced || seen.has(key)) continue
    const kind = judge(h.name, h.value, h.info, { raw: h.raw, floor, rt })
    if (!kind) continue
    seen.add(key)
    out.push({ line: h.line, name: h.name, value: h.value, kind, snippet: h.t.slice(0, 100) })
  }
  return out
}

// The measured-cost table from bad-data.json's `costs` (non-object entries such
// as `_comment` dropped, symbols upper-cased), as verdict.py's load_costs reads it.
export function costsOf(raw: unknown): Costs | null {
  const c = (raw as { costs?: unknown } | null)?.costs
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null
  const out: Costs = {}
  for (const [k, v] of Object.entries(c as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k.toUpperCase()] = v as CostRow
  }
  return Object.keys(out).length ? out : null
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)

const token = (sym: string, flags = '') => new RegExp(`(?<![A-Za-z])${sym}(?![A-Za-z])`, flags)

// Where a file names a market: an upper-case token anywhere outside import
// lines, or a token of any case inside a string literal that is not a path or a
// hyphenated directory name (`"nq_1m"` names NQ; `nq_bot`, `"mnq-mgc-research"` do not).
function marketText(fileText: string): { code: string; strings: string } {
  const code = fileText
    .split('\n')
    .filter(l => !/^\s*(?:from|import)\s/.test(l))
    .join('\n')
  const strings = [...code.matchAll(/(['"])((?:\\.|(?!\1).)*)\1/g)]
    .map(m => m[2] ?? '')
    .filter(x => !/[/\\-]/.test(x))
    .join('\n')
  return { code, strings }
}

// The floor for a file: the lowest midday round trip among the measured symbols
// the file names (NQ, MNQ), or null when it names none.
export function floorFor(fileText: string, costs: Costs | null): Floor | null {
  const { code, strings } = marketText(fileText)
  let best: Floor | null = null
  const named: string[] = []
  for (const [sym, row] of Object.entries(costs ?? {})) {
    const rt = num(row.rt_pts)
    if (rt === null || !/^[A-Z0-9]+$/.test(sym)) continue
    if (!token(sym).test(code) && !token(sym, 'i').test(strings)) continue
    named.push(sym)
    if (!best || rt < best.rtPts) best = { symbol: sym, rtPts: rt }
  }
  // another market named in code (not in a docstring or comment)
  const live = codeLines(code)
    .filter(l => !/^[rRbBuUfF]*(?:"""|''')/.test(l.t))
    .map(l => stripComment(l.raw))
    .join('\n')
  return best && { ...best, named, mixed: OTHER_ROOTS.test(live) }
}

const base = (file: string) => file.split('/').pop() ?? file

function describe(f: Finding, floor: Floor | null): string {
  if (f.kind === 'below-floor' && floor) return `${f.name} = ${f.value} pts < measured ${floor.symbol} round trip ${floor.rtPts} pts`
  return `${f.name} = ${f.value} (${f.kind})`
}

// What the model reads after the tool result.
export function report(file: string, findings: Finding[], floor: Floor | null, isWholeFile: boolean): string {
  const lines = [
    `cost-gate (warning, not a block): ${file} sets ${findings.length} trading cost(s) to zero, a negative number, or below the measured floor` +
      (isWholeFile ? '.' : ' in the edited text (line numbers count from the start of new_string).'),
    'A backtest run this way is a GROSS result, never a NET one: say so to the user, or use the measured cost (/costs). A reviewed line can carry "# cost-ok".',
  ]
  for (const f of findings.slice(0, 6)) lines.push(`- L${f.line} ${describe(f, floor)}`, `    ${f.snippet}`)
  if (findings.length > 6) lines.push(`- … ${findings.length - 6} more`)
  if (findings.some(f => f.kind === 'below-floor')) {
    lines.push('The floor is a ROUND TRIP in points (midday; the open is higher). A per-side value (per fill/leg, each way, or doubled in the code) counts twice; slippage, commission and fee values are summed.')
  }
  return lines.join('\n')
}

// What the person sees.
export function toastText(file: string, findings: Finding[]): string {
  const parts = findings.slice(0, 3).map(f => `${f.name}=${f.value} L${f.line}`)
  return `cost-gate: ${base(file)} — ${parts.join('; ')}${findings.length > 3 ? ` +${findings.length - 3}` : ''}`
}

// test_*.py files hold fixtures, not backtest settings.
export function isTestFile(path: string): boolean {
  return /^test_[^/]*\.py$/i.test(base(path))
}

// Folders that are trading repos even when ~/Trading holds no link to them (as in leak-lint).
export const EXTRA_ROOTS = ['mnq-mgc-research', 'strategy_lab', 'nq_bot', 'scriv_recreate', 'propfarm-2026', 'prop_farm']

export function isTradingPy(path: string, roots: readonly string[]): boolean {
  const p = path.toLowerCase()
  if (!p.endsWith('.py') || isTestFile(path)) return false
  return roots.some(r => p.startsWith(r.toLowerCase().replace(/\/+$/, '') + '/'))
}

// /costs output.
export function costsText(raw: unknown, costsPath: string, policy: unknown, policyPath: string): string {
  const costs = costsOf(raw)
  const out: string[] = []
  if (raw === null) out.push(`cost-gate: cannot read ${costsPath}; no measured costs.`)
  else if (!costs) out.push(`cost-gate: ${costsPath} has no "costs" section; no measured costs.`)
  else {
    const fmt = (x: unknown) => (num(x) === null ? '-' : String(x))
    const rows = Object.entries(costs).map(([s, r]) => [s, fmt(r.rt_pts), fmt(r.rt_pts_open), typeof r.source === 'string' ? r.source : '-'])
    const head = ['symbol', 'rt_pts midday', 'rt_pts open', 'source']
    const w = [0, 1, 2].map(i => Math.max(head[i]?.length ?? 0, ...rows.map(r => r[i]?.length ?? 0)))
    const line = (r: string[]) => r.map((c, i) => (i < 3 ? c.padEnd(w[i] ?? 0) : c)).join('  ')
    out.push(`Measured round-trip costs in points (${costsPath}):`, line(head), ...rows.map(line))
  }
  const rules = (policy as { rules?: Record<string, unknown> } | null)?.rules
  if (policy === null) out.push(`policy cost_gate: off (no ${policyPath})`)
  else if (rules?.cost_gate === true) out.push(`policy cost_gate: ON (${policyPath}): a PASS on a GROSS basis is refused to INCONCLUSIVE`)
  else out.push(`policy cost_gate: off (${policyPath}): verdicts are labelled NET/GROSS but a GROSS PASS is not refused`)
  return out.join('\n')
}
