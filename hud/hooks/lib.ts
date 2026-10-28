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

const COLORS: Record<string, string> = { low: 'green', medium: 'cyan', high: 'yellow', xhigh: 'magenta', max: 'red' }
export const effortColor = (level: string): string => COLORS[level] ?? 'white'

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

// A horizontal bar: `fill` drawn in the level color, `track` dim. Eighth blocks
// make the edge smooth; the two parts always add up to `width` cells.
export function bar(pct: number, width = 12): { fill: string; track: string } {
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0))
  const eighths = Math.round((p / 100) * width * 8)
  const full = Math.floor(eighths / 8)
  const part = eighths % 8
  const fill = '█'.repeat(full) + (part ? ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'][part] : '')
  return { fill, track: '░'.repeat(width - full - (part ? 1 : 0)) }
}

// The numbers beside the bar. Used % may be a tween frame, so it is passed in.
export const usedPct = (m: { freePct?: number }): number | undefined => (m.freePct === undefined ? undefined : 100 - m.freePct)
export const freeGB = (m: { freePct?: number; memTotalMB?: number }): string | null =>
  m.memTotalMB && m.freePct !== undefined ? g1((m.memTotalMB * m.freePct) / 100) : null
export const swapPct = (m: { swapTotalMB: number; swapUsedMB: number }): number | null =>
  m.swapTotalMB > 0 ? Math.round((m.swapUsedMB / m.swapTotalMB) * 100) : null

export const MEM_COLOR = { ok: 'green', warn: 'yellow', critical: 'red' } as const

export const SEP = '  │  '

// Swap segment color: yellow from 85%, red from 97%, null = dim.
export const swapColor = (pct: number): 'yellow' | 'red' | null => (pct >= 97 ? 'red' : pct >= 85 ? 'yellow' : null)

// Values from `from` to `to` in `steps` equal steps; the last is exactly `to`.
export function tween(from: number, to: number, steps: number): number[] {
  const n = Math.max(1, Math.floor(steps))
  const out: number[] = []
  for (let i = 1; i < n; i++) out.push(from + ((to - from) * i) / n)
  out.push(to)
  return out
}

// Cell counts one step at a time from `from` (not included) to `to` (included).
export function fillFrames(from: number, to: number): number[] {
  const out: number[] = []
  const d = to > from ? 1 : -1
  for (let n = from + d; from !== to && (d > 0 ? n <= to : n >= to); n += d) out.push(n)
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
  if (e) parts.push(`⚡ ${arr}${e.level} ${effortCells(e.level)} ${sourceText(e.source)}${e.ultracode ? ' + team' : ''}`)
  if (m) {
    const u = usedPct(m)
    const b = bar(u ?? 0)
    const g = freeGB(m)
    parts.push(`▣ RAM ${b.fill}${b.track} ${u === undefined ? '?' : `${Math.round(u)}%`}${g ? ` · ${g}G free` : ''}`)
    const sw = swapPct(m)
    if (sw !== null) parts.push(`swap ${sw}%`)
  }
  return parts.join(SEP)
}
