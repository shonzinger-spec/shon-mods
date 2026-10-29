export type Pattern = { pattern: string; count: number; sessions: number }

/** The newest report, as scripts/friction/scan.py writes it to ~/.claude/friction-review/latest.json. */
export type Latest = {
  date: string
  path: string
  counts: { total: number; patterns: number }
  top3: Pattern[]
}

declare module 'claude-code' {
  interface PluginState {
    'friction-review': { unread: Latest | null }
  }
}
