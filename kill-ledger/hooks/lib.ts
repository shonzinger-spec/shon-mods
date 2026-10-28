// kill-ledger: matching a prompt against the index scripts/build_index.py writes.

export type Entry = {
  file: string
  label: string
  section: string
  status: string
  emoji: string
  date: string
  date_src: string
  reason: string
}
export type Index = {
  built_at: string
  memory_dir: string
  entries: Record<string, Entry>
  terms: Record<string, { aliases: string[]; files: string[]; needs_context?: boolean; strict?: boolean }>
}

// A generic term (`?` in vocab.json: `momentum`, `overnight`) needs a trading
// word in the prompt. A strict one (`?!`: `sweep`, `carry`) also needs its
// one-word aliases inside a strategy name (isNamed).
// Only words that mean trading here: "session", "stop", "long", "edge" are
// everyday words in Claude sessions ("carry on in a new session").
const MARKETS = 'nq|mnq|es|mes|mgc|gc|cl|zn|ym|rty|futures?'
const TRADING_WORDS = `${MARKETS}|backtest\\w*|strateg\\w*|trad(?:e|es|ing)|signals?|sharpe|pf|prop[- ]firm|topstep|apex|intraday|forward[- ]test|scalp\\w*|pine|indicator|ohlcv?|1m|5m|15m`
export const TRADING = new RegExp(`\\b(?:${TRADING_WORDS})\\b`, 'i')
// A strict one-word alias ("sweep", "carry") names a strategy only inside a
// name: a trading word right before it ("futures carry", "NQ sweep"), a strategy
// noun right after it, a possessive allowed ("carry strategy", "sweep's entries"),
// or a market right after on/for ("carry on ZN", "sweep for MNQ"; not "on the NQ").
// Bare, it is an everyday word ("parameter sweep", "carry on") even in a trading prompt.
const NAME_NOUNS =
  'strateg(?:y|ies)|strat|trades?|setups?|edges?|signals?|systems?|models?|rules?|legs?|sleeves?|filters?|entr(?:y|ies)|backtests?|ideas?|famil(?:y|ies)|premium|play|method|session|harvest|bot|scalper|variants?'
export type Hit = { entry: Entry; terms: string[] }

const RANK: Record<string, number> = { killed: 0, caution: 1, live: 2 }
// Verdicts worth stopping for: dead, flagged, or already being forward-tested.
const WORD: Record<string, string> = { killed: 'killed', caution: 'caution', live: 'live forward test' }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// `=QT` is case-sensitive; any other alias is not. Whole words only.
export function aliasRe(alias: string): RegExp {
  const cs = alias.startsWith('=')
  const a = cs ? alias.slice(1) : alias
  return new RegExp(`(?<![\\w])${esc(a)}(?![\\w])`, cs ? '' : 'i')
}

const isOneWord = (alias: string) => !/[\s&]/.test(alias.replace(/^=/, '').trim())

type NameRes = { before: RegExp; after: RegExp }
function nameRes(extra: string[] = []): NameRes {
  return {
    before: new RegExp(`(?<![\\w])(?:${[TRADING_WORDS, ...extra].join('|')})[\\s-]+$`, 'i'),
    after: new RegExp(
      `^(?:['’]s)?(?:[\\s-]+(?:${[NAME_NOUNS, ...extra].join('|')})|\\s+(?:on|for)\\s+(?:${MARKETS}))(?![\\w])`,
      'i',
    ),
  }
}
const BASE = nameRes()
// Two generic strategy words side by side are a name too ("overnight carry").
const byIndex = new WeakMap<Index, NameRes>()
function indexRes(idx: Index): NameRes {
  let r = byIndex.get(idx)
  if (!r) {
    const words = Object.values(idx.terms)
      .filter(t => t.needs_context)
      .flatMap(t => t.aliases)
      .filter(isOneWord)
      .map(a => esc(a.replace(/^=/, '')))
    r = nameRes(words)
    byIndex.set(idx, r)
  }
  return r
}

