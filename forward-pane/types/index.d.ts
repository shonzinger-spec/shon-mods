export type FwdJob = {
  label: string
  name: string
  schedule: string
  running: boolean
  pid: number | null
  last_exit: number | null
  last_run: string | null
  age_min: number | null
  stale: boolean
  stale_reason: string
  errors: string[]
  trades: number | null
  unit: string
  target_n: number | null
  target_note: string
}
export type FwdStatus = { generated_at: string; jobs: FwdJob[] }

declare module 'claude-code' {
  interface PluginState {
    'forward-pane': { status: FwdStatus | null; error: string }
  }
}
