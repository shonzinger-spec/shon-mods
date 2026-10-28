// Pure logic for claim-check: a capped corpus of numbers seen in tool results
// and user prompts, metric extraction from a reply, and precision-aware matching.

export const CORPUS_CAP_BYTES = 2_000_000

export type Kind = 'PF' | 'Sharpe' | 'WR' | 't'

export type Claim = {
  kind: Kind
  /** The number as written, sign kept, e.g. "-2.17". */
  raw: string
  value: number
  decimals: number
  isPercent: boolean
}

export type Checked = Claim & { isBacked: boolean; nearest: string | null }

type Chunk = { nums: string[]; bytes: number }

// A number not glued to a word or a decimal point before it; a sign counts only
// when nothing word-like precedes it ("t=-2.17" is negative, "1.2-1.5" is not).
const NUM = /(?<![\w.])([-+−]?)(\d+(?:\.\d+)?)(?![\w])/g

export class Corpus {
  private chunks: Chunk[] = []
  private bytes = 0

  add(text: string): void {
    if (!text) return
    const t = text.length > CORPUS_CAP_BYTES ? text.slice(-CORPUS_CAP_BYTES) : text
    const nums = [...new Set(numbersIn(t))]
    if (nums.length === 0) return
    this.chunks.push({ nums, bytes: t.length })
    this.bytes += t.length
    while (this.bytes > CORPUS_CAP_BYTES && this.chunks.length > 1) {
      this.bytes -= this.chunks.shift()!.bytes
    }
  }

  *numbers(): Generator<string> {
    for (const c of this.chunks) yield* c.nums
  }

  clear(): void {
    this.chunks = []
    this.bytes = 0
  }
}

export function numbersIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(NUM)) out.push(`${m[1] === '−' ? '-' : m[1] === '+' ? '' : m[1]}${m[2]}`)
  return out
}

// Markdown emphasis (`**PF**: **1.42**`, `_1.42_`) and one table-cell border
// (`| PF | 1.42 |`) may sit between a label and its number.
const EMPH = String.raw`[*_]*`
const SEP = String.raw`\s*` + EMPH + String.raw`\s*(?:[=:≈~|]|\b(?:of|is|was|at|around|about|near)\b)?\s*` + EMPH + String.raw`\s*`
const VAL = String.raw`([-+−]?\d+(?:\.\d+)?)(\s?%)?(?![A-Za-z0-9]|_+[A-Za-z0-9]|\.\d)`

const LABEL = String.raw`PF|profit[- ]factor|Sharpe(?:\s+ratio)?|win[- ]?rate|WR`

// Word labels: case-insensitive. "Sharpe-like 1.2" fails because "-like" is no separator.
// An underscore may touch the label only as emphasis ("__PF__").
const LABELED = new RegExp(
  String.raw`(?<![A-Za-z0-9'’-]|[A-Za-z0-9]_+)(${LABEL})(?![A-Za-z0-9-]|_+[A-Za-z0-9])` + SEP + VAL,
  'gi',
)
// t-stat: "t-stat 2.1", "t-statistic of 2.1", or a bare lowercase "t" with "=", ":" or a space.
const TSTAT = new RegExp(
  String.raw`(?<![\w'’-])(?:[tT]-stat(?:istic)?(?![\w-])` + SEP + String.raw`|t(?:\s*[=:]\s*|\s+))` + VAL,
  'g',
)

function kindOf(label: string): Kind {
  const l = label.toLowerCase()
  if (l === 'pf' || l.startsWith('profit')) return 'PF'
  if (l.startsWith('sharpe')) return 'Sharpe'
  return 'WR'
}

function claimOf(kind: Kind, num: string, pct: string | undefined): Claim {
  const raw = num.replace('−', '-').replace(/^\+/, '')
  const dot = raw.indexOf('.')
  return { kind, raw, value: Number(raw), decimals: dot < 0 ? 0 : raw.length - dot - 1, isPercent: !!pct }
}

// Markdown tables: a header cell that is a metric label claims the number in
// the same column of every body row ("| PF | Sharpe |" over "| 1.42 | 0.85 |").
const HEADER_LABEL = new RegExp(String.raw`^[*_]*(?:(${LABEL})|(t|t-stat(?:istic)?))[*_]*$`, 'i')
const CELL_VAL = /^[*_]*([-+−]?\d+(?:\.\d+)?)(\s?%)?[*_]*$/
const RULE_CELL = /^:?-{3,}:?$/

type Cell = { text: string; at: number }

