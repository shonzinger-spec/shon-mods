export type Item = {
  sid8: string
  title: string
  date: string
  status: 'saved' | 'live' | 'failed' | 'stuck'
  reason: string
  job: 'archive' | 'melxis' | null
  idle_min: number | null
  has_note: boolean
}
export type Heal = {
  action: 'idle' | 'running' | 'waiting' | 'started' | 'launch_error'
  job: 'archive' | 'melxis' | null
  attempts: number
  cap: number
  struggling?: boolean
  next_at: number | null
  history: { at: number; job: string; ok: boolean; msg: string; failed: number }[]
}
export type SyncStatus = {
  generated_at: string
  totals: { total: number; saved: number; live: number; failed: number; stuck: number }
  stages: { backup: number; note: number; melxis: number; eligible: number }
  problems: Item[]
  live: Item[]
  heal: Heal | null
  jobs: { archive: { running: boolean; log: string[] }; melxis: { running: boolean; log: string[] } }
}

export type Usage = { context: number; windows: { kind: string; percent: number; resetsAt?: string }[] }
export type Alert = { level: 'red' | 'amber' | string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'brain-sync': { status: Shaped<SyncStatus | null>; error: string; checking: boolean; usage: Shaped<Usage | null>; alerts: Shaped<Alert[]> }
  }
}
