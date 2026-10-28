import type { MemSnap } from '../types'

export type Pressure = 'normal' | 'warn' | 'critical' | 'unknown'
export type Level = 'ok' | 'warn' | 'critical'
export type Cfg = { intervalSec: number; swapWarnPct: number; swapCriticalPct: number; cooldownMin: number }
export type Sys = { pressure: Pressure; swapTotalMB: number; swapUsedMB: number; freePct?: number; memTotalMB?: number }
export type TopRow = { pid: number; ppid: number; mb: number }
export type PsMap = Map<number, { ppid: number; command: string }>
export type Kind = 'chat' | 'mcp' | 'app' | 'other'
export type Group = { kind: Kind; name: string; mb: number; n: number }
export type ChatUse = { pid: number; mb: number; childMb: number; children: string[] }

export const DEFAULT_CFG: Cfg = { intervalSec: 60, swapWarnPct: 85, swapCriticalPct: 97, cooldownMin: 30 }

export function mergeCfg(p: unknown): Cfg {
  const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
  const n = (k: keyof Cfg) => (typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) > 0 ? (o[k] as number) : DEFAULT_CFG[k])
  return { intervalSec: n('intervalSec'), swapWarnPct: n('swapWarnPct'), swapCriticalPct: n('swapCriticalPct'), cooldownMin: n('cooldownMin') }
}

const toMB = (num: string, unit: string): number => {
  const v = Number(num)
  switch (unit.toUpperCase()) {
    case 'B': return v / 1048576
    case 'K': return v / 1024
    case 'G': return v * 1024
    case 'T': return v * 1048576
    default: return v
  }
}

export function parseSysctl(text: string): Sys {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const p = lines[0] === '1' ? 'normal' : lines[0] === '2' ? 'warn' : lines[0] === '4' ? 'critical' : 'unknown'
  const grab = (k: string) => {
    const m = new RegExp(`${k}\\s*=\\s*([\\d.]+)\\s*([BKMGT]?)`, 'i').exec(lines[1] ?? '')
    return m ? toMB(m[1] ?? '0', m[2] || 'M') : 0
  }
  const free = /System-wide memory free percentage:\s*(\d+)\s*%/.exec(text)
  const mem = /^\d{6,}$/.test(lines[2] ?? '') ? Number(lines[2]) / 1048576 : 0
  return { pressure: p, swapTotalMB: grab('total'), swapUsedMB: grab('used'), freePct: free ? Number(free[1]) : 0, memTotalMB: mem }
}

export function parseTop(text: string): TopRow[] {
  const out: TopRow[] = []
  let seen = false
  for (const line of text.split('\n')) {
    if (!seen) {
      if (/^\s*PID\b/.test(line)) seen = true
      continue
    }
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)([BKMGT]?)[+-]?\s*$/i.exec(line)
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), mb: toMB(m[3] ?? '0', m[4] || 'M') })
  }
  return out
}

export function parsePs(text: string): PsMap {
  const map: PsMap = new Map()
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(line)
    if (m) map.set(Number(m[1]), { ppid: Number(m[2]), command: m[3] ?? '' })
  }
  return map
}

const KNOWN_MCP = [
  'desktop-commander', 'playwright', 'rea', 'tradingview', 'claudetube', 'codegraph', 'semble',
  'chrome-devtools-mcp', 'xcodebuildmcp', 'opencode-subagent-mcp', 'server-pdf',
]

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

const isChatCmd = (cmd: string) => /\/claude-code\/.*\/MacOS\/claude(\s|$)/.test(cmd) || base(cmd.split(/\s+/)[0] ?? '') === 'claude'

function chatAncestor(pid: number, ps: PsMap): number | null {
  let cur = ps.get(pid)?.ppid
  for (let i = 0; i < 50 && cur !== undefined && cur > 1; i++) {
    const e = ps.get(cur)
    if (!e) return null
    if (isChatCmd(e.command)) return cur
    cur = e.ppid
  }
  return null
}

function mcpName(cmd: string): string {
  for (const k of KNOWN_MCP) {
    if (new RegExp(`(^|[^A-Za-z0-9_-])${k}($|[^A-Za-z0-9_-])`).test(cmd)) return k
  }
  const pkg = /\b(?:npm exec|npx)\s+(?:-\S+\s+)*(@?[^\s@]+(?:\/[^\s@]+)?)/.exec(cmd)
  if (pkg?.[1]) return pkg[1]
  const toks = cmd.split(/\s+/)
  const path = toks.slice(1).find(t => t.includes('/') && !t.startsWith('-'))
  return base(path ?? toks[0] ?? cmd)
}

