// Pure logic for usage-coach: no $ calls, so every rule is testable on plain data.

export type Size = 'S' | 'M' | 'L' | 'XL'
export const SIZES: readonly Size[] = ['S', 'M', 'L', 'XL']

export type Cfg = {
  aliases: Record<string, string>
  keywords: Record<string, string[]>
  priors: Record<Size, number>
  reservePct: number
  sectionBonus: number
  parallelWindowMin: number
  parallelMax: number
  calibrationDays: number
  minCalibrationIntervals: number
  minRisePoints: number
  measuredMin: number
}

export const DEFAULT_CFG: Cfg = {
  aliases: {
    'agent stuff': 'agent',
    'youtube automation': 'youtube',
    'engineering · ee portfolio': 'engineering',
    business: 'business',
    trading: 'trading',
    engineering: 'engineering',
  },
  keywords: {
    trading: ['nq', 'mnq', 'es', 'mes', 'mgc', 'gc', 'futures?', 'backtest\\w*', 'strateg\\w*', 'trad(?:e|es|ing)', 'prop', 'topstep', 'apex', 'pine', 'sharpe', 'orb', 'vwap', 'prereg', 'slippage'],
    youtube: ['youtube', 'yt', 'video', 'thumbnail', 'shorts', 'upload\\w*', 'channel', 'voiceover', 'ffmpeg'],
    business: ['autorank', 'seo', 'outreach', 'prospects?', 'leads?', 'clients?', 'agency', 'airtable', 'objection'],
    engineering: ['ee', 'electrical', 'pcb', 'schematic\\w*', 'autocad', 'cad', 'dxf', 'kicad', 'circuit\\w*', 'ladder', 'plc', 'bim\\w*', 'bonsai', 'revit', 'portfolio'],
    agent: ['claude', 'mods?', 'plugins?', 'hooks?', 'skills?', 'mcp', 'agents?', 'conductor', 'launchd', 'subagents?'],
  },
  priors: { S: 0.5, M: 2, L: 5, XL: 12 },
  reservePct: 5,
  sectionBonus: 1.15,
  parallelWindowMin: 15,
  parallelMax: 3,
  calibrationDays: 14,
  minCalibrationIntervals: 3,
  minRisePoints: 2,
  measuredMin: 3,
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)

// config.json over the defaults; anything missing or malformed keeps its default.
export function mergeCfg(raw: unknown): Cfg {
  const d = DEFAULT_CFG
  if (!isObj(raw)) return d
  const aliases: Record<string, string> = { ...d.aliases }
  if (isObj(raw.aliases)) for (const [k, v] of Object.entries(raw.aliases)) if (typeof v === 'string') aliases[k.trim().toLowerCase()] = v.trim().toLowerCase()
  const keywords: Record<string, string[]> = { ...d.keywords }
  if (isObj(raw.keywords)) for (const [k, v] of Object.entries(raw.keywords)) if (Array.isArray(v)) keywords[k] = v.filter((w): w is string => typeof w === 'string')
  const priors = { ...d.priors }
  if (isObj(raw.priors)) for (const s of SIZES) priors[s] = num(raw.priors[s], d.priors[s])
  return {
    aliases,
    keywords,
    priors,
    reservePct: num(raw.reservePct, d.reservePct),
    sectionBonus: num(raw.sectionBonus, d.sectionBonus),
    parallelWindowMin: num(raw.parallelWindowMin, d.parallelWindowMin),
    parallelMax: num(raw.parallelMax, d.parallelMax),
    calibrationDays: num(raw.calibrationDays, d.calibrationDays),
    minCalibrationIntervals: num(raw.minCalibrationIntervals, d.minCalibrationIntervals),
    minRisePoints: num(raw.minRisePoints, d.minRisePoints),
    measuredMin: num(raw.measuredMin, d.measuredMin),
  }
}

// ---------------------------------------------------------------- sections

// A sidebar name or typed name to the short section name; unknown names pass through lowercased.
export function normalizeSection(name: string, aliases: Record<string, string>): string {
  const key = name.trim().replace(/\s+/g, ' ').toLowerCase()
  return aliases[key] ?? key
}