// A strict term's one-word alias counts only as part of a strategy name (see NAME_NOUNS).
export function isNamed(text: string, alias: string, res: NameRes = BASE): boolean {
  const re = aliasRe(alias)
  const all = new RegExp(re.source, `${re.flags}g`)
  for (const m of text.matchAll(all)) {
    const at = m.index ?? 0
    if (res.before.test(text.slice(0, at)) || res.after.test(text.slice(at + m[0].length))) return true
  }
  return false
}

function hasAlias(text: string, alias: string, isStrict: boolean, res: NameRes): boolean {
  return isStrict && isOneWord(alias) ? isNamed(text, alias, res) : aliasRe(alias).test(text)
}

export function match(text: string, idx: Index, seen: ReadonlySet<string>, max = 5): Hit[] {
  const byFile = new Map<string, string[]>()
  const isTrading = TRADING.test(text)
  const res = indexRes(idx)
  for (const [term, t] of Object.entries(idx.terms)) {
    if (t.needs_context && !isTrading) continue
    if (!t.aliases.some(a => hasAlias(text, a, t.strict === true, res))) continue
    for (const f of t.files) byFile.set(f, [...(byFile.get(f) ?? []), term])
  }
  const hits: Hit[] = []
  for (const [f, terms] of byFile) {
    const entry = idx.entries[f]
    if (entry && entry.status in RANK && !seen.has(f)) hits.push({ entry, terms })
  }
  return hits
    .sort(
      (a, b) =>
        (RANK[a.entry.status] ?? 9) - (RANK[b.entry.status] ?? 9) ||
        b.terms.length - a.terms.length ||
        b.entry.date.localeCompare(a.entry.date),
    )
    .slice(0, max)
}

const when = (e: Entry) => (e.date ? `${e.date}${e.date_src === 'file' ? ' (file date)' : ''}` : 'undated')

export function line(h: Hit): string {
  const e = h.entry
  return `- ${e.emoji || '•'} ${WORD[e.status] ?? e.status} ${when(e)} · ${e.file} [${h.terms.join(', ')}]: ${e.reason}`
}

// What the model reads beside the prompt.
export function contextText(hits: Hit[], memoryDir: string): string {
  const terms = [...new Set(hits.flatMap(h => h.terms))]
  return [
    `kill-ledger: this prompt names ${terms.join(', ')}. The memory ledger already holds these verdicts.`,
    'Before re-testing, read the file and tell the user what was already found; a retry needs a NEW pre-registered spec, not a re-run of a killed idea.',
    ...hits.map(line),
    `(files in ${memoryDir})`,
  ].join('\n')
}

// What the person sees.
export function toastText(hits: Hit[]): string {
  const first = hits
    .slice(0, 2)
    .map(h => `${h.terms[0]} ${h.entry.emoji || '•'} ${h.entry.date || 'undated'}`)
    .join(', ')
  return `kill-ledger: ${first}${hits.length > 2 ? ` (+${hits.length - 2})` : ''} — prior verdicts sent to Claude`
}

// Blocks the app injects into a prompt (reminders, side-session notes, task and
// peer messages, command bodies): never the person's own words.
const INJECTED = [
  'system-reminder',
  'side-sessions-event',
  'task-notification',
  'cross-session-message',
  'command-message',
  'command-name',
  'command-args',
  'skill-format',
  'local-command-stdout',
  'local-command-stderr',
  'ci-monitor-event',
]
const INJECTED_RE = new RegExp(`<~?(${INJECTED.join('|')})\\b[^>]*>[\\s\\S]*?(?:<\\/~?\\1>|$)`, 'g')

// The user-authored text left once every injected block is cut out.
export function userText(text: string): string {
  return text.replace(INJECTED_RE, ' ').trim()
}

