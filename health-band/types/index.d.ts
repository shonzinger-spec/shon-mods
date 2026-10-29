/** `affects`: on a shared-cause row (lse-gone), the jobs it breaks. `subject` / `detail`: a forward-job row's job name and its full error line. */
export type HealthIssue = { level: 'red' | 'amber'; check: string; text: string; affects?: string[]; subject?: string; detail?: string }
export type JobCount = { agent: string; ok: number; running: number; failed: number }
/** Gauges drawn on every report; a null item's source was unreadable. */
export type HealthStats = { lse: { count: number; limit: number } | null; jobs: JobCount[] | null; overhead_tokens: number | null }
export type HealthReport = { level: 'red' | 'amber' | 'ok'; issues: HealthIssue[]; checked_at: string; stats?: HealthStats }

declare module 'claude-code' {
  interface PluginState {
    'health-band': { report: HealthReport | null; isHidden: boolean }
  }
}
