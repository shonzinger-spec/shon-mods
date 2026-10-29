import type { Heal, SyncStatus } from '../types'

export type Tone = 'ok' | 'warn' | 'critical'
export const FILL = { ok: '#14B8A6', warn: '#F59E0B', critical: '#EF4444' } as const
export const TRACK = '#23303A'
const GRAD = { ok: '#14B8A6', warn: '#F59E0B', critical: '#EF4444' } as const

export const saved = (s: SyncStatus): number => s.totals.saved
// Everything the pipeline should have saved by now: all but live chats.
export const due = (s: SyncStatus): number => s.totals.total - s.totals.live
export const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 100) : 100)

export function tone(s: SyncStatus): Tone {
  const a = s.heal?.action
  if (s.totals.stuck > 0 || s.heal?.struggling || a === 'launch_error') return 'critical'
  return s.totals.failed > 0 ? 'warn' : 'ok'
}

export function headline(s: SyncStatus): string {
  const t = s.totals
  if (t.failed + t.stuck === 0) return `All ${t.saved} finished chats saved`
  return `${t.failed + t.stuck} not saved yet · ${t.saved}/${due(s)} saved`
}

const hm = (sec: number): string => new Date(sec * 1000).toTimeString().slice(0, 5)
const jobName = (j: string | null): string => (j === 'melxis' ? 'Melxis sync' : 'archive sync')

// The auto-rerun line: what the healer is doing about the failures.
export function healText(h: Heal | null, failed: number, nowSec: number): string {
  if (!h) return ''
  switch (h.action) {
    case 'idle':
      return 'Auto-rerun: nothing to fix'
    case 'running':
      return `Saving… ${jobName(h.job)} is running`
    case 'started':
      return `Rerun started: ${jobName(h.job)} (try ${h.attempts}/${h.cap})`
    case 'waiting': {
      const mins = h.next_at ? Math.max(0, Math.ceil((h.next_at - nowSec) / 60)) : 0
      const at = `${h.next_at ? hm(h.next_at) : '?'} (${mins} min)`
      return h.struggling
        ? `${failed} still failing after ${h.attempts} reruns · retrying hourly, next at ${at}`
        : `${failed} still failing · try ${h.attempts + 1}/${h.cap} at ${at}`
    }
    case 'launch_error':
      return `Could not start ${jobName(h.job)}: ${h.history.at(-1)?.msg || 'launchctl error'}`
  }
}

export function ago(iso: string, nowMs: number): string {
  const m = Math.round((nowMs - Date.parse(iso)) / 60000)
  return m <= 0 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`
}

export const idleText = (min: number | null): string =>
  min === null ? '' : min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`

// ---- terminal: text pill (same construction as the hud mod) ----
export type Seg = { text: string; color?: string; backgroundColor?: string; bold?: boolean }
export function pill(p0: number, width: number, fill: string, label: string): Seg[] {
  const p = Math.max(0, Math.min(100, Number.isFinite(p0) ? p0 : 0))
  const eighths = Math.round((p / 100) * width * 8)
  const full = Math.floor(eighths / 8)
  const part = eighths % 8
  const start = Math.floor((width - label.length) / 2)
  const cells: Seg[] = []
  for (let i = 0; i < width; i++) {
    const k = i - start
    if (k >= 0 && k < label.length) {
      cells.push(i < full ? { text: label[k] as string, color: '#FFFFFF', backgroundColor: fill, bold: true } : { text: label[k] as string, color: '#C9CED6', backgroundColor: TRACK })
    } else if (i < full) cells.push({ text: ' ', backgroundColor: fill })
    else if (i === full && part) cells.push({ text: ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'][part] as string, color: fill, backgroundColor: TRACK })
    else cells.push({ text: ' ', backgroundColor: TRACK })
  }
  const all: Seg[] = [{ text: '◖', color: p === 0 ? TRACK : fill }, ...cells, { text: '◗', color: p === 100 ? fill : TRACK }]
  const out: Seg[] = []
  for (const c of all) {
    const l = out[out.length - 1]
    if (l && l.color === c.color && l.backgroundColor === c.backgroundColor && l.bold === c.bold) l.text += c.text
    else out.push({ ...c })
  }
  return out
}

// ---- desktop: Savvy-style dotted bars as one SVG ----
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"
const xml = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const noise = (a: number, b: number): number => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return v - Math.floor(v)
}
const tagWidth = (s: string, fs: number): number => Math.round(14 + [...s].reduce((w, ch) => w + (/[\s.,:/|]/.test(ch) ? 0.3 : /[A-Z%]/.test(ch) ? 0.72 : 0.58) * fs, 0))

type Bar = { id: string; n: number; d: number; tone: Tone; h: number; tag: string; busy: boolean }

function bar(b: Bar, x: number, y: number, w: number, defs: string[]): string {
  const p = b.d > 0 ? Math.max(0, Math.min(1, b.n / b.d)) : 1
  const fw = Math.round(p * w)
  const color = GRAD[b.tone]
  const cell = 3
  const groups = ['', '', '', '']
  const cols = Math.floor(fw / cell)
  const rows = Math.floor(b.h / cell)
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r++) if (noise(c, r) < density) groups[Math.floor(noise(r, c) * 4)] += `<rect x="${c * cell + 0.5}" y="${r * cell + 0.5}" width="2" height="2"/>`
  }
  const dots = groups.map((g, i) => (g ? `<g class="t${i}">${g}</g>` : '')).join('')
  const fs = b.h >= 14 ? 10 : 9
  const tw = tagWidth(b.tag, fs)
  const tx = Math.max(0, Math.min(w - tw, fw - tw))
  defs.push(`<clipPath id="c${b.id}"><rect width="${w}" height="${b.h}" rx="${b.h / 2}"/></clipPath>`)
  const sweep = `<rect class="${b.busy ? 'sw fast' : 'sw'}" x="-40" width="36" height="${b.h}" fill="url(#sheen)"/>`
  return (
    `<g transform="translate(${x},${y})"><rect class="k" width="${w}" height="${b.h}" rx="${b.h / 2}"/>` +
    `<g clip-path="url(#c${b.id})"><g fill="${color}">${dots}</g>${sweep}</g>` +
    `<rect class="glow" x="${tx - 3}" y="-2" width="${tw + 6}" height="${b.h + 4}" rx="${(b.h + 4) / 2}" fill="${color}"/>` +
    `<rect x="${tx}" width="${tw}" height="${b.h}" rx="${b.h / 2}" fill="${color}"/>` +
    `<text x="${tx + tw / 2}" y="${b.h / 2 + fs * 0.36}" text-anchor="middle" font-family="${FONT}" font-size="${fs}" font-weight="600" fill="#fff">${xml(b.tag)}</text></g>`
  )
}

