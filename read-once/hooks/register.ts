import type { Register } from 'claude-code'

import { type Ledger, clear, forget, isNonText, isRanged, keyOf, record, refusal } from './lib.ts'

const WRITERS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

export const register: Register = on => {
  // In memory, per session. Keyed by agent too: a subagent has its own context,
  // so what the main conversation read is not in the subagent's head.
  const ledger: Ledger = new Map()

  // Before a Read runs: refuse a whole-file re-read of an unchanged file. After
  // it succeeds: remember it. After a Write/Edit/MultiEdit/NotebookEdit: forget.
  on('tool.call', async ($, e, next) => {
    const agent = keyOf((e as { agentId?: string }).agentId)
    let path: string | undefined
    let stat: { mtimeMs: number; size: number } | undefined
    try {
      if (e.tool === 'Read') {
        const r = e as { file_path?: string; offset?: unknown; limit?: unknown; pages?: unknown }
        if (r.file_path && !isRanged(r) && !isNonText(r.file_path)) {
          const st = await $.fs.stat(r.file_path)
          if (st.kind === 'file') {
            const now = { mtimeMs: st.mtimeMs, size: st.size }
            const why = refusal(ledger, agent, r.file_path, now)
            if (why) return { deny: why }
            path = r.file_path
            stat = now
          }
        }
      } else if (WRITERS.has(e.tool)) {
        const w = e as { file_path?: string; notebook_path?: string }
        const p = w.file_path ?? w.notebook_path
        if (p) forget(ledger, agent, p)
      }
    } catch {
      // Unreadable stat or any bookkeeping fault: let the Read run.
    }

    const ran = await next(e)

    try {
      if (path && stat && ran.deny === undefined && !ran.isError) {
        const res = ran.result as { type?: string; file?: { truncatedByTokenCap?: boolean } } | undefined
        const whole = res?.type === undefined || res.type === 'text'
        if (whole && !res?.file?.truncatedByTokenCap) record(ledger, agent, path, stat, Number(await $.session.turns()) || 0)
      }
    } catch {
      // Not recorded: the next Read of it simply runs.
    }
    return ran
  }).catch(($, e, next) => next(e))

  // The earlier text may be gone from context once the conversation compacts
  // (a precompute counts too: its result can be installed later without another
  // event). A vetoed compaction keeps the ledger.
  on('session.compact', async ($, e, next) => {
    const ran = await next(e)
    try {
      if (ran.skip === undefined) clear(ledger, keyOf(e.agentId))
    } catch {
      // Ledger left as is.
    }
    return ran
  }).catch(($, e, next) => next(e))
}