// Pasted code and logs are data, not the person naming a strategy: fenced and
// inline code, and lines shaped like terminal, log or source text, are cut.
const FENCED_RE = /(```|~~~)[\s\S]*?(?:\1|$)/g
const INLINE_CODE_RE = /`[^`\n]+`/g
// Shapes prose almost never takes: one such line is data.
const STRONG_LINE = new RegExp(
  [
    String.raw`^(?: {4,}|\t)\S`, // indented: code or tool output
    String.raw`^\s*\[?\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}`, // a line that starts with a timestamp
    String.raw`^\s*\[?\d{1,2}:\d{2}:\d{2}\b`, // or with a clock time with seconds
    String.raw`^\s*\[?(?:INFO|WARN(?:ING)?|ERROR|DEBUG|TRACE|FATAL|CRITICAL)\b`, // log level
    // source and tracebacks, in their own syntax ("let me", "import the", "raise the" are prose)
    String.raw`^\s*(?:Traceback \(most recent|File "[^"]+", line \d|at \S+ \(\S*:\d+|raise \w+(?:\(|\s*$)|def \w+\s*\(|class \w+\s*[:(]|import [\w.]+(?: as \w+)?(?:\s*,\s*[\w.]+(?: as \w+)?)*\s*;?\s*$|import .+ from ['"]|from [\w.]+ import \w|(?:export )?(?:const|let|var) [\w{}\[\], ]+\s*[=:]|(?:export )?(?:async )?function\*? ?\w*\s*\(|(?:export )?interface \w+\s*(?:\{|extends|<|$)|(?:export )?type \w+\s*(?:<[^>]*>)?\s*=)`,
  ].join('|'),
)
// Shapes a line of prose can take too ("... and also", "Then ORB {fast}"): data
// only in a run of two or more data lines.
const WEAK_LINE = new RegExp(
  [
    String.raw`^\s*(?:\$|>>>|\.\.\.|PS>|❯|➜)\s`, // shell or REPL prompt
    String.raw`[;{}]\s*$`, // a statement or a brace
    String.raw`^\s*[{\[]\s*(?:"|\{|\[|$)`, // JSON
    String.raw`^\s*\[\s*-?\d[\d.,\s-]*\]?,?\s*$`, // a JSON array of numbers
    String.raw`^\s*\|.*\|\s*$`, // table row
  ].join('|'),
)

export function dropData(text: string): string {
  const lines = text.replace(FENCED_RE, ' ').replace(INLINE_CODE_RE, ' ').split('\n')
  // A one-line prompt is the person talking, whatever shape it has.
  if (lines.filter(l => l.trim()).length <= 1) return lines.join('\n').trim()
  const strong = lines.map(l => STRONG_LINE.test(l))
  const shaped = lines.map((l, i) => strong[i] || WEAK_LINE.test(l))
  const inRun = lines.map((l, i) => {
    if (shaped[i] || !l.trim()) return shaped[i]
    // a plain line between two data-shaped lines is part of that paste
    let p = i - 1
    while (p >= 0 && !lines[p].trim()) p--
    let n = i + 1
    while (n < lines.length && !lines[n].trim()) n++
    return p >= 0 && n < lines.length && shaped[p] && shaped[n]
  })
  // A run (blank lines aside) is data when it holds a strong line or two shaped ones.
  const drop = lines.map(() => false)
  let run: number[] = []
  const close = () => {
    if (run.some(i => strong[i]) || run.filter(i => shaped[i]).length >= 2) for (const i of run) drop[i] = true
    run = []
  }
  lines.forEach((l, i) => {
    if (!l.trim()) return
    if (inRun[i]) run.push(i)
    else close()
  })
  close()
  return lines.filter((_, i) => !drop[i]).join('\n').trim()
}

// The person's own words: injected blocks, then pasted code and logs, cut out.
export function ownWords(text: string): string {
  return dropData(userText(text))
}

// Origins that are not a person asking: skipped.
export const SKIP_ORIGIN = new Set(['task-notification', 'observer', 'scheduled-trigger', 'coordinator'])
