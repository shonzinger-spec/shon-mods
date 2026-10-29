import type { Latest } from '../types'

export const SECTION_ID = 'friction-review:unread'

/** latest.json text -> Latest, or null when it is missing or not a usable report. */
export function parseLatest(text: string): Latest | null {
  try {
    const v = JSON.parse(text) as Partial<Latest>
    if (!v || typeof v.date !== 'string' || typeof v.path !== 'string') return null
    const patterns = v.counts?.patterns
    if (typeof patterns !== 'number') return null
    return {
      date: v.date,
      path: v.path,
      counts: { total: typeof v.counts?.total === 'number' ? v.counts.total : 0, patterns },
      top3: Array.isArray(v.top3) ? v.top3.filter(p => p && typeof p.pattern === 'string' && typeof p.count === 'number') : [],
    }
  } catch {
    return null
  }
}

/** read.json text -> the date of the last report the person read, or null. */
export function parseReadDate(text: string): string | null {
  try {
    const v = JSON.parse(text) as { date?: unknown }
    return typeof v?.date === 'string' ? v.date : null
  } catch {
    return null
  }
}

/** A report is unread when it found at least one pattern and its date is not the last one read. */
export function isUnread(latest: Latest | null, readDate: string | null): boolean {
  return latest !== null && latest.counts.patterns > 0 && latest.date !== readDate
}

export function bandText(latest: Latest): string {
  return `Weekly friction report ready (${latest.counts.patterns} patterns) - /friction`
}

export function commandText(latest: Latest | null): string {
  if (!latest) return 'No friction report yet. The Friday 17:00 job writes one to ~/.claude/friction-review/reports/ (run friction-review/scripts/install.sh once to schedule it).'
  if (latest.counts.patterns === 0) return `Friction report ${latest.date}: no patterns found.\n${latest.path}`
  const rows = latest.top3.map(p => `  ${p.count}x ${p.pattern} (${p.sessions} sessions)`)
  return [`Friction report ${latest.date}: ${latest.counts.patterns} patterns, ${latest.counts.total} hits. Top:`, ...rows, `Full report: ${latest.path}`].join('\n')
}

export function sectionText(latest: Latest): string {
  return `An unread weekly friction report exists at ${latest.path}. Offer once to read it and draft fix-mod specs for the top patterns; do not build without approval.`
}
