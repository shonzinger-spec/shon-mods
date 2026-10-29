// experiment-ledger: pure logic for `/experiments open` (no $). Which preregistrations have no
// verdict yet, and how old they are.
//
// Two on-disk conventions (copied from the prereg mod's hooks/lib.ts, not imported across mods):
//   json:   <root>/prereg/<slug>.json (schema prereg/1: slug, created_at) locked by <root>/prereg/<slug>.result.json
//   legacy: <dir>/PREREGISTRATION_<tag>.md + <dir>/PREREG_<tag>.sha256 (frozen at the sha file's mtime),
//           locked by <dir>/PREREG_<tag>_RESULT.sha256. An amendment is its own tag (v62_A1).
// Verdict evidence: a ledger row with the slug (write_verdict(slug=...)) or a sibling <root>/verdict.json
// whose slug matches.

export const DAY_MS = 86_400_000
export const WARN_DAYS = 7
export const RED_DAYS = 30

export type Entry = { mtimeMs: number; path: string }
export type Kind = 'json' | 'legacy'
export type PreregRow = {
  key: string // slug (json) or tag (legacy): what ack / unack take
  kind: Kind
  slug: string
  dir: string // json: the folder holding prereg/ (where verdict.json sits); legacy: the folder holding the files
  file: string // json: the prereg .json path (to read created_at); legacy: the sha256 or md path
  frozenMs: number
  resultMs: number | null
}
export type State = 'open' | 'unlogged' | 'done'
export type Item = PreregRow & { state: State; ageDays: number; verdict?: string; acked: boolean }
export type BandLine = { text: string; color: 'yellow' | 'red' }

// `stat -f '%m %N'` lines: "<epoch seconds> <path>". The path may hold spaces, so split at the first space only.
export function parseScan(stdout: string): Entry[] {
  const out: Entry[] = []
  for (const ln of stdout.split('\n')) {
    const i = ln.indexOf(' ')
    if (i < 1) continue
    const secs = Number(ln.slice(0, i))
    const path = ln.slice(i + 1)
    if (!Number.isFinite(secs) || !path) continue
    out.push({ mtimeMs: secs * 1000, path })
  }
  return out
}

const JSON_RE = /^(.*)\/prereg\/([^/]+?)(\.result)?\.json$/
const LEGACY_MD = /^(.*)\/PREREGISTRATION_([^/]+)\.md$/
const LEGACY_SHA = /^(.*)\/PREREG_([^/]+?)(_RESULT)?\.sha256$/

// Legacy preregs live directly in the scan root (~/propfarm-2026); the same names deeper down are
// experiment copies and other layouts with no RESULT convention, so only json preregs count there.
export function topLevelLegacy(entries: readonly Entry[], root: string): Entry[] {
  return entries.filter(en => JSON_RE.test(en.path) || en.path.slice(0, en.path.lastIndexOf('/')) === root)
}

// Group scanned files into one row per prereg. A result file alone (no prereg file) makes no row.
export function collect(entries: readonly Entry[]): PreregRow[] {
  const rows = new Map<string, PreregRow>()
  const results = new Map<string, number>()
  const legacy = (dir: string, tag: string, file: string, ms: number, isResult: boolean, isSha: boolean): void => {
    const id = `legacy\0${dir}\0${tag}`
    if (isResult) {
      results.set(id, ms)
      return
    }
    const cur = rows.get(id)
    // the sha file's mtime is the freeze time; the .md is only the fallback when there is no sha
    if (cur && !isSha) return
    rows.set(id, { key: tag, kind: 'legacy', slug: tag, dir, file, frozenMs: ms, resultMs: null })
  }
  for (const { mtimeMs: ms, path } of entries) {
    const j = JSON_RE.exec(path)
    if (j) {
      const root = j[1] ?? ''
      const slug = j[2] ?? ''
      const id = `json\0${root}\0${slug}`
      if (j[3]) results.set(id, ms)
      else rows.set(id, { key: slug, kind: 'json', slug, dir: root, file: path, frozenMs: ms, resultMs: null })
      continue
    }
    // anything else inside a prereg/ folder (.sha256 siblings, notes) is not a legacy prereg
    if (/\/prereg\/[^/]+$/.test(path)) continue
    const md = LEGACY_MD.exec(path)
    if (md) {
      legacy(md[1] ?? '', md[2] ?? '', path, ms, false, false)
      continue
    }
    const sha = LEGACY_SHA.exec(path)
    if (sha) legacy(sha[1] ?? '', sha[2] ?? '', path, ms, Boolean(sha[3]), true)
  }
  for (const [id, r] of rows) r.resultMs = results.get(id) ?? null
  return [...rows.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.dir < b.dir ? -1 : 1))
}

// created_at of a prereg/1 file, in ms; null when absent or not a date.
export function createdMs(text: string): number | null {
  try {
    const d: unknown = JSON.parse(text)
    const c = typeof d === 'object' && d !== null ? (d as Record<string, unknown>).created_at : undefined
    const ms = typeof c === 'string' ? Date.parse(c) : Number.NaN
    return Number.isFinite(ms) ? ms : null
  } catch {
    return null
  }
}

