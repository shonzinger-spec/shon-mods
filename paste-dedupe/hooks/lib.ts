// paste-dedupe: finding runs of a prompt that repeat an earlier prompt. No engine calls.

/** A repeat must be at least this many lines and this many non-space characters. */
export const MIN_LINES = 8
export const MIN_CHARS = 300
/** Earlier prompts kept for matching, oldest dropped first past this many lines. */
export const MAX_HISTORY_LINES = 20000
/** Positions tried per line, so a line seen everywhere ("}") cannot blow up the scan. */
const MAX_POSITIONS = 64
/**
 * Line comparisons one prompt may spend looking for repeats. A long near-miss
 * paste (short lines repeated across many earlier prompts) could otherwise take
 * tens of seconds; past the budget the rest of the prompt is sent as is.
 */
export const MAX_STEPS = 20_000_000
export type Budget = { left: number }

/** An earlier prompt: its number, its lines as typed, and the text that entered the transcript. */
export type Entry = { msg: number; lines: string[]; at: Map<string, number[]>; sent?: string }
export type Replaced = { msg: number; lines: number }

// Blocks the app injects into a prompt (reminders, notes, command bodies): never
// the person's paste, and never rewritten.
const INJECTED = [
  'system-reminder',
  'side-sessions-event',
  'task-notification',
  'cross-session-message',
  'command-message',
  'command-name',
  'command-args',
  'skill-format',
  'local-command-stdout',
  'local-command-stderr',
  'ci-monitor-event',
]
const INJECTED_RE = new RegExp(`<~?(${INJECTED.join('|')})\\b[^>]*>[\\s\\S]*?(?:<\\/~?\\1>|$)`, 'g')

const norm = (l: string) => l.trimEnd()
const isBlank = (l: string) => l.trim() === ''

/** The prompt cut into the person's own text and injected blocks, in order. */
export function parts(text: string): { text: string; isOwn: boolean }[] {
  const out: { text: string; isOwn: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(INJECTED_RE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ text: text.slice(last, at), isOwn: true })
    out.push({ text: m[0], isOwn: false })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), isOwn: true })
  return out
}

export function entry(msg: number, lines: string[]): Entry {
  const at = new Map<string, number[]>()
  lines.forEach((l, i) => {
    if (isBlank(l)) return
    const ps = at.get(l)
    if (!ps) at.set(l, [i])
    else if (ps.length < MAX_POSITIONS) ps.push(i)
  })
  return { msg, lines, at }
}

function snippet(line: string): string {
  const t = line.trim().replace(/"/g, "'")
  return t.length > 60 ? `${t.slice(0, 57)}...` : t
}

export function marker(msg: number, lines: string[]): string {
  return `[same as message ${msg}: ${lines.length} lines identical to a paste there, starting "${snippet(lines[0])}"]`
}

/** Replace each long run of `own` that repeats a run of an earlier entry by a marker. */
export function dedupeLines(
  own: string[],
  history: readonly Entry[],
  budget: Budget = { left: MAX_STEPS },
): { lines: string[]; replaced: Replaced[] } {
  const n = own.map(norm)
  const out: string[] = []
  const replaced: Replaced[] = []
  let i = 0
  while (i < n.length) {
    if (budget.left <= 0) {
      out.push(...own.slice(i))
      break
    }
    let best = { len: 0, msg: 0 }
    if (!isBlank(n[i])) {
      scan: for (const h of history) {
        for (const p of h.at.get(n[i]) ?? []) {
          if (budget.left <= 0) break scan
          let k = 0
          while (i + k < n.length && p + k < h.lines.length && n[i + k] === h.lines[p + k]) k++
          budget.left -= k + 1
          while (k > 0 && isBlank(n[i + k - 1])) k--
          if (k > best.len) best = { len: k, msg: h.msg }
        }
      }
    }
    const run = n.slice(i, i + best.len)
    if (best.len >= MIN_LINES && run.join('').replace(/\s/g, '').length >= MIN_CHARS) {
      out.push(marker(best.msg, run))
      replaced.push({ msg: best.msg, lines: best.len })
      i += best.len
    } else {
      out.push(own[i])
      i++
    }
  }
  return { lines: out, replaced }
}

/**
 * The entries whose prompt is still in the transcript (`said`: its user
 * messages' text). A rewind or an edit drops the later prompts and /clear all of
 * them, so a marker never points at a message Claude can no longer read.
 */
export function stillSaid(history: readonly Entry[], said: readonly string[]): Entry[] {
  const all = said.join('\u0000')
  return history.filter(h => {
    const t = h.sent?.trim()
    return t !== undefined && t !== '' && all.includes(t)
  })
}

/**
 * Dedupe a prompt against the history, then add it (as sent, before any
 * replacement) to the history as message `msg`. Returns the text to send.
 */
export function dedupe(text: string, history: Entry[], msg: number): { text: string; replaced: Replaced[] } {
  const ps = parts(text)
  const budget: Budget = { left: MAX_STEPS }
  const replaced: Replaced[] = []
  const ownLines: string[] = []
  const sent = ps.map(p => {
    if (!p.isOwn) {
      ownLines.push('\u0000') // a break no run can cross
      return p.text
    }
    const lines = p.text.split('\n')
    ownLines.push(...lines.map(norm))
    const d = dedupeLines(lines, history, budget)
    replaced.push(...d.replaced)
    return d.lines.join('\n')
  })
  history.push(entry(msg, ownLines))
  let total = history.reduce((s, h) => s + h.lines.length, 0)
  while (history.length > 1 && total > MAX_HISTORY_LINES) total -= history.shift()?.lines.length ?? 0
  return { text: replaced.length ? sent.join('') : text, replaced }
}