// The section whose words occur most in the cwd and the first prompt; ties go to config order.
export function keywordSection(cwd: string, prompt: string, keywords: Record<string, string[]>): string | null {
  const hay = `${cwd.replace(/[_\-./]/g, ' ')} ${prompt.slice(0, 2000)}`
  let best: { name: string; n: number } | null = null
  for (const [name, words] of Object.entries(keywords)) {
    if (words.length === 0) continue
    let re: RegExp
    try {
      re = new RegExp(`\\b(?:${words.join('|')})\\b`, 'gi')
    } catch {
      continue
    }
    const n = (hay.match(re) ?? []).length
    if (n > 0 && (!best || n > best.n)) best = { name, n }
  }
  return best ? best.name : null
}

// What a get_session answer says about the sidebar group; null when ungrouped or unreadable.
export function groupNameOf(text: string): string | null {
  try {
    const j: unknown = JSON.parse(text)
    if (isObj(j) && isObj(j.group) && typeof j.group.name === 'string' && j.group.name.trim()) return j.group.name
  } catch {
    // not JSON: unknown
  }
  return null
}

// ---------------------------------------------------------------- tool log

export type ToolKind = 'mcp' | 'skill' | 'agent' | 'connector'
export type ToolRow = { kind: ToolKind; plugin: string; name: string }

const UUID = /^mcp__([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})__/i

// `plugin_<plugin>_<server>` to the plugin. The server usually repeats or extends the plugin's
// name after one underscore; a plugin name with an underscore (gr0m_mem_gr0m_mem) is found when
// the two halves match.
function pluginOfServer(head: string): string {
  const parts = head.split('_')
  if (parts.length >= 4 && parts.length % 2 === 0) {
    const h = parts.length / 2
    const a = parts.slice(0, h).join('_')
    if (a === parts.slice(h).join('_')) return a
  }
  return parts[0] ?? head
}

// A tool call to the row the log keeps, or null for a built-in or anything not tied to a plugin.
export function deriveTool(tool: string, input: { skill?: unknown; subagent_type?: unknown }): ToolRow | null {
  if (tool.startsWith('mcp__plugin_')) {
    const head = tool.slice('mcp__plugin_'.length).split('__')[0] ?? ''
    return head ? { kind: 'mcp', plugin: pluginOfServer(head), name: tool } : null
  }
  const u = UUID.exec(tool)
  if (u) return { kind: 'connector', plugin: u[1] ?? '', name: tool }
  if (tool.startsWith('mcp__')) {
    const server = tool.slice('mcp__'.length).split('__')[0] ?? ''
    return server ? { kind: 'mcp', plugin: server, name: tool } : null
  }
  if (tool === 'Skill' && typeof input.skill === 'string' && input.skill.includes(':')) {
    return { kind: 'skill', plugin: input.skill.split(':')[0] ?? '', name: input.skill }
  }
  if ((tool === 'Agent' || tool === 'Task') && typeof input.subagent_type === 'string' && input.subagent_type.includes(':')) {
    return { kind: 'agent', plugin: input.subagent_type.split(':')[0] ?? '', name: input.subagent_type }
  }
  return null
}

// ---------------------------------------------------------------- samples, calibration, pace

export type Sample = { ts: string; session: string; section: string; weeklyPct: number; fiveHourPct: number | null; costUSD: number }

export function parseJsonl(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const v: unknown = JSON.parse(t)
      if (isObj(v)) out.push(v)
    } catch {
      // a torn or foreign line is skipped
    }
  }
  return out
}

export function toSamples(rows: Record<string, unknown>[]): Sample[] {
  const out: Sample[] = []
  for (const r of rows) {
    if (typeof r.ts !== 'string' || typeof r.session !== 'string') continue
    if (typeof r.weeklyPct !== 'number' || typeof r.costUSD !== 'number' || !Number.isFinite(Date.parse(r.ts))) continue
    out.push({
      ts: r.ts,
      session: r.session,
      section: typeof r.section === 'string' ? r.section : 'unknown',
      weeklyPct: r.weeklyPct,
      fiveHourPct: typeof r.fiveHourPct === 'number' ? r.fiveHourPct : null,
      costUSD: r.costUSD,
    })
  }
  return out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2
}

export type Calibration = { pctPerUSD: number | null; intervals: number }