function cellsOf(line: string, lineAt: number): Cell[] | null {
  const t = line.trim()
  if (!t.startsWith('|')) return null
  const lead = line.indexOf('|')
  const cells: Cell[] = []
  let start = lead + 1
  for (let i = start; i <= line.length; i++) {
    if (i < line.length && line[i] !== '|') continue
    const raw = line.slice(start, i)
    const pad = raw.length - raw.trimStart().length
    cells.push({ text: raw.trim(), at: lineAt + start + pad })
    start = i + 1
  }
  if (t.endsWith('|') && cells.length > 0 && cells[cells.length - 1]!.text === '') cells.pop()
  return cells
}

function headerKind(cell: string): Kind | null {
  const m = HEADER_LABEL.exec(cell)
  if (!m) return null
  if (m[1]) return kindOf(m[1])
  return m[2] === 'T' ? null : 't' // a bare capital "T" column is not a t-stat
}

function tableClaims(text: string): { at: number; c: Claim }[] {
  const out: { at: number; c: Claim }[] = []
  const lines: { line: string; at: number }[] = []
  let at = 0
  for (const line of text.split('\n')) {
    lines.push({ line, at })
    at += line.length + 1
  }
  for (let i = 0; i + 1 < lines.length; i++) {
    const head = cellsOf(lines[i]!.line, lines[i]!.at)
    const rule = cellsOf(lines[i + 1]!.line, lines[i + 1]!.at)
    if (!head || !rule || rule.length === 0 || !rule.every(c => RULE_CELL.test(c.text))) continue
    const kinds = head.map(c => headerKind(c.text))
    let j = i + 2
    for (; j < lines.length; j++) {
      const row = cellsOf(lines[j]!.line, lines[j]!.at)
      if (!row) break
      row.forEach((cell, k) => {
        const kind = kinds[k]
        const m = kind ? CELL_VAL.exec(cell.text) : null
        if (kind && m) out.push({ at: cell.at + cell.text.indexOf(m[1]!), c: claimOf(kind, m[1]!, m[2]) })
      })
    }
    i = j - 1
  }
  return out
}

/** Where the number of a LABELED / TSTAT match starts: the match ends with VAL. */
function valueAt(m: RegExpMatchArray): number {
  const num = m[m.length - 2]!
  const pct = m[m.length - 1] ?? ''
  return (m.index ?? 0) + m[0].length - num.length - pct.length
}

export function extractClaims(text: string): Claim[] {
  const found: { at: number; c: Claim }[] = []
  for (const m of text.matchAll(LABELED)) found.push({ at: valueAt(m), c: claimOf(kindOf(m[1]!), m[2]!, m[3]) })
  for (const m of text.matchAll(TSTAT)) found.push({ at: valueAt(m), c: claimOf('t', m[1]!, m[2]) })
  // A number already claimed inline ("| PF | 1.42 |" under a "PF" column) counts once.
  const seen = new Set(found.map(f => f.at))
  for (const f of tableClaims(text)) if (!seen.has(f.at)) found.push(f)
  return found.sort((a, b) => a.at - b.at).map(f => f.c)
}

const EPS = 1e-9

/** The values a corpus number may stand for: itself, and for a win rate its percent or fraction form. */
function candidates(claim: Claim, v: number): number[] {
  if (claim.kind !== 'WR') return [v]
  const asPct = claim.isPercent || claim.value > 1
  return asPct ? [v, v * 100] : [v, v / 100]
}

/** Backed when some corpus number rounds (half-up or half-even) to the claim at its decimals. */
export function check(claim: Claim, corpus: Iterable<string>): Checked {
  const tol = 0.5 * 10 ** -claim.decimals + EPS
  let nearest: string | null = null
  let best = Infinity
  for (const s of corpus) {
    const v = Number(s)
    for (const x of candidates(claim, v)) {
      const d = Math.abs(x - claim.value)
      if (d <= tol) return { ...claim, isBacked: true, nearest: s }
      if (d < best) {
        best = d
        nearest = s
      }
    }
  }
  return { ...claim, isBacked: false, nearest }
}

export function label(c: Claim): string {
  return `${c.kind} ${c.raw}${c.isPercent ? '%' : ''}`
}

export function toastText(checked: Checked[]): string | null {
  const bad = checked.filter(c => !c.isBacked)
  if (bad.length === 0) return null
  return `claim-check: ${bad.length} unbacked metric(s): ${bad.map(label).join(', ')}. /claims for detail`
}

export function claimsReport(checked: Checked[] | null): string {
  if (checked === null) return 'claim-check: no reply checked yet this session.'
  if (checked.length === 0) return 'claim-check: the last reply quoted no PF / Sharpe / win-rate / t numbers.'
  const lines = checked.map(c =>
    `${c.isBacked ? 'backed  ' : 'UNBACKED'}  ${label(c)}  (nearest corpus number: ${c.nearest ?? 'none'})`,
  )
  const n = checked.filter(c => !c.isBacked).length
  return [`claim-check: last reply, ${checked.length} metric(s), ${n} unbacked`, ...lines].join('\n')
}