export function classify(pid: number, ps: PsMap): { kind: Kind; name: string } {
  const cmd = ps.get(pid)?.command ?? ''
  if (!cmd) return { kind: 'other', name: `pid ${pid}` }
  if (isChatCmd(cmd)) return { kind: 'chat', name: 'claude' }
  if (chatAncestor(pid, ps) !== null) return { kind: 'mcp', name: mcpName(cmd) }
  const toks = cmd.split(/\s+/)
  const a0 = base(toks[0] ?? '')
  if (/^python[\d.]*$/i.test(a0)) {
    const script = toks.slice(1).find(t => !t.startsWith('-'))
    return { kind: 'other', name: `python: ${script ? base(script) : '-'}` }
  }
  const app = /\/([^/]+)\.app\//.exec(cmd)
  if (app?.[1]) return { kind: 'app', name: app[1] }
  return { kind: 'other', name: a0 || `pid ${pid}` }
}

export function groupUsage(top: TopRow[], ps: PsMap): { groups: Group[]; chats: ChatUse[] } {
  const map = new Map<string, Group>()
  const chats = new Map<number, ChatUse & { set: Set<string> }>()
  const chatOf = (pid: number) => {
    let c = chats.get(pid)
    if (!c) chats.set(pid, (c = { pid, mb: 0, childMb: 0, children: [], set: new Set() }))
    return c
  }
  const add = (kind: Kind, name: string, mb: number) => {
    const k = `${kind}\0${name}`
    const g = map.get(k) ?? { kind, name, mb: 0, n: 0 }
    g.mb += mb
    g.n += 1
    map.set(k, g)
  }
  for (const r of top) {
    const c = classify(r.pid, ps)
    if (c.kind === 'chat') {
      add('chat', 'All Claude chats', r.mb)
      chatOf(r.pid).mb += r.mb
      continue
    }
    add(c.kind, c.name, r.mb)
    if (c.kind === 'mcp') {
      const anc = chatAncestor(r.pid, ps)
      if (anc !== null) {
        const ch = chatOf(anc)
        ch.childMb += r.mb
        ch.set.add(c.name)
      }
    }
  }
  const groups = [...map.values()].sort((a, b) => b.mb - a.mb)
  const list = [...chats.values()].map(({ set, ...c }) => ({ ...c, children: [...set].sort() })).sort((a, b) => b.mb + b.childMb - (a.mb + a.childMb))
  return { groups, chats: list }
}

export function swapPct(s: { swapTotalMB: number; swapUsedMB: number }): number {
  return s.swapTotalMB > 0 ? (s.swapUsedMB / s.swapTotalMB) * 100 : 0
}

export function levelOf(s: Sys, cfg: Cfg): Level {
  const pct = swapPct(s)
  if (s.pressure === 'critical' || pct >= cfg.swapCriticalPct) return 'critical'
  if (s.pressure === 'warn' || pct >= cfg.swapWarnPct) return 'warn'
  return 'ok'
}

const RANK: Record<Level, number> = { ok: 0, warn: 1, critical: 2 }

export function shouldAlert(prev: { level: Level; at: number } | null, level: Level, now: number, cfg: Cfg): boolean {
  if (level === 'ok') return false
  if (!prev || RANK[level] > RANK[prev.level]) return true
  return now - prev.at >= cfg.cooldownMin * 60_000
}

const g1 = (mb: number) => (mb / 1000).toFixed(1)
const gTop = (mb: number) => (mb >= 10_000 ? String(Math.round(mb / 1000)) : g1(mb))

export function statusText(level: Level, swap: { swapTotalMB: number; swapUsedMB: number }, top?: { name: string; mb: number } | null): string {
  const base = `mem ${level} · swap ${g1(swap.swapUsedMB)}/${g1(swap.swapTotalMB)}G`
  return top && level !== 'ok' ? `${base} · ${top.name} ${gTop(top.mb)}G` : base
}

