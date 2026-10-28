import type { EffortNow, MemNow } from '../types'

export type Placement = 'footer' | 'band' | 'hint' | 'pane' | 'off'
export const PLACEMENTS: Placement[] = ['footer', 'band', 'hint', 'pane', 'off']
export const isPlacement = (s: unknown): s is Placement => PLACEMENTS.includes(s as Placement)

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
export const STALE_MS = 10 * 60_000
export const ARROW_MS = 90_000

export function effortCells(level: string): string {
  const n = LEVELS.indexOf(level) + 1
  return '▰'.repeat(n) + '▱'.repeat(5 - n)
}

// Effort level as a percent of the pill: low 20 ... max 100; unknown 0.
export const effortPct = (level: string): number => (LEVELS.indexOf(level) + 1) * 20

// ↑ / ↓ when the level changed within the last 90 s; '' otherwise.
export function arrow(prev: string | null, level: string | null, since: number, now: number): string {
  if (!prev || !level || prev === level || now - since > ARROW_MS) return ''
  const a = LEVELS.indexOf(prev)
  const b = LEVELS.indexOf(level)
  if (a < 0 || b < 0) return ''
  return b > a ? '↑ ' : '↓ '
}

export const stale = (at: number, now: number): boolean => !(now - at <= STALE_MS)

export const sourceText = (s: EffortNow['source']): string => (s === 'yours' ? 'you set it' : s === 'forced' ? 'forced' : 'auto')

