import type { ArStatus, FollowUp } from '../types'

// Due inside the cadence, vs lapsed: a gap over 10 days since the last touch,
// which the repo's send-pack flags (restarting those is a decision, not a send).
export function split(s: ArStatus): { due: FollowUp[]; lapsed: FollowUp[] } {
  return { due: s.followups.filter(f => !f.gap_flag), lapsed: s.followups.filter(f => f.gap_flag) }
}

export function followUpLine(f: FollowUp): string {
  const subj = f.last_subject ? `“${f.last_subject.slice(0, 70)}”${f.subject_is_older ? ' (thread)' : ''}` : '(subject not logged)'
  return `T${f.touch} ${f.name}${f.metro ? ` (${f.metro})` : ''} · last email ${f.last_date} ${subj}`
}

export function summary(s: ArStatus): string {
  const { due, lapsed } = split(s)
  return `${due.length} follow-ups due · ${lapsed.length} lapsed >10d · ${s.first_touches.count} first touches queued · ${s.leads.length} lead notes`
}
