import type { FwdJob } from '../types'

export type Tone = 'red' | 'yellow' | 'green'

export function tone(j: FwdJob): Tone {
  if (j.stale || (j.last_exit !== null && j.last_exit !== 0 && !j.running)) return 'red'
  if (j.errors.length > 0) return 'yellow'
  return 'green'
}

const ORDER: Record<Tone, number> = { red: 0, yellow: 1, green: 2 }

// Problems first, then by name.
export function sorted(jobs: readonly FwdJob[]): FwdJob[] {
  return [...jobs].sort((a, b) => ORDER[tone(a)] - ORDER[tone(b)] || a.name.localeCompare(b.name))
}

export function ago(min: number | null): string {
  if (min === null) return 'never'
  if (min < 60) return `${min}m ago`
  if (min < 48 * 60) return `${Math.round(min / 60)}h ago`
  return `${Math.round(min / 1440)}d ago`
}

export function countText(j: FwdJob): string {
  if (j.trades === null) return ''
  return j.target_n ? `${j.trades}/${j.target_n} ${j.unit}` : `${j.trades} ${j.unit}`
}

export function summary(jobs: readonly FwdJob[]): string {
  const red = jobs.filter(j => tone(j) === 'red').length
  const yellow = jobs.filter(j => tone(j) === 'yellow').length
  return `${jobs.length} jobs · ${red} red · ${yellow} with errors`
}
