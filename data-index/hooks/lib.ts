// Pure logic for data-index: parse index.json, look rows up, format them.

export type Gap = { start: string; end: string; open_hours: number }
export type Entry = {
  path: string
  realpath?: string
  symbol?: string | null
  tf?: string | null
  rows?: number | null
  start?: string | null
  end?: string | null
  gaps?: number | null
  largest_gap?: Gap | null
  roll?: string | null
  bad?: { id: string; defect: string }[] | null
  gaps_sampled?: boolean
  error?: string
}
export type Index = { generated?: string; partial?: boolean; count?: number; files: Entry[] }

export function parseIndex(text: string): Index | null {
  try {
    const raw = JSON.parse(text) as Partial<Index>
    return Array.isArray(raw.files) ? (raw as Index) : null
  } catch {
    return null
  }
}

const TF_TOKEN = /^(\d+[smhdw]|tick)$/

/**
 * Every whitespace-separated term must hit. A term that is a symbol in the index
 * matches only the symbol field, and a timeframe (one in the index, or shaped
 * like 5m / 1h / tick) only the tf field, so NQ never pulls in MNQ files or a
 * path that merely contains "nq". Any other term is a path substring.
 */
export function query(files: readonly Entry[], q: string): Entry[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const low = (s?: string | null) => (s ?? '').toLowerCase()
  const symbols = new Set(files.map(f => low(f.symbol)).filter(Boolean))
  const tfs = new Set(files.map(f => low(f.tf)).filter(Boolean))
  return files.filter(f =>
    terms.every(t => {
      if (symbols.has(t)) return low(f.symbol) === t
      if (tfs.has(t) || TF_TOKEN.test(t)) return low(f.tf) === t
      return f.path.toLowerCase().includes(t)
    }),
  )
}

/** What a mod can read in one $.fs.read; a larger file rejects. */
export const READ_LIMIT = 4 * 1024 * 1024

/** /data's answer when the index exists but cannot be read (not ENOENT). */
export function unreadableText(path: string, size: number | null, err: string): string {
  if (size != null && size > READ_LIMIT) {
    return `data-index: ${path} is ${(size / 1048576).toFixed(1)} MiB, over the 4 MiB a mod can read, so /data cannot load it and /dataindex will rebuild it just as large. Narrow the scan (skip_dirs / extra_roots in the data-index config.json).`
  }
  return `data-index: cannot read ${path}: ${err.slice(0, 200)}`
}

const day = (s?: string | null) => (s ? s.slice(0, 10) : '?')

export function formatRow(f: Entry): string {
  const gaps = f.gaps == null ? 'gaps ?' : `${f.gaps} gaps${f.gaps_sampled ? ' (sampled)' : ''}${f.largest_gap ? `, max ${f.largest_gap.open_hours}h @${day(f.largest_gap.start)}` : ''}`
  const rows = f.rows == null ? '? rows' : `${f.rows.toLocaleString('en-US')} rows`
  const flag = f.bad?.length ? `BAD: ${f.bad.map(b => b.defect).join('; ')}` : f.error ? `unreadable: ${f.error}` : 'clean'
  return `${f.symbol ?? '-'} ${f.tf ?? '-'} | ${day(f.start)} -> ${day(f.end)} | ${rows} | ${gaps} | roll ${f.roll ?? 'unknown'} | ${flag}\n  ${f.path}`
}

export function lookupText(idx: Index | null, q: string, limit = 40): string {
  if (!idx) return 'data-index: no index yet (or it is unreadable): run /dataindex'
  const head = `index ${idx.generated ?? '?'}${idx.partial ? ' (PARTIAL: run /dataindex again)' : ''}, ${idx.files.length} files`
  if (!q.trim()) return `Usage: /data <symbol|tf|text>, e.g. /data NQ 1m\n${head}`
  const hits = query(idx.files, q)
  if (hits.length === 0) return `data-index: no files match "${q.trim()}" (${head})`
  const more = hits.length > limit ? `\n... ${hits.length - limit} more; narrow the query` : ''
  return `${hits.length} match "${q.trim()}" (${head})\n${hits.slice(0, limit).map(formatRow).join('\n')}${more}`
}

/** Toast text from the script's last stdout line. */
export function summaryText(stdout: string): string {
  const last = stdout.trim().split('\n').pop() ?? ''
  try {
    const r = JSON.parse(last) as { ok?: boolean; error?: string; count?: number; bad?: number; partial?: boolean; seconds?: number }
    if (r.error) return `data-index failed: ${r.error}`
    if (r.ok) return `data-index: ${r.count} files (${r.bad} flagged bad) in ${r.seconds}s${r.partial ? ' (partial: run /dataindex again to finish)' : ''}`
  } catch {
    // fall through
  }
  return 'data-index failed: no summary from the build script'
}
