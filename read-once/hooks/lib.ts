// read-once: pure bookkeeping, no engine calls.

export type Entry = { mtimeMs: number; size: number; turn: number }
export type Stat = { mtimeMs: number; size: number }

/** Per context (main conversation or one subagent): file path -> its last whole-file read. */
export type Ledger = Map<string, Map<string, Entry>>

export const MAIN = 'main'

/** Files Read presents as image, PDF or notebook: never refused. */
const NON_TEXT = /\.(png|jpe?g|gif|webp|pdf|ipynb)$/i
export const isNonText = (path: string): boolean => NON_TEXT.test(path)

/** True when the Read asks for a part of the file or a page range rather than the whole. */
export function isRanged(e: { offset?: unknown; limit?: unknown; pages?: unknown }): boolean {
  return e.offset !== undefined || e.limit !== undefined || e.pages !== undefined
}

export const keyOf = (agentId: string | undefined): string => agentId || MAIN

function bucket(l: Ledger, agent: string): Map<string, Entry> {
  let b = l.get(agent)
  if (!b) l.set(agent, (b = new Map()))
  return b
}

/** The refusal text when `path` was read whole at the same mtime and size, else undefined. */
export function refusal(l: Ledger, agent: string, path: string, now: Stat): string | undefined {
  const prev = l.get(agent)?.get(path)
  if (!prev || prev.mtimeMs !== now.mtimeMs || prev.size !== now.size) return undefined
  return `read-once: ${path} is unchanged since last read at turn ${prev.turn}; use the earlier content, or pass offset/limit to re-read a range`
}

export function record(l: Ledger, agent: string, path: string, st: Stat, turn: number): void {
  bucket(l, agent).set(path, { mtimeMs: st.mtimeMs, size: st.size, turn })
}

/** A Write/Edit/MultiEdit/NotebookEdit touched `path`: the next Read is a fresh one. */
export function forget(l: Ledger, agent: string, path: string): void {
  l.get(agent)?.delete(path)
}

/** Compaction: the whole ledger when the main conversation compacted, else that subagent's. */
export function clear(l: Ledger, agent: string): void {
  if (agent === MAIN) l.clear()
  else l.delete(agent)
}
