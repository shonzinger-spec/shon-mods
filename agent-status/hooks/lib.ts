import type { Agent, Evt, Health } from '../types'

export type Config = { script: string; intervalMinutes: number; eventMinutes: number }
export const DEFAULTS: Config = {
  script: '/path/to/agent_health.py',
  intervalMinutes: 5,
  eventMinutes: 30,
}

export function parseConfig(text: string): Config {
  try {
    const j = JSON.parse(text) as Partial<Config>
    const pos = (v: unknown, d: number) => (typeof v === 'number' && v > 0 ? v : d)
    return {
      script: typeof j.script === 'string' && j.script ? j.script : DEFAULTS.script,
      intervalMinutes: pos(j.intervalMinutes, DEFAULTS.intervalMinutes),
      eventMinutes: pos(j.eventMinutes, DEFAULTS.eventMinutes),
    }
  } catch {
    return DEFAULTS
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

// The script's JSON, checked at the boundary. Anything without an agent list is rejected.
export function parseHealth(text: string): Health | null {
  try {
    const j = JSON.parse(text) as { checked_at?: unknown; agents?: unknown; events?: unknown }
    if (!j || !Array.isArray(j.agents)) return null
    const agents: Agent[] = j.agents
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as { id?: unknown }).id === 'string')
      .map(a => {
        const fix = a.user_fix as Record<string, unknown> | null | undefined
        const last = a.last_run as Record<string, unknown> | null | undefined
        return {
          id: String(a.id),
          name: str(a.name) ?? String(a.id),
          model: str(a.model),
          model_label: str(a.model_label),
          works: a.works === true ? true : a.works === false ? false : null,
          state: str(a.state) ?? (a.works === true ? 'ok' : a.works === false ? 'down' : 'unknown'),
          reason: str(a.reason),
          user_fix: fix && typeof fix === 'object' && str(fix.label) ? { label: String(fix.label), command: str(fix.command) ?? undefined, url: str(fix.url) ?? undefined } : null,
          last_run: last && typeof last === 'object' && str(last.at) ? { at: String(last.at), verdict: str(last.verdict) ?? '' } : null,
          fallback: Array.isArray(a.fallback) ? a.fallback.filter((x): x is string => typeof x === 'string') : [],
          checked: str(a.checked),
        }
      })
    const events: Evt[] = (Array.isArray(j.events) ? j.events : [])
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as { at?: unknown }).at === 'string')
      .map(x => ({ at: String(x.at), lane: str(x.lane) ?? '', kind: str(x.kind) ?? 'context-switch', from: str(x.from) ?? '', to: str(x.to), text: str(x.text) ?? '' }))
    return { checked_at: str(j.checked_at) ?? '', agents, events }
  } catch {
    return null
  }
}

// A --ping answers for one agent: swap that row, keep the rest, union the events.
export function mergePing(cur: Health | null, next: Health, id: string): Health {
  if (!cur) return next
  const fresh = next.agents.find(a => a.id === id)
  const agents = fresh ? cur.agents.map(a => (a.id === id ? fresh : a)) : cur.agents
  const seen = new Set(cur.events.map(eventId))
  return { ...cur, agents, events: [...cur.events, ...next.events.filter(e => !seen.has(eventId(e)))] }
}

export type Kind = 'ok' | 'down' | 'idle'
export const kindOf = (a: Agent): Kind => (a.state === 'ok' ? 'ok' : a.state === 'down' ? 'down' : a.state === 'disabled' || a.state === 'unknown' ? 'idle' : a.works === true ? 'ok' : a.works === false ? 'down' : 'idle')
export const COLOR: Record<Kind, string> = { ok: '#22C55E', down: '#EF4444', idle: '#9CA3AF' }

export const worksText = (a: Agent): string => (a.state === 'disabled' ? 'Disabled' : kindOf(a) === 'ok' ? 'Yes' : kindOf(a) === 'down' ? 'No' : 'Unknown')
export const counts = (h: Health): { working: number; total: number } => ({ working: h.agents.filter(a => kindOf(a) === 'ok').length, total: h.agents.length })
export const headline = (working: number, total: number): string => `${working} of ${total} working`

