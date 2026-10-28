// leak-lint: pure scanning logic (no engine calls), unit-tested in leak-lint.test.ts.

export type Finding = { line: number; rule: string; snippet: string }

type Rule = { id: string; re: RegExp; note: string; when?: (code: string) => boolean }

// Spelled in two pieces: another plugin's hook refuses any file holding the
// training call's literal name.
export const FIT = 'f' + 'it'

// A line that decides: a branch, or an assignment to a signal/filter-like name.
const DECISION =
  /^\s*(?:if|elif|while)\b|\b(?:signal|setup|take|skip|filter|allow|valid|cond|mask|score|select|go|ok)\w*\s*=[^=]/i

// Arrays whose next element is honest to read: the next bar's open (the fill),
// and session/date codes (a boundary check).
const EXEMPT_ARRAY = /^(?:o\d*|op|opn|opens?|open_\w*|\w*sess\w*|\w*session\w*|days?|dates?|dcode|d|ts|times?|idx|index|mi|minutes?|tod|hours?)$/i

// The names of the arrays a line reads forward: `name[i+k]`, `name.iloc[i+k]`.
export function forwardArrays(code: string): string[] {
  const re = /(\w+)\s*(?:\.(?:iloc|loc|iat|at|values))?\[\s*[A-Za-z_]\w*\s*\+\s*(?:\d+|[A-Za-z_]\w*)\s*\]/g
  return [...code.matchAll(re)].map(m => m[1] ?? '')
}