// Weekly % per $ of session cost. Walk the samples of all sessions in time order; each time the
// weekly % has risen by at least `minRisePoints` since the anchor, one ratio is
// (weekly rise) / (sum over sessions of cost added since the anchor). A session first seen inside
// the interval counts from $0. The median of the last `calibrationDays` of ratios, once there
// are `minCalibrationIntervals` of them.
export function calibrate(all: Sample[], nowMs: number, cfg: Cfg): Calibration {
  const from = nowMs - cfg.calibrationDays * 86_400_000
  const samples = all.filter(s => Date.parse(s.ts) >= from)
  const last = new Map<string, number>()
  let anchorWeekly: number | null = null
  let base = new Map<string, number>()
  const ratios: number[] = []
  for (const s of samples) {
    last.set(s.session, s.costUSD)
    if (anchorWeekly === null || s.weeklyPct < anchorWeekly) {
      anchorWeekly = s.weeklyPct // first sample, or the week reset
      base = new Map(last)
      continue
    }
    const rise = s.weeklyPct - anchorWeekly
    if (rise < cfg.minRisePoints) continue
    let added = 0
    for (const [sess, cost] of last) added += Math.max(0, cost - (base.get(sess) ?? 0))
    if (added > 0) ratios.push(rise / added)
    anchorWeekly = s.weeklyPct
    base = new Map(last)
  }
  const m = ratios.length >= cfg.minCalibrationIntervals ? median(ratios) : null
  return { pctPerUSD: m, intervals: ratios.length }
}

// Weekly points used since local midnight, from the newest sample before midnight (within 36 h)
// or else the first one today. After a reset it is the new week's use so far.
export function spentToday(samples: Sample[], midnightMs: number, currentWeekly: number): number | null {
  let base: Sample | undefined
  for (const s of samples) {
    const t = Date.parse(s.ts)
    if (t < midnightMs && midnightMs - t <= 36 * 3_600_000) base = s
  }
  if (!base) base = samples.find(s => Date.parse(s.ts) >= midnightMs)
  if (!base) return null
  return currentWeekly < base.weeklyPct ? currentWeekly : currentWeekly - base.weeklyPct
}

export function parallelSessions(samples: Sample[], nowMs: number, windowMin: number): number {
  const from = nowMs - windowMin * 60_000
  return new Set(samples.filter(s => Date.parse(s.ts) >= from).map(s => s.session)).size
}

export function daysLeft(resetsAt: string | undefined, nowMs: number): number | null {
  if (!resetsAt) return null
  const t = Date.parse(resetsAt)
  return Number.isFinite(t) ? Math.max(0, (t - nowMs) / 86_400_000) : null
}

// (100 - used) / days left; with under a day left the whole remainder is today's.
export function allowancePerDay(weekly: number, left: number | null): number | null {
  return left === null ? null : Math.max(0, 100 - weekly) / Math.max(left, 1)
}

// ---------------------------------------------------------------- tasks

export type Task = { n: number; done: boolean; section: string; text: string; size: Size; value: number; est: number | null }
export type ScanEntry = { lineIdx: number; task: Task }

// Task lines in file order; `n` counts valid task lines from 1, done ones included, so numbers
// hold when a box is checked.
export function scanTasks(md: string, aliases: Record<string, string>): ScanEntry[] {
  const out: ScanEntry[] = []
  const lines = md.split('\n')
  lines.forEach((line, lineIdx) => {
    const m = /^\s*[-*]\s*\[([ xX])\]\s*(.+)$/.exec(line)
    if (!m) return
    const parts = (m[2] ?? '').split('|').map(p => p.trim())
    if (parts.length < 3) return
    const size = (parts[2] ?? '').toUpperCase() as Size
    if (!SIZES.includes(size) || !parts[0] || !parts[1]) return
    let value = 3
    let est: number | null = null
    for (const extra of parts.slice(3)) {
      const v = /^value\s*(\d+(?:\.\d+)?)$/i.exec(extra)
      if (v) value = Math.min(5, Math.max(1, Number(v[1])))
      const e = /^est\s*(\d+(?:\.\d+)?)\s*%?$/i.exec(extra)
      if (e) est = Number(e[1])
    }
    out.push({
      lineIdx,
      task: { n: out.length + 1, done: (m[1] ?? ' ') !== ' ', section: normalizeSection(parts[0], aliases), text: parts[1], size, value, est },
    })
  })
  return out
}