export function ago(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((nowMs - t) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const hr = Math.round(m / 60)
  if (hr < 48) return `${hr} h ago`
  return `${Math.round(hr / 24)} d ago`
}

export const eventId = (e: Evt): string => `${e.at}|${e.lane}|${e.kind}|${e.from}|${e.to ?? ''}`
export const eventText = (e: Evt): string => e.text || `${e.lane} ${e.kind === 'context-exhausted' ? 'ran out of context' : 'switched model'} on ${e.from}${e.to ? `, switching to ${e.to}` : ''}`

export function recentEvents(h: Health, nowMs: number, minutes: number): Evt[] {
  return h.events
    .filter(e => {
      const t = Date.parse(e.at)
      return Number.isFinite(t) && nowMs - t <= minutes * 60_000 && t - nowMs < 5 * 60_000
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

export const latestEvents = (h: Health, n: number): Evt[] => [...h.events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, n)

export type BandItem = { key: string; text: string; fix?: { agentId: string; label: string } }

// What needs the person: an agent down that only they can fix, and fresh context switches.
export function bandItems(h: Health | null, nowMs: number, minutes: number): BandItem[] {
  if (!h) return []
  const out: BandItem[] = h.agents
    .filter(a => a.state === 'down' && a.user_fix)
    .map(a => ({ key: `fix:${a.id}:${a.user_fix?.label}`, text: `${a.name} needs you: ${a.user_fix?.label}`, fix: { agentId: a.id, label: a.user_fix?.label ?? '' } }))
  for (const e of recentEvents(h, nowMs, minutes)) out.push({ key: `ev:${eventId(e)}`, text: eventText(e) })
  return out
}
export const signature = (items: BandItem[]): string => items.map(i => i.key).join('\n')

// ---- fix actions -------------------------------------------------------------

// An AppleScript string literal: backslash and double quote escaped, newlines written as \n.
export const appleString = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`

// argv for osascript (no shell sits between us and it): the person's command runs in Terminal.
export const terminalArgv = (command: string): string[] => [
  'osascript',
  '-e', `tell application "Terminal" to do script ${appleString(command)}`,
  '-e', 'tell application "Terminal" to activate',
]

export const safeUrl = (u: string): boolean => /^https?:\/\/[^\s]+$/i.test(u)

// ---- drawing -----------------------------------------------------------------

const FONT = '-apple-system,BlinkMacSystemFont,sans-serif'
const CSS_BASE =
  '.trk{fill:#e4e4e2}@media (prefers-color-scheme: dark){.trk{fill:#2c2c2c}}' +
  '.fi{animation:fi .6s ease-out both}@keyframes fi{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}' +
  '@media (prefers-reduced-motion: reduce){*{animation:none!important}}'

function noise(a: number, b: number): number {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return v - Math.floor(v)
}

// One status dot: a core with a soft ring that breathes (green), pulses slowly (red) or stays still (grey).
export function dotSvg(kind: Kind): string {
  const c = COLOR[kind]
  const ring = kind === 'idle' ? '' : `<circle class="ring ${kind}" cx="9" cy="9" r="4.5" fill="${c}"/>`
  const css =
    CSS_BASE +
    '.ring{transform-box:fill-box;transform-origin:center;opacity:0}' +
    '.ok{animation:pg 2.4s ease-out infinite}@keyframes pg{0%{transform:scale(1);opacity:.45}100%{transform:scale(2.3);opacity:0}}' +
    '.down{animation:pr 1.4s ease-in-out infinite}@keyframes pr{0%,100%{transform:scale(1.2);opacity:.15}50%{transform:scale(1.9);opacity:.5}}'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><style>${css}</style><g class="fi">${ring}<circle cx="9" cy="9" r="4.5" fill="${c}"/></g></svg>`
}

// The header bar: one dotted segment per agent, coloured by state, in the hud's glowing dot style.
export function barSvg(agents: Agent[], widthPx: number): { svg: string; w: number; h: number } {
  const w = Math.max(200, Math.min(480, Math.round(widthPx)))
  const h = 10
  const n = Math.max(1, agents.length)
  const gap = 4
  const sw = (w - gap * (n - 1)) / n
  const parts = agents.map((a, i) => {
    const k = kindOf(a)
    const x = i * (sw + gap)
    const groups = ['', '', '']
    const cols = Math.floor(sw / 3)
    for (let c = 0; c < cols; c++) for (let r = 0; r < 3; r++) if (k !== 'idle' || noise(c + i, r) < 0.45) groups[Math.floor(noise(r + i, c) * 3)] += `<rect x="${c * 3 + 0.5}" y="${r * 3 + 0.5}" width="2" height="2"/>`
    const dots = groups.map((g, j) => (g ? `<g class="t${j}">${g}</g>` : '')).join('')
    return (
      `<g class="fi" style="animation-delay:${i * 60}ms" transform="translate(${x.toFixed(1)},0)"><clipPath id="s${i}"><rect width="${sw.toFixed(1)}" height="${h}" rx="5"/></clipPath>` +
      `<rect class="trk" width="${sw.toFixed(1)}" height="${h}" rx="5"/><g clip-path="url(#s${i})"><g fill="${COLOR[k]}" opacity="${k === 'idle' ? 0.8 : 1}">${dots}</g></g></g>`
    )
  })
  const css = CSS_BASE + '.t0,.t1,.t2{animation:tw 2.4s ease-in-out infinite}.t1{animation-duration:3s;animation-delay:-.8s}.t2{animation-duration:2s;animation-delay:-1.4s}@keyframes tw{0%,100%{opacity:1}50%{opacity:.35}}'
  const alt = agents.map(a => `${a.name} ${worksText(a)}`).join(', ')
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}"><title>${alt.replace(/[<>&]/g, '')}</title><style>${css}</style>${parts.join('')}</svg>`, w, h }
}
