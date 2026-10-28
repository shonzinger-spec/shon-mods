export type CostSnapshot = { usd?: number; ratio: number | null }

declare module 'claude-code' {
  interface PluginState {
    'cost-band': { snap: CostSnapshot | null }
  }
}