export const parseTasks = (md: string, aliases: Record<string, string>): Task[] => scanTasks(md, aliases).map(e => e.task)

// tasks.md with task n's box checked; null when there is no such task or it is already done.
export function checkTask(md: string, n: number, aliases: Record<string, string>): string | null {
  const hit = scanTasks(md, aliases).find(e => e.task.n === n)
  if (!hit || hit.task.done) return null
  const lines = md.split('\n')
  lines[hit.lineIdx] = (lines[hit.lineIdx] ?? '').replace(/\[ \]/, '[x]')
  return lines.join('\n')
}

export type HistoryRow = { section: string; size: string; pct: number | null; deltaUSD: number | null }

export type Estimate = { pct: number; basis: string }

// The % of the weekly limit a task will take, and where that number comes from: the line's own
// `est`, else the median of >= measuredMin measured tasks of the same section+size, else the prior.
export function estimateTask(t: Task, history: HistoryRow[], cal: Calibration, cfg: Cfg): Estimate {
  if (t.est !== null) return { pct: t.est, basis: 'set' }
  const measured: number[] = []
  for (const h of history) {
    if (h.section !== t.section || h.size !== t.size) continue
    const p = h.pct ?? (cal.pctPerUSD !== null && h.deltaUSD !== null ? h.deltaUSD * cal.pctPerUSD : null)
    if (p !== null && Number.isFinite(p) && p >= 0) measured.push(p)
  }
  if (measured.length >= cfg.measuredMin) return { pct: median(measured) ?? cfg.priors[t.size], basis: `measured n=${measured.length}` }
  return { pct: cfg.priors[t.size], basis: 'prior' }
}

export type Rec = { task: Task; est: Estimate; score: number }

export type RecCtx = { remaining: number | null; section: string | null; history: HistoryRow[]; cal: Calibration; cfg: Cfg }

// Open tasks ranked by value / est%, with a bonus for the current session's section; tasks whose
// est exceeds what is left of the week minus the reserve are dropped (unknown remaining: none are).
export function recommend(tasks: Task[], ctx: RecCtx): { picks: Rec[]; dropped: Rec[] } {
  const all = tasks
    .filter(t => !t.done)
    .map(task => {
      const est = estimateTask(task, ctx.history, ctx.cal, ctx.cfg)
      const bonus = ctx.section && task.section === ctx.section ? ctx.cfg.sectionBonus : 1
      return { task, est, score: (task.value / Math.max(est.pct, 0.01)) * bonus }
    })
  const room = ctx.remaining === null ? Infinity : ctx.remaining - ctx.cfg.reservePct
  const picks = all.filter(r => r.est.pct <= room)
  const dropped = all.filter(r => r.est.pct > room)
  picks.sort((a, b) => b.score - a.score || b.task.value - a.task.value || a.task.n - b.task.n)
  return { picks, dropped }
}

// ---------------------------------------------------------------- text

export const p1 = (n: number): string => String(Math.round(n * 10) / 10)

export function statusText(weekly: number, left: number | null, allowance: number | null): string {
  const parts = [`wk ${p1(weekly)}%`]
  if (left !== null) parts.push(`${p1(left)}d`)
  if (allowance !== null) parts.push(`~${p1(allowance)}%/day`)
  return parts.join(' · ')
}

export function recLine(r: Rec): string {
  return `#${r.task.n} [${r.task.section}] ${r.task.text} (${r.task.size}, value ${r.task.value}, est. ${p1(r.est.pct)}% ${r.est.basis})`
}

export function nextToast(picks: Rec[]): string | null {
  const r = picks[0]
  return r ? `usage-coach next: ${recLine(r)}` : null
}

