export type PreregBand = { line: { text: string; color: 'yellow' | 'red' } | null }

declare module 'claude-code' {
  interface PluginState {
    'experiment-ledger': { snap: PreregBand | null }
  }
}
