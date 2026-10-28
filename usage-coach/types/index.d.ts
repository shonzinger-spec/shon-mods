export type UsageSnap = {
  weekly: number
  daysLeft: number | null
  allowance: number | null
  spentToday: number | null
  parallel: number
  pctPerUSD: number | null
  next: string | null
}

export type SectionState = {
  name: string | null
  source: 'command' | 'sidebar' | 'keyword' | null
  prompt: string | null
  checkedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-coach': { snap: UsageSnap | null; section: SectionState }
  }
}
