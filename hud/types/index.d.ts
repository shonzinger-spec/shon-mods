export type EffortNow = { level: string; ultracode: boolean; reason: string; source: 'auto' | 'forced' | 'yours'; at: number }
export type MemNow = { level: 'ok' | 'warn' | 'critical'; freePct?: number; memTotalMB?: number; swapUsedMB: number; swapTotalMB: number; at: number }
export type Trend = { prev: string | null; level: string | null; since: number }

declare module 'claude-code' {
  interface PluginState {
    hud: { effort: EffortNow | null; mem: MemNow | null; trend: Trend; placement: string; anim: { cells: number | null; flash: boolean; pct: number | null } }
  }
}