const obj = (text: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export function parseEffort(text: string): EffortNow | null {
  const o = obj(text)
  if (!o || typeof o.level !== 'string') return null
  const source = o.source === 'forced' || o.source === 'yours' ? o.source : 'auto'
  return { level: o.level, ultracode: o.ultracode === true, reason: typeof o.reason === 'string' ? o.reason : '', source, at: num(o.at) ?? 0 }
}

export function parseMem(text: string): MemNow | null {
  const o = obj(text)
  const at = num(o?.at)
  if (!o || at === undefined || (o.level !== 'ok' && o.level !== 'warn' && o.level !== 'critical')) return null
  return { level: o.level, freePct: num(o.freePct), memTotalMB: num(o.memTotalMB), swapUsedMB: num(o.swapUsedMB) ?? 0, swapTotalMB: num(o.swapTotalMB) ?? 0, at }
}

const g1 = (mb: number) => (mb / 1000).toFixed(1)

export type Seg = { text: string; color?: string; backgroundColor?: string; bold?: boolean }

// A pill progress bar as styled segments: caps, `width` body cells, 1/8-cell edge, centered label.
// Total visible width is always width + 2.
export function pill(pct: number, width: number, fill: string, track: string, label: string): Seg[] {
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0))
  const eighths = Math.round((p / 100) * width * 8)
  const full = Math.floor(eighths / 8)
  const part = eighths % 8
  const start = Math.floor((width - label.length) / 2)
  const cells: Seg[] = []
  for (let i = 0; i < width; i++) {
    const filled = i < full
    const k = i - start
    if (k >= 0 && k < label.length) {
      cells.push(filled ? { text: label[k] as string, color: '#FFFFFF', backgroundColor: fill, bold: true } : { text: label[k] as string, color: '#C9CED6', backgroundColor: track })
    } else if (filled) cells.push({ text: ' ', backgroundColor: fill })
    else if (i === full && part) cells.push({ text: ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'][part] as string, color: fill, backgroundColor: track })
    else cells.push({ text: ' ', backgroundColor: track })
  }
  const all: Seg[] = [{ text: '◖', color: p === 0 ? track : fill }, ...cells, { text: '◗', color: p === 100 ? fill : track }]
  const out: Seg[] = []
  for (const c of all) {
    const l = out[out.length - 1]
    if (l && l.color === c.color && l.backgroundColor === c.backgroundColor && l.bold === c.bold) l.text += c.text
    else out.push({ ...c })
  }
  return out
}

// The numbers beside the bar. Used % may be a tween frame, so it is passed in.
export const usedPct = (m: { freePct?: number }): number | undefined => (m.freePct === undefined ? undefined : 100 - m.freePct)
export const freeGB = (m: { freePct?: number; memTotalMB?: number }): string | null =>
  m.memTotalMB && m.freePct !== undefined ? g1((m.memTotalMB * m.freePct) / 100) : null
export const swapPct = (m: { swapTotalMB: number; swapUsedMB: number }): number | null =>
  m.swapTotalMB > 0 ? Math.round((m.swapUsedMB / m.swapTotalMB) * 100) : null

export const MEM_COLOR = { ok: 'green', warn: 'yellow', critical: 'red' } as const
export const MEM_FILL = { ok: '#14B8A6', warn: '#F59E0B', critical: '#EF4444' } as const
export const EFFORT_FILL = '#8B5CF6'
export const EFFORT_TRACK = '#2E2A3D'
export const MEM_TRACK = '#23303A'

// Swap segment color: amber from 85%, red from 97%, null = dim.
export const swapColor = (pct: number): string | null => (pct >= 97 ? '#EF4444' : pct >= 85 ? '#F59E0B' : null)

// Values from `from` to `to` in `steps` equal steps; the last is exactly `to`.
export function tween(from: number, to: number, steps: number): number[] {
  const n = Math.max(1, Math.floor(steps))
  const out: number[] = []
  for (let i = 1; i < n; i++) out.push(from + ((to - from) * i) / n)
  out.push(to)
  return out
}

type EveryFn = (ms: number, fn: () => void) => { cancel: () => void }

// Plays `frames` one per `ms` on one timer, stops that timer after the last frame, then calls `done`.
// Returns a stop function (safe to call twice) so a newer change can cancel it.
export function runAnim(every: EveryFn, ms: number, frames: number[], draw: (v: number, i: number) => void, done: () => void): () => void {
  if (!frames.length) {
    done()
    return () => undefined
  }
  let i = 0
  let stopped = false
  let timer: { cancel: () => void } | null = null
  const stop = () => {
    if (stopped) return
    stopped = true
    timer?.cancel()
  }
  timer = every(ms, () => {
    if (stopped) return
    draw(frames[i] as number, i)
    if (++i >= frames.length) {
      stop()
      done()
    }
  })
  return stop
}

// Plain-text strip (PromptHint tail has no colors).
export function stripText(e: EffortNow | null, arr: string, m: MemNow | null): string {
  const parts: string[] = []
  if (e) parts.push(`effort ${effortCells(e.level)} ${arr}${e.level}`)
  if (m) {
    const u = usedPct(m)
    parts.push(`ram ${u === undefined ? '?' : `${Math.round(u)}%`}`)
    const sw = swapPct(m)
    if (sw !== null) parts.push(`swap ${sw}%`)
  }
  return parts.join(' · ')
}

// ---- Desktop SVG strip (rounded bars; terminals keep the text pills) ----
// `phase` (seconds): draw one still frame of the animation at that moment instead of
// in-image <animate> (the footer slot shows the image frozen, so it is redrawn in frames).
export type SvgModel = { e: EffortNow | null; epct?: number | null; arr: string; m: MemNow | null; pct?: number | null; motion: boolean; phase?: number }

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"
const xml = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const charEm = (ch: string): number => (/[\s.,:;'|!il1()[\]·]/.test(ch) ? 0.3 : /[A-Zmw@%+]/.test(ch) ? 0.72 : 0.56)
const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)
const GRAD = { violet: ['#A78BFA', '#8B5CF6'], ok: ['#2DD4BF', '#14B8A6'], warn: ['#FBBF24', '#F59E0B'], critical: ['#F87171', '#EF4444'] } as const
// One frame of a looping wave: `hi` at t = 0, `lo` half a period later.
export const wave = (t: number, period: number, lo: number, hi: number): number =>
  lo + (hi - lo) * (0.5 + 0.5 * Math.cos((2 * Math.PI * (((t % period) + period) % period)) / period))
// The sweep's x at time t: crosses the track in the first 55% of a 4 s cycle, then waits.
export const sweepX = (t: number, w: number): number => {
  const u = (((t % 4) + 4) % 4) / 4
  return u < 0.55 ? -40 + (w + 44) * (u / 0.55) : w + 4
}
const SW = 12 // pill height
const CELL = 3 // dot grid
const noise = (a: number, b: number): number => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v) }
const SH = 22 // strip height
const FS = 11

