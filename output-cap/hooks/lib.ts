// output-cap: pure line capping, no engine calls.

export type Capped = { text: string; cut: number }

const body = (text: string) => (text.endsWith('\n') ? text.slice(0, -1) : text)

/** Lines in text, a trailing newline not counted; '' has none. */
export function lineCount(text: string): number {
  return text === '' ? 0 : body(text).split('\n').length
}

/** Keep the first ceil(max/2) and last floor(max/2) lines of text longer than max lines. */
export function capLines(text: string, max: number): Capped {
  const hasTrailingNewline = text.endsWith('\n')
  const lines = body(text).split('\n')
  if (!(max > 0) || lines.length <= max) return { text, cut: 0 }
  const head = Math.ceil(max / 2)
  const tail = max - head
  const cut = lines.length - max
  const note = `… ${cut} lines cut by output-cap (kept the first ${head} and last ${tail} of ${lines.length}; next time pipe the command through grep, head or tail to see the part you need) …`
  const kept = [...lines.slice(0, head), note, ...lines.slice(lines.length - tail)]
  return { text: kept.join('\n') + (hasTrailingNewline ? '\n' : ''), cut }
}

/**
 * One budget of max lines for stdout and stderr together: a stream that fits
 * in half of it keeps all its lines and the other takes the rest; two long
 * streams get half each.
 */
export function share(outLines: number, errLines: number, max: number): [number, number] {
  if (outLines + errLines <= max) return [outLines, errLines]
  const half = Math.floor(max / 2)
  if (errLines <= half) return [max - errLines, errLines]
  if (outLines <= max - half) return [outLines, max - outLines]
  return [max - half, half]
}

export function maxOf(options: Readonly<Record<string, unknown>> | undefined): number {
  const v = options?.max_lines
  return typeof v === 'number' && v >= 2 ? Math.floor(v) : 150
}
