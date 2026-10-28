export type MemSnap = {
  level: 'ok' | 'warn' | 'critical'
  pressure: 'normal' | 'warn' | 'critical' | 'unknown'
  swapTotalMB: number
  swapUsedMB: number
  topName: string | null
  topMb: number
  at: number
  freePct?: number
  memTotalMB?: number
  top?: { name: string; mb: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    'memory-guard': { snap: MemSnap | null; dismissed: { level: 'warn' | 'critical'; at: number } | null }
  }
}
