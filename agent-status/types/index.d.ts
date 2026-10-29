export type UserFix = { label: string; command?: string; url?: string }
export type Agent = {
  id: string
  name: string
  model: string | null
  model_label: string | null
  works: boolean | null
  state: 'ok' | 'down' | 'unknown' | 'disabled' | string
  reason: string | null
  user_fix: UserFix | null
  last_run: { at: string; verdict: string } | null
  fallback: string[]
  checked: string | null
}
export type Evt = { at: string; lane: string; kind: 'context-switch' | 'context-exhausted' | string; from: string; to: string | null; text: string }
export type Health = { checked_at: string; agents: Agent[]; events: Evt[] }

declare module 'claude-code' {
  interface PluginState {
    'agent-status': { health: Shaped<Health | null>; error: string; pinging: Shaped<string[]>; dismissed: string; shown: number | null; checking: boolean }
  }
}
