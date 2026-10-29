export type ChatStatus = 'stalled' | 'waiting' | 'working' | 'done'

export type ChatRow = {
  sessionId: string
  title: string
  status: ChatStatus
  kind: 'limit' | 'error' | 'unanswered' | null
  question: string | null
  question_source: 'wrap_up' | 'ask_user' | 'text' | 'summary' | null
  last_activity_ms: number | null
  error: string | null
  // set only on stalled rows with error text; absent on rows from older scanners
  error_at_ms?: number | null
  limit?: { kind: 'session' | 'weekly' | 'rate'; reset_at_ms: number | null } | null
}

// sent.json: `sessionId:errorAt` -> when the continue message was sent
export type SentLog = Record<string, number>

export type Scan = { now_ms: number; rows: ChatRow[] }

declare module 'claude-code' {
  interface PluginState {
    'needs-you': { scan: Scan | null; error: string }
  }
}
