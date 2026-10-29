// Step 5: the thread envelope `[cx id re hop from]` that session.send adds to each peer message.
// Used ONLY to group threads in the pane (and to number hops on this session's own replies).
// session.receive has no verified sender, so no receive guard or trust decision reads it.

export type Env = { id: string; re: string | null; hop: number; from: string }

const ENV_RE = /\[cx id=(\S+) re=(\S+) hop=(\d+) from=(\S+?)\]/

export function formatEnv(env: Env): string {
  return `[cx id=${env.id} re=${env.re ?? '-'} hop=${env.hop} from=${env.from}]`
}

/** The first envelope anywhere in the text (the engine may wrap the body), or null. */
export function parseEnv(text: string): Env | null {
  const m = ENV_RE.exec(text)
  if (!m) return null
  const hop = Number(m[3])
  if (!Number.isSafeInteger(hop) || hop < 1) return null
  return { id: m[1], re: m[2] === '-' ? null : m[2], hop, from: m[4] }
}

/** A bus row as written to ~/.claude/conductor/bus/<date>-<session>.jsonl. */
export type BusRow = {
  type: 'send' | 'receive' | 'held' | 'refused' | 'flag' | 'wake' | 'spend' | 'start' | 'ask'
  ts: string
  /** The writing session's id (each session has its own bus file). */
  session: string
  id?: string | null
  re?: string | null
  hop?: number | null
  from?: string | null
  to?: string | null
  /** For receive rows: whether the delivery counted toward the receive caps. */
  counted?: boolean
  reason?: string
  usd?: number
  text?: string
  /** For start rows (step 6): the class /conductor session started. */
  cls?: string
}

/**
 * Groups send/receive rows into threads by envelope id/re, for the pane.
 * Root of a row: follow `re` through ids seen in the rows; a `re` nobody logged is its own root,
 * so two replies to the same unlogged question still share a thread. Rows without an id are skipped.
 */
export function threads(rows: readonly BusRow[]): Map<string, BusRow[]> {
  const byId = new Map<string, BusRow>()
  for (const r of rows) if ((r.type === 'send' || r.type === 'receive') && r.id) byId.set(r.id, r)
  const rootOf = (r: BusRow): string => {
    let cur = r
    const seen = new Set<string>()
    while (cur.re && !seen.has(cur.re)) {
      seen.add(cur.re)
      const up = byId.get(cur.re)
      if (!up) return cur.re
      cur = up
    }
    return cur.id as string
  }
  const out = new Map<string, BusRow[]>()
  for (const r of rows) {
    if ((r.type !== 'send' && r.type !== 'receive') || !r.id) continue
    const root = rootOf(r)
    const list = out.get(root) ?? []
    list.push(r)
    out.set(root, list)
  }
  return out
}

/** Rows of a bus file's text; a torn line from a crash mid-write is dropped. */
export function parseBus(text: string): BusRow[] {
  const rows: BusRow[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (r && typeof r.type === 'string' && typeof r.ts === 'string' && typeof r.session === 'string') rows.push(r)
    } catch {
      // torn line
    }
  }
  return rows
}