export function nextText(res: { picks: Rec[]; dropped: Rec[] }, remaining: number | null, cal: Calibration, cfg: Cfg): string {
  const head = remaining === null ? 'usage-coach: no weekly limit reading in this session (API key?); ranking without a fit filter' : `usage-coach: ${p1(remaining)}% of the week left, ${p1(cfg.reservePct)}% kept in reserve`
  const cl = cal.pctPerUSD === null ? 'cost calibration: calibrating (sizes are priors until measured)' : `cost calibration: est. ${p1(cal.pctPerUSD)}% of the week per $`
  const lines = res.picks.slice(0, 3).map((r, i) => `${i + 1}. ${recLine(r)}`)
  if (lines.length === 0) lines.push(res.dropped.length ? 'nothing fits what is left; the open tasks are all bigger' : 'no open tasks in tasks.md')
  if (res.dropped.length && res.picks.length) lines.push(`(${res.dropped.length} more skipped: est. over what is left)`)
  return [head, ...lines, cl].join('\n')
}

export type BudgetIn = {
  weekly: number | null
  left: number | null
  allowance: number | null
  spent: number | null
  parallel: number
  cal: Calibration
  tasks: Task[]
  history: HistoryRow[]
  cfg: Cfg
  sampleCount: number
}

export function budgetText(b: BudgetIn): string {
  const out: string[] = []
  if (b.weekly === null) {
    out.push('usage-coach /budget: no weekly limit reading in this session (API-key sessions have none).')
  } else {
    out.push(`Weekly used: ${p1(b.weekly)}% (${p1(Math.max(0, 100 - b.weekly))}% left)`)
    out.push(b.left === null ? 'Reset: unknown' : `Time to reset: ${p1(b.left)}d`)
    out.push(b.allowance === null ? 'Daily allowance: unknown' : `Daily allowance: ~${p1(b.allowance)}%/day (est.)`)
    if (b.spent === null) out.push('Spent today: no samples yet')
    else out.push(`Spent today: ${p1(b.spent)}%${b.allowance !== null ? (b.spent > b.allowance ? ' (over the allowance)' : ' (within the allowance)') : ''}`)
  }
  out.push(`Parallel sessions (last ${b.cfg.parallelWindowMin} min): ${b.parallel}`)
  out.push(b.cal.pctPerUSD === null ? `Calibration: calibrating (${b.cal.intervals} of ${b.cfg.minCalibrationIntervals} intervals so far; ${b.sampleCount} samples)` : `Calibration: est. ${p1(b.cal.pctPerUSD)}% of the week per $ (median of ${b.cal.intervals} intervals)`)
  const open = b.tasks.filter(t => !t.done)
  if (open.length === 0) {
    out.push('Open tasks: none')
  } else {
    out.push('Open tasks by section:')
    const room = b.weekly === null ? null : 100 - b.weekly - b.cfg.reservePct
    const bySec = new Map<string, Task[]>()
    for (const t of open) bySec.set(t.section, [...(bySec.get(t.section) ?? []), t])
    let total = 0
    for (const [sec, ts] of bySec) {
      const ests = ts.map(t => estimateTask(t, b.history, b.cal, b.cfg))
      const sum = ests.reduce((a, e) => a + e.pct, 0)
      total += sum
      const basis = [...new Set(ests.map(e => e.basis))].join(', ')
      const fit = room === null ? '' : sum <= room ? ' - fits in what is left' : ' - does not fit in what is left'
      out.push(`  ${sec}: ${ts.length} open, est. ${p1(sum)}% (${basis})${fit}`)
    }
    if (room !== null) out.push(`All open tasks: est. ${p1(total)}% vs ${p1(Math.max(0, room))}% available after the ${p1(b.cfg.reservePct)}% reserve${total <= room ? ' - all fit' : ' - not all fit'}`)
  }
  return out.join('\n')
}

// The one amber line for the band, or null when pace is fine (spend within the allowance and
// at most `parallelMax` parallel sessions).
export function bandLine(s: { spentToday: number | null; allowance: number | null; parallel: number }, cfg: Cfg): string | null {
  const why: string[] = []
  if (s.spentToday !== null && s.allowance !== null && s.spentToday > s.allowance) {
    why.push(`today's spend ${p1(s.spentToday)}% is over the ~${p1(s.allowance)}%/day allowance (est.)`)
  }
  if (s.parallel > cfg.parallelMax) why.push(`${s.parallel} parallel sessions in the last ${cfg.parallelWindowMin} min`)
  return why.length ? `usage-coach: ${why.join(' · ')}` : null
}
