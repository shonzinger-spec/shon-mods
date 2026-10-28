export type Cfg = { idleDays: number; maxPerRun: number }
export type Row = {
  sessionId: string
  title?: string
  name?: string
  isArchived?: boolean
  isRunning?: boolean
  lastActivityAt?: string
  pinned?: boolean
  startedBy?: string
  exempt?: boolean
}
export type Pick = { row: Row; idleDays: number }

export const DAY = 86_400_000
export const GATE_MS = 20 * 3_600_000

export function mergeCfg(raw: unknown): Cfg {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const num = (v: unknown, d: number, min: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : d)
  return { idleDays: num(r.idleDays, 14, 3), maxPerRun: num(r.maxPerRun, 25, 1) }
}

export function titleOf(r: Row): string {
  return r.title || r.name || r.sessionId
}

export function parseRows(text: string): Row[] {
  const j = JSON.parse(text)
  const arr = Array.isArray(j) ? j : Array.isArray(j?.sessions) ? j.sessions : []
  return arr.filter((r: unknown): r is Row => !!r && typeof (r as Row).sessionId === 'string')
}

const at = (r: Row): number => {
  const t = Date.parse(r.lastActivityAt ?? '')
  return Number.isNaN(t) ? Infinity : t // unknown activity counts as fresh: never archived
}

// Idle chats safe to archive, oldest first, capped. `protectedRows` = the rest, with the reason.
export function pickIdle(rows: Row[], nowMs: number, cfg: Cfg, selfId: string): Pick[] {
  const cutoff = nowMs - cfg.idleDays * DAY
  const busyParents = new Set<string>()
  for (const r of rows) if (r.startedBy && (r.isRunning || at(r) > cutoff)) busyParents.add(r.startedBy)
  return rows
    .filter(r => !r.isArchived && !r.isRunning && r.pinned !== true && r.exempt !== true && at(r) < cutoff && r.sessionId !== selfId && !busyParents.has(r.sessionId))
    .sort((a, b) => at(a) - at(b))
    .slice(0, cfg.maxPerRun)
    .map(row => ({ row, idleDays: Math.floor((nowMs - at(row)) / DAY) }))
}

export function protectedCount(rows: Row[], picks: Pick[]): string {
  const ids = new Set(picks.map(p => p.row.sessionId))
  const open = rows.filter(r => !r.isArchived && !ids.has(r.sessionId))
  const n = (f: (r: Row) => boolean) => open.filter(f).length
  return `${open.length} kept open (pinned ${n(r => r.pinned === true)}, running ${n(r => !!r.isRunning)}, recent or in use ${n(r => !r.pinned && !r.isRunning)})`
}

export function wasSkipped(isError: boolean | undefined, text: string): boolean {
  return !!isError || /not archived|still working|pinned|open on screen|can'?t|cannot|refus|unable|failed/i.test(text)
}

export function logSection(iso: string, lines: string[]): string {
  return `\n## ${iso}\n${lines.join('\n')}\n`
}

// Re-check one chat right before archiving it (get_session's answer): it must still
// be open, idle past the cutoff, not running and not pinned.
export function stillIdle(text: string, cutoffMs: number): boolean {
  try {
    const d = JSON.parse(text)
    const t = Date.parse(d?.lastActivityAt ?? '')
    return !!d && d.isArchived !== true && d.isRunning !== true && d.pinned !== true && !Number.isNaN(t) && t < cutoffMs
  } catch {
    return false
  }
}
