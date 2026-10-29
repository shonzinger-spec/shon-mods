export type Candidate = { sessionId: string; title: string; score: number; reason: 'title' | 'prompt'; idleMs: number }

declare module 'claude-code' {
  interface PluginState {
    'one-chat-guard': {
      /** Open chats that look like this one, newest first (at most 3). */
      candidates: Candidate[]
      /** True once the person pressed Keep or Open: no band for the rest of the session. */
      dismissed: boolean
      /** Checks done for this chat: 1 after the first prompt, 2 after the first finished turn. */
      stage: number
    }
  }
}