// The strip as one SVG; `w`/`alt` are what the Svg element needs.
export function svgStrip(o: SvgModel): { svg: string; w: number; alt: string } {
  const parts: string[] = []
  const defs: string[] = []
  const alts: string[] = []
  let x = 0
  const y = SH / 2 + 4
  const text = (s: string, cls: string, extra = '') => {
    parts.push(`<text class="${cls}" x="${x}" y="${y}" font-family="${FONT}" font-size="${FS}"${extra}>${xml(s)}</text>`)
    x += textWidth(s, FS)
  }
  // Savvy-style bar: muted rounded track, a dotted fill that thickens toward its
  // head (dots twinkle unless motion is off), and a solid tag riding at the head.
  const bar = (id: string, w: number, pct: number, kind: keyof typeof GRAD, label: string) => {
    const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0))
    const fw = Math.round((p / 100) * w)
    const color = GRAD[kind][1]
    const gid = `${id}-${kind}`
    const y0 = (SH - SW) / 2
    const cols = Math.floor(fw / CELL)
    const rows = Math.floor(SW / CELL)
    // Dots in four groups that twinkle out of phase (SVG's own <animate>, so the
    // motion plays inside the image wherever it is drawn).
    const groups = ['', '', '', '']
    for (let c = 0; c < cols; c++) {
      const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
      for (let r = 0; r < rows; r++) {
        if (noise(c, r) < density) groups[Math.floor(noise(r, c) * 4)] += `<rect x="${c * CELL + 0.5}" y="${r * CELL + 0.5}" width="2" height="2"/>`
      }
    }
    const tw = [['2.2s', '0s'], ['2.8s', '0.7s'], ['1.9s', '1.3s'], ['3.3s', '0.4s']]
    const dots = groups
      .map((g, i) => {
        if (!g) return ''
        const dur = parseFloat(tw[i]![0]!), begin = parseFloat(tw[i]![1]!)
        if (o.motion && o.phase !== undefined) return `<g class="t${i}" opacity="${wave(o.phase - begin, dur, 0.25, 1).toFixed(2)}">${g}</g>`
        return `<g class="t${i}">${g}${o.motion ? `<animate attributeName="opacity" values="1;0.25;1" dur="${tw[i]![0]}" begin="${tw[i]![1]}" repeatCount="indefinite"/>` : ''}</g>`
      })
      .join('')
    const tagW = Math.round(16 + textWidth(label, FS - 1))
    const tx = Math.max(0, Math.min(w - tagW, fw - tagW))
    // A soft glow that breathes behind the tag, and a light sweep along the track.
    const glow = o.motion && o.phase !== undefined
      ? `<rect x="${tx - 3}" y="-2" width="${tagW + 6}" height="${SW + 4}" rx="${(SW + 4) / 2}" fill="${color}" opacity="${(0.57 - wave(o.phase, 2.4, 0.12, 0.45)).toFixed(2)}"/>`
      : o.motion
      ? `<rect x="${tx - 3}" y="-2" width="${tagW + 6}" height="${SW + 4}" rx="${(SW + 4) / 2}" fill="${color}" opacity="0.2"><animate attributeName="opacity" values="0.12;0.45;0.12" dur="2.4s" repeatCount="indefinite"/></rect>`
      : ''
    const sweep = o.motion && o.phase !== undefined
      ? `<rect x="${sweepX(o.phase, w).toFixed(1)}" width="36" height="${SW}" fill="url(#s${gid})"/>`
      : o.motion
      ? `<rect x="-40" width="36" height="${SW}" fill="url(#s${gid})"><animate attributeName="x" values="-40;${w + 4};${w + 4}" keyTimes="0;0.55;1" dur="4s" repeatCount="indefinite"/></rect>`
      : ''
    defs.push(`<linearGradient id="s${gid}" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`)
    defs.push(`<clipPath id="c${gid}"><rect width="${w}" height="${SW}" rx="${SW / 2}"/></clipPath>`)
    parts.push(
      `<g transform="translate(${x},${y0})"><rect class="k" width="${w}" height="${SW}" rx="${SW / 2}"/>` +
        `<g clip-path="url(#c${gid})"><g fill="${color}">${dots}</g>${sweep}</g>` +
        glow +
        `<rect x="${tx}" width="${tagW}" height="${SW}" rx="${SW / 2}" fill="${color}"/>` +
        `<text x="${tx + tagW / 2}" y="${SW / 2 + 3.8}" text-anchor="middle" font-family="${FONT}" font-size="${FS - 1}" font-weight="600" fill="#fff">${xml(label)}</text></g>`,
    )
    x += w
  }
  if (o.e) {
    text('effort', 'm')
    x += 6
    bar('e', 120, o.epct ?? effortPct(o.e.level), 'violet', o.e.level)
    const tail = `${o.arr ? ` ${o.arr.trim()}` : ''} ${sourceText(o.e.source)}`
    parts.push(`<text class="m" x="${x}" y="${y}" font-family="${FONT}" font-size="${FS}" xml:space="preserve">${xml(tail)}</text>`)
    x += textWidth(tail, FS)
    if (o.e.ultracode) text(' + team', '', ` fill="${EFFORT_FILL}"`)
    alts.push(`effort ${o.e.level}`)
  }
  if (o.e && o.m) x += 14
  if (o.m) {
    const m = o.m
    const used = o.pct ?? usedPct(m)
    const free = freeGB(m)
    const sw = swapPct(m)
    text('ram', 'm')
    x += 6
    bar('m', 160, used ?? 0, m.level, used === undefined ? '?' : `${Math.round(used)}%`)
    if (free) {
      x += 6
      text(`${free}G free`, 'm')
    }
    if (sw !== null) {
      x += 6
      if (free) {
        text('·', 'm')
        x += 6
      }
      text('swap ', 'm')
      const c = swapColor(sw)
      text(`${sw}%`, c ? '' : 'm', c ? ` fill="${c}"` : '')
    }
    alts.push(`ram ${used === undefined ? 'unknown' : `${Math.round(used)}% used`}`)
    if (sw !== null) alts.push(`swap ${sw}%`)
  }
  const w = Math.min(900, Math.ceil(x) + 2)
  const css =
    '.m{fill:#8a8a8a}.k{fill:#e4e4e2}@media (prefers-color-scheme: dark){.m{fill:#9a9a9a}.k{fill:#2c2c2c}}' +
    (o.motion
      ? '.t0,.t1,.t2,.t3{animation:tw 2.2s ease-in-out infinite}.t1{animation-duration:2.8s;animation-delay:-.7s}.t2{animation-duration:1.9s;animation-delay:-1.3s}.t3{animation-duration:3.3s;animation-delay:-.4s}@keyframes tw{0%,100%{opacity:1}50%{opacity:.3}}@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}'
      : '')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${SH}" viewBox="0 0 ${w} ${SH}"><style>${css}</style><defs>${defs.join('')}</defs>${parts.join('')}</svg>`
  return { svg, w, alt: alts.join(', ') }
}

export const stripSvg = (o: SvgModel): string => svgStrip(o).svg