export type Row = { id: string; label: string; n: number; d: number; tone: Tone; tag: string; big?: boolean; busy?: boolean }

export function barsSvg(rows: Row[], widthPx: number): { svg: string; w: number; h: number } {
  const w = Math.max(240, Math.min(560, Math.round(widthPx)))
  const labelW = 66
  const bw = w - labelW - 4
  const defs = ['<linearGradient id="sheen" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.25"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>']
  const parts: string[] = []
  let y = 4
  for (const r of rows) {
    const h = r.big ? 16 : 10
    parts.push(`<text class="m${r.big ? ' big' : ''}" x="0" y="${y + h / 2 + 4}" font-family="${FONT}" font-size="${r.big ? 12 : 11}">${xml(r.label)}</text>`)
    parts.push(bar({ ...r, h, busy: !!r.busy }, labelW, y, bw, defs))
    y += h + (r.big ? 12 : 8)
  }
  const css =
    '.m{fill:#6b6b6b}.big{font-weight:600}.k{fill:#e4e4e2}@media (prefers-color-scheme: dark){.m{fill:#a0a0a0}.k{fill:#2c2c2c}}' +
    '.t0,.t1,.t2,.t3{animation:tw 2.2s ease-in-out infinite}.t1{animation-duration:2.8s;animation-delay:-.7s}.t2{animation-duration:1.9s;animation-delay:-1.3s}.t3{animation-duration:3.3s;animation-delay:-.4s}' +
    '@keyframes tw{0%,100%{opacity:1}50%{opacity:.3}}' +
    `.sw{animation:sw 4s linear infinite}.fast{animation-duration:1.4s}@keyframes sw{0%{transform:translateX(0)}55%,100%{transform:translateX(${bw + 44}px)}}` +
    '.glow{opacity:.2;animation:gl 2.4s ease-in-out infinite}@keyframes gl{0%,100%{opacity:.12}50%{opacity:.45}}' +
    '@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3,.sw,.glow{animation:none}}'
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${y}" viewBox="0 0 ${w} ${y}"><style>${css}</style><defs>${defs.join('')}</defs>${parts.join('')}</svg>`, w, h: y }
}

// Usage windows: green under 60%, amber under 85%, red above.
export const usageTone = (p: number): Tone => (p >= 85 ? 'critical' : p >= 60 ? 'warn' : 'ok')

export function heroSvg(s: SyncStatus, widthPx: number): { svg: string; w: number; h: number; alt: string } {
  const t = tone(s)
  const d = due(s)
  const st = s.stages
  const stageTone = (n: number): Tone => (n >= st.eligible ? 'ok' : t === 'critical' ? 'critical' : 'warn')
  const rows: Row[] = [
    { id: 'all', label: 'Saved', n: saved(s), d, tone: t, big: true, tag: `${saved(s)}/${d} · ${pct(saved(s), d)}%`, busy: s.jobs.archive.running || s.jobs.melxis.running },
    { id: 'bk', label: 'Backed up', n: st.backup, d: st.eligible, tone: stageTone(st.backup), tag: `${st.backup}`, busy: s.jobs.archive.running },
    { id: 'nt', label: 'Notes', n: st.note, d: st.eligible, tone: stageTone(st.note), tag: `${st.note}`, busy: s.jobs.archive.running },
    { id: 'mx', label: 'Melxis', n: st.melxis, d: st.eligible, tone: stageTone(st.melxis), tag: `${st.melxis}`, busy: s.jobs.melxis.running },
  ]
  const alt = `${saved(s)} of ${d} finished chats saved; backed up ${st.backup}, notes ${st.note}, Melxis ${st.melxis} of ${st.eligible}`
  return { ...barsSvg(rows, widthPx), alt }
}
