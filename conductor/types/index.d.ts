export type Band = {
  on: boolean
  mode: string
  routesError: string | null
  errors: number
  last: { desc: string; cls: string; model: string; effort?: string; applied?: string } | null
  main?: string
}

declare module 'claude-code' {
  interface PluginState {
    conductor: { band: Band | null; pane: { tab: 'routes' | 'bus'; rev: number } }
  }
}
