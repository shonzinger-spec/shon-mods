// Pure escalation rules (step 3b). No `$` here.
//
// A run of a `checked` route whose LAST test/build check failed marks its task. Re-spawning that task
// within WINDOW_MS routes it one model tier up (once per task key); later re-spawns hold that tier.
import { effortRank, tier } from './enforce.ts'

export const WINDOW_MS = 30 * 60 * 1000
const UP = ['haiku', 'sonnet', 'opus', 'fable'] as const

/** One task key's last run: what it ran at, whether its last check failed, whether it was escalated. */
export type TaskEntry = { ts: number; model: string | null; checkFailed: boolean; escalated: boolean }

const CHECK =
  /\bpytest\b|\bclaude\s+plugin\s+test\b|\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bcargo\s+(?:test|build)\b|\bgo\s+test\b|\btsc\b|\bmake\s+test\b|\bnode\s+--test\b|\bvitest\b|\bjest\b/

/** Does a Bash command look like a deterministic test/build check? */
export function isCheckCommand(command: unknown): boolean {
  return typeof command === 'string' && CHECK.test(command)
}

const COUNTER = /(?:^|[\s\-–—:,;(\[]+)(?:(?:round|attempt|retry|try)(?:\s*#?\s*\d+)?|#\s*\d+)[\s)\]]*$/

/** Task key: normalised description (trailing round/attempt/retry counters stripped) + subagentType. */
export function taskKey(description: string, subagentType: string): string {
  let d = description.toLowerCase().replace(/\s+/g, ' ').trim()
  for (let prev = ''; prev !== d; ) {
    prev = d
    d = d.replace(COUNTER, '').trim()
  }
  return `${d}\u0000${subagentType}`
}

/** The alias one tier above `model`, or null at the top or for an unknown model. */
export function tierUp(model: string | null): string | null {
  const t = tier(model)
  return t >= 0 && t + 1 < UP.length ? UP[t + 1] : null
}

/** Effort for an escalated run: the class effort, raised to `high` when the target is opus or above. */
export function escalatedEffort(classEffort: string | undefined, model: string): string | undefined {
  if (tier(model) < tier('opus')) return classEffort
  return effortRank(classEffort) >= effortRank('high') ? classEffort : 'high'
}

export type Escalation = { escalated: boolean; model: string | null }

/**
 * Decide a re-spawn of a checked task. `prev` is its last run (already filtered to the window).
 * Returns the model to route at (null: no rewrite) and whether the row is marked escalated.
 */
export function escalation(prev: TaskEntry | undefined, callerModel: string | undefined): Escalation {
  if (!prev) return { escalated: false, model: null }
  // A caller-set model wins; the row notes an escalation when the caller went above the last run.
  if (callerModel) return { escalated: prev.escalated || tier(callerModel) > tier(prev.model), model: null }
  if (prev.escalated) return { escalated: true, model: prev.model } // hold the escalated tier, no further climb
  if (!prev.checkFailed) return { escalated: false, model: null }
  const up = tierUp(prev.model)
  return up ? { escalated: true, model: up } : { escalated: false, model: null }
}

export function prune(tasks: Map<string, TaskEntry>, now: number): void {
  for (const [k, v] of tasks) if (now - v.ts > WINDOW_MS) tasks.delete(k)
}