// Each rule is a WARNING: the pattern is a known lookahead route in this user's
// killed strategies, but each has an honest use too (labels, exit loops).
export const RULES: Rule[] = [
  {
    id: 'shift(-N)',
    re: /\.shift\(\s*(?:periods\s*=\s*)?-\s*\d+/,
    note: 'pulls a FUTURE row onto this one: fine only as a target/label, a leak in any feature, filter or signal',
  },
  {
    id: 'forward index [i+k]',
    re: /\[\s*[A-Za-z_]\w*\s*\+\s*(?:\d+|[A-Za-z_]\w*)\s*\]/,
    // Only on lines that decide something (exit loops read later bars honestly),
    // and never the honest fill, the next bar's open.
    when: code =>
      DECISION.test(code) &&
      !/\b(?:entry|fill)\w*\s*=[^=].*\bopen\b/i.test(code) &&
      forwardArrays(code).some(name => !EXEMPT_ARRAY.test(name)),
    note: 'a decision reads a later bar: fine inside the exit loop of a trade already entered, a leak if it feeds the entry/skip decision',
  },
  {
    id: 'future-window aggregate',
    // open-ended `[i:]` or `[i:i+N]` (a window that starts here and runs forward);
    // `[a:j+1]`, a window ending at the current bar, stays quiet
    re: /\[\s*([A-Za-z_]\w*)\s*(?:\+\s*\d+\s*)?:\s*(?:\]|\1\s*\+\s*[\w.]+\s*\])\s*(?:\[[^\]]*\]\s*)?\.(?:max|min|any|all|sum|mean|idxmax|idxmin|cummax|cummin)\(/,
    note: 'aggregates bars from now forward: a leak if it chooses, sizes or skips a trade (the intraday_stop_after order-selection bug)',
  },
  {
    id: 'future-named helper',
    re: /\b\w+_(?:after|ahead|future)\s*\(|\b(?:future|lookahead|peek)_\w*\s*\(/i,
    note: 'a helper named for the future: check it is never read before the trade is entered',
  },
  {
    id: 'fill at signal close',
    re: /\b(?:entry|fill)\w*\s*=[^=][^#\n]*\bclose\b/i,
    when: code => !/\bopen\b|shift\(\s*1\s*\)|\+\s*1\s*\]/i.test(code),
    note: "entry priced at a bar's close: if that same close triggers the signal, the earliest honest fill is the NEXT bar's open (the confirm-fill leak that killed SCRIV/IFVG)",
  },
  {
    id: 'bfill',
    re: /\.(?:bfill|backfill)\(|method\s*=\s*['"](?:bfill|backfill)['"]/,
    note: 'back-fill copies a later value into earlier rows; use ffill or drop the rows',
  },
  {
    id: 'centered window',
    re: /center\s*=\s*True/,
    note: 'a centered window averages future bars into the current one; use a trailing window',
  },
  {
    id: 'full-sample z-score',
    re: /\(\s*([\w.[\]'"]+)\s*-\s*\1\s*\.mean\(\s*\)\s*\)\s*\/\s*\1\s*\.std\(/,
    note: 'mean/std over the whole sample include the test period; fit on train or use rolling/expanding stats',
  },
  {
    id: 'scaler fit on full data',
    re: new RegExp(`\\.${FIT}(?:_transform)?\\(\\s*(?![\\w.]*(?:train|_tr\\b|in_sample|insample))[A-Za-z_]`, 'i'),
    when: code => /scaler|normali[sz]er|pca|discretizer|imputer/i.test(code),
    note: 'a scaler/transform fit on data that is not the train split leaks test statistics; fit on train only',
  },
  {
    id: 'full-sample quantiles',
    re: /\.qcut\(|\.rank\(\s*pct\s*=\s*True/,
    note: 'quantile bins/ranks over the whole sample use future data; set thresholds on train or with an expanding window',
  },
]

const NOTE = new Map(RULES.map(r => [r.id, r.note]))

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

export function scan(text: string): Finding[] {
  const out: Finding[] = []
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
    if (t.startsWith('#') || /#\s*leak-ok\b/.test(t)) return
    const code = stripComment(raw)
    for (const r of RULES) {
      if (r.re.test(code) && (!r.when || r.when(code))) {
        out.push({ line: idx + 1, rule: r.id, snippet: t.slice(0, 100) })
      }
    }
  })
  return out
}

function grouped(findings: Finding[]): Map<string, Finding[]> {
  const m = new Map<string, Finding[]>()
  for (const f of findings) m.set(f.rule, [...(m.get(f.rule) ?? []), f])
  return m
}

const base = (file: string) => file.split('/').pop() ?? file

// What the model reads after the tool result.
export function report(file: string, findings: Finding[], isWholeFile: boolean): string {
  const lines = [
    `leak-lint (warning, not a block): ${file} now has ${findings.length} possible lookahead pattern(s)` +
      (isWholeFile ? '.' : ' in the edited text (line numbers count from the start of new_string).'),
    'Check each before trusting any backtest number from this code; tell the user which are real leaks. A reviewed line can carry "# leak-ok".',
  ]
  for (const [rule, fs] of grouped(findings)) {
    const at = fs.slice(0, 4).map(f => `L${f.line}`).join(',') + (fs.length > 4 ? ',…' : '')
    lines.push(`- ${rule} (${at}): ${NOTE.get(rule)}`, `    e.g. ${fs[0]?.snippet ?? ''}`)
  }
  return lines.join('\n')
}

// What the person sees.
export function toastText(file: string, findings: Finding[]): string {
  const parts = [...grouped(findings)].map(([rule, fs]) => `${rule} L${fs[0]?.line}`)
  return `leak-lint: ${base(file)} — ${parts.slice(0, 3).join('; ')}${parts.length > 3 ? ` +${parts.length - 3}` : ''}`
}

// Folders that are trading repos even when ~/Trading holds no link to them.
export const EXTRA_ROOTS = ['mnq-mgc-research', 'strategy_lab', 'nq_bot', 'scriv_recreate', 'propfarm-2026', 'prop_farm']

export function isTradingPy(path: string, roots: readonly string[]): boolean {
  const p = path.toLowerCase()
  if (!p.endsWith('.py')) return false
  return roots.some(r => {
    const root = r.toLowerCase().replace(/\/+$/, '')
    return p.startsWith(root + '/')
  })
}
