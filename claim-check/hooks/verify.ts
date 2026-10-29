/** One thing that happened this turn: a check command ran, or a file was edited. */
export type Entry = { k: 'check'; green: boolean } | { k: 'edit' }

export type Verdict = 'no-check' | 'failed' | 'stale'

const CHECK = new RegExp(
  String.raw`\bclaude\s+plugin\s+(?:test|validate)\b` +
    String.raw`|\bpytest\b` +
    String.raw`|\bpython3?(?:\.\d+)?\s+-m\s+(?:pytest|unittest)\b` +
    String.raw`|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b` +
    String.raw`|\b(?:vitest|jest|tsc)\b` +
    String.raw`|\btscheck\.sh\b` +
    String.raw`|\bcargo\s+test\b` +
    String.raw`|\bgo\s+test\b` +
    String.raw`|\bmake\s+test\b` +
    String.raw`|\bruff\b` +
    String.raw`|\beslint\b` +
    String.raw`|\bnode\s+--test\b` +
    String.raw`|\bbash\s+-n\b`,
  'i',
)

const FAILS = [
  /Exit code [1-9]/,
  /^FAIL\b/m,
  /[1-9]\d* (failed|failing)/,
  /^\s*[1-9]\d* fail\b/m,
  /^\(fail\)/m,
  /\b[1-9]\d* errors?\b/,
  /error TS\d+/,
]

const EXPLICIT =
  /\b(?:tests|checks|suite|build|lint|typecheck)\s+(?:(?:is|are|all)\s+)?(?:pass|passed|passes|passing|green|clean)\b|\bverified\b/i

const GENERIC = /\b(?:done|fixed|complete(?:d)?|implemented|resolved|ready)\b|\bworks\s+now\b/i

const NEGATED =
  /\b(?:not|never)\b\s*(?:(?:been|yet|really)\s+)?(?:verified|done|fixed|complete(?:d)?|implemented|resolved|ready)\b|n't\s+(?:(?:been|yet|really)\s+)?(?:verified|done|fixed|complete(?:d)?|implemented|resolved|ready)\b|\bun(?:verified|done|fixed|complete(?:d)?|implemented|resolved|ready)\b/i

/** True when a shell command runs a test, lint, build or typecheck. */
export function isCheckCommand(cmd: string, extra?: string[]): boolean {
  if (!cmd) return false
  if (CHECK.test(cmd)) return true
  for (const src of extra ?? []) {
    let re: RegExp
    try {
      re = new RegExp(src, 'i')
    } catch {
      continue
    }
    if (re.test(cmd)) return true
  }
  return false
}

/** True when a check's tool result shows no failure. */
export function isGreen(r: { isError?: boolean; text?: string }): boolean {
  if (r.isError) return false
  const text = r.text ?? ''
  return !FAILS.some(re => re.test(text))
}

/** 'explicit' when the reply says tests/checks pass or verified; 'generic' for done/fixed; else null. */
export function claimsDone(reply: string): 'explicit' | 'generic' | null {
  if (!reply) return null
  // Negation applies per clause: a negated clause is dropped, other claims still count.
  const clauses = reply.split(/[.!?;\n]+(?=\s|$)/).filter(c => !NEGATED.test(c))
  const text = clauses.join('. ')
  if (EXPLICIT.test(text)) return 'explicit'
  if (GENERIC.test(text)) return 'generic'
  return null
}

/** Whether the reply's done-claim is backed by the turn's log. */
export function gateVerdict(log: Entry[], reply: string): Verdict | null {
  const claim = claimsDone(reply)
  if (claim === null) return null
  if (claim === 'generic' && !log.some(e => e.k === 'edit')) return null
  let lastCheck = -1
  for (let i = 0; i < log.length; i++) if (log[i]!.k === 'check') lastCheck = i
  if (lastCheck < 0) return 'no-check'
  const check = log[lastCheck] as { k: 'check'; green: boolean }
  if (!check.green) return 'failed'
  for (let i = lastCheck + 1; i < log.length; i++) if (log[i]!.k === 'edit') return 'stale'
  return null
}
