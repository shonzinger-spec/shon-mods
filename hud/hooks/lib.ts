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