export function alertText(level: Level, top: { name: string; mb: number }[]): string {
  const users = top.slice(0, 2).map(t => `${t.name} ${gTop(t.mb)}G`)
  const head = `Memory ${level}${users.length ? `: ${users.join(', ')}` : ''}.`
  const tail = 'Consider closing Chrome tabs or archiving idle chats; /mem for the list.'
  return level === 'critical' ? `${head} ${tail} macOS may show its own out-of-memory dialog; this mod can't hide it.` : `${head} ${tail}`
}

export function memReport(groups: Group[], chats: ChatUse[], snap: MemSnap | null): string {
  const lines: string[] = []
  lines.push(snap ? `Memory: level ${snap.level} (pressure ${snap.pressure}), swap ${g1(snap.swapUsedMB)}/${g1(snap.swapTotalMB)}G` : 'Memory: no reading yet')
  lines.push('', 'Top memory users (GB, processes):')
  for (const g of groups.slice(0, 12)) lines.push(`  ${g1(g.mb).padStart(6)}  ${String(g.n).padStart(4)}  ${g.name}`)
  if (!groups.length) lines.push('  (scan returned nothing)')
  if (chats.length) {
    lines.push('', 'Claude chats (own + MCP children, MB):')
    for (const c of chats.filter(x => x.mb + x.childMb >= 10)) lines.push(`  pid ${c.pid}: ${Math.round(c.mb)} + ${Math.round(c.childMb)}${c.children.length ? `  [${c.children.join(', ')}]` : ''}`)
  }
  lines.push('', 'Figures are phys footprint (includes compressed and swapped memory), as in top. ps RSS undercounts badly under pressure, so it is not used.')
  lines.push('Suggestions (nothing is killed or archived): close Chrome tabs or windows you are not using, archive idle chats, or restart a chat whose MCP servers are large.')
  return lines.join('\n')
}

export function meterText(s: { swapTotalMB: number; swapUsedMB: number; freePct?: number; memTotalMB?: number }): string {
  const swap = `swap ${g1(s.swapUsedMB)}/${g1(s.swapTotalMB)}G`
  if (!s.memTotalMB) return `RAM ? · ${swap}`
  const pct = s.freePct ?? 0
  return `RAM ${g1((s.memTotalMB * pct) / 100)}G free (${Math.round(pct)}%) · ${swap}`
}

// Apps never offered for quitting, compared lowercase.
const NEVER = new Set([
  'claude', 'terminal', 'iterm', 'iterm2', 'ghostty', 'warp', 'kitty', 'alacritty', 'wezterm', 'visual studio code', 'cursor', 'codex',
  'antigravity ide', 'finder', 'dock', 'systemuiserver', 'controlcenter', 'loginwindow', 'tradingview',
])

export type Candidate = { name: string; mb: number; label: string }

export function cleanCandidates(rows: TopRow[], ps: PsMap, home: string): { cands: Candidate[]; excluded: { name: string; mb: number }[] } {
  const roots = ['/Applications/', `${home}/Applications/`]
  const apps = new Map<string, number>()
  const out = new Map<string, number>()
  const skip = new Set<string>()
  const drop = (name: string, mb: number) => out.set(name, (out.get(name) ?? 0) + mb)
  for (const r of rows) {
    const cmd = ps.get(r.pid)?.command ?? ''
    const k = classify(r.pid, ps).kind
    if (k === 'chat' || k === 'mcp') { drop('Claude chats + MCP servers', r.mb); continue }
    const app = /^\/.*?\/([^/]+)\.app\//.exec(cmd)?.[1]
    if (!app || !roots.some(x => cmd.startsWith(x))) { drop('processes outside /Applications', r.mb); continue }
    if (cmd.includes(`${home}/Trading`)) skip.add(app)
    apps.set(app, (apps.get(app) ?? 0) + r.mb)
  }
  const cands: Candidate[] = []
  for (const [name, mb] of apps) {
    if (NEVER.has(name.toLowerCase()) || skip.has(name)) { drop(name, mb); continue }
    cands.push({ name, mb, label: `${name} ${g1(mb)}G${name === 'Google Chrome' ? ' (tabs restore on reopen)' : ''}` })
  }
  cands.sort((a, b) => b.mb - a.mb)
  return { cands: cands.slice(0, 4), excluded: [...out].map(([name, mb]) => ({ name, mb })).sort((a, b) => b.mb - a.mb) }
}