// slug and verdict of a verdict.json (verdict/2); null when it has no slug.
export function verdictJson(text: string): { slug: string; verdict: string } | null {
  try {
    const d: unknown = JSON.parse(text)
    if (typeof d !== 'object' || d === null) return null
    const o = d as Record<string, unknown>
    if (typeof o.slug !== 'string' || !o.slug) return null
    return { slug: o.slug, verdict: typeof o.verdict === 'string' && o.verdict ? o.verdict : 'logged' }
  } catch {
    return null
  }
}

const days = (from: number, now: number): number => Math.max(0, Math.floor((now - from) / DAY_MS))

// open: no result marker and no verdict. unlogged: a json prereg locked by a result but no verdict anywhere
// (age counts from the result). done: anything else; a legacy prereg with a RESULT marker is done because
// legacy tags carry no link to the ledger.
export function classify(rows: readonly PreregRow[], verdicts: ReadonlyMap<string, string>, acked: ReadonlySet<string>, nowMs: number): Item[] {
  return rows.map(r => {
    const verdict = verdicts.get(r.slug)
    const isAcked = acked.has(r.key)
    if (verdict !== undefined) return { ...r, state: 'done', ageDays: days(r.frozenMs, nowMs), verdict, acked: isAcked }
    if (r.resultMs === null) return { ...r, state: 'open', ageDays: days(r.frozenMs, nowMs), acked: isAcked }
    if (r.kind === 'json') return { ...r, state: 'unlogged', ageDays: days(r.resultMs, nowMs), acked: isAcked }
    return { ...r, state: 'done', ageDays: days(r.frozenMs, nowMs), acked: isAcked }
  })
}

// Pending = waiting on a verdict and not acked, oldest first.
export function pending(items: readonly Item[]): Item[] {
  return items.filter(i => i.state !== 'done' && !i.acked).sort((a, b) => b.ageDays - a.ageDays || (a.key < b.key ? -1 : 1))
}

const tag = (i: Item): string => {
  if (i.state === 'done') return `done${i.verdict ? ` ${i.verdict}` : ' (result marker)'}`
  return i.state === 'unlogged' ? 'unlogged (result recorded, no verdict row)' : 'open'
}

export function listText(items: readonly Item[], all: boolean): string {
  const pend = pending(items)
  const open = pend.filter(i => i.state === 'open').length
  const hiddenAcked = items.filter(i => i.state !== 'done' && i.acked).length
  const out = [
    `prereg: ${pend.length} waiting on a verdict (${open} open, ${pend.length - open} unlogged)` +
      (hiddenAcked ? `, ${hiddenAcked} acked and hidden` : '') +
      (all ? `, ${items.length} total` : ''),
  ]
  const line = (i: Item): string => `  ${i.key}  ${i.ageDays}d  ${tag(i)}  [${i.kind}] ${i.dir}`
  if (pend.length === 0) out.push('  nothing waiting')
  for (const i of pend) out.push(line(i))
  if (all) {
    const ack = items.filter(i => i.state !== 'done' && i.acked)
    if (ack.length) out.push('acked (hidden from the band):')
    for (const i of ack) out.push(`${line(i)}  ACKED`)
    const done = items.filter(i => i.state === 'done').sort((a, b) => a.ageDays - b.ageDays || (a.key < b.key ? -1 : 1))
    if (done.length) out.push('done:')
    for (const i of done) out.push(line(i))
  }
  out.push('/experiments open all | open ack <slug|tag> | open unack <slug|tag>')
  return out.join('\n')
}

// Pending, unacked, and the oldest at least warnDays old -> one line; red from RED_DAYS.
export function bandLine(items: readonly Item[], warnDays = WARN_DAYS): BandLine | null {
  const pend = pending(items)
  const oldest = pend[0]
  if (!oldest || oldest.ageDays < warnDays) return null
  return {
    text: `prereg: ${pend.length} waiting on a verdict, oldest ${oldest.ageDays}d (${oldest.key}). /experiments open`,
    color: oldest.ageDays >= RED_DAYS ? 'red' : 'yellow',
  }
}

export type Resolved = { key: string } | { matches: string[] }

// ack / unack target: the exact key, else the same ignoring case, else a unique key ending with the text.
// `matches` lists every candidate when none or several qualify (none -> empty list).
export function resolveKey(items: readonly Item[], query: string): Resolved {
  const q = query.trim()
  const keys = [...new Set(items.map(i => i.key))]
  if (keys.includes(q)) return { key: q }
  const lower = q.toLowerCase()
  const ci = keys.filter(k => k.toLowerCase() === lower)
  if (ci.length === 1) return { key: ci[0] as string }
  const suffix = keys.filter(k => k.toLowerCase().endsWith(lower))
  if (q && suffix.length === 1) return { key: suffix[0] as string }
  return { matches: q ? suffix : [] }
}
