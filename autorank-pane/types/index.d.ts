export type FollowUp = {
  name: string
  metro: string
  touch: number
  last_date: string
  last_subject: string
  subject_is_older: boolean
  last_any_date: string
  days_since: number
  overdue_days: number
  gap_flag: boolean
}
export type ArStatus = {
  today: string
  last_send_date: string | null
  followups: FollowUp[]
  first_touches: { source: string | null; file_date: string | null; count: number; names: string[] }
  leads: string[]
  gmail_status: { date: string; text: string } | null
  totals: Record<string, number>
  repo: string
}

declare module 'claude-code' {
  interface PluginState {
    'autorank-pane': { status: ArStatus | null; error: string }
  }
}
