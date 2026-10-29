// Pure enforcement rules for the spawn router (step 3a). No `$` here.
//
// agent.spawn: the model half (raise always; lower only when allowed). turn.step: the effort half
// (raise always; lower only when allowed; caller-chosen effort kept) and the max->xhigh cap on
// every subagent step. Escalation after a failed check is in escalate.ts (`Plan.escalate`).
import type { Decision } from './classify.ts'

const MODEL_TIERS = ['haiku', 'sonnet', 'opus', 'fable'] as const
const EFFORT_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 }

/** Tier of a model id or alias by substring (haiku < sonnet < opus < fable); -1 when unknown. */
export function tier(model: string | null | undefined): number {
  if (!model) return -1
  const m = model.toLowerCase()
  for (let i = MODEL_TIERS.length - 1; i >= 0; i--) if (m.includes(MODEL_TIERS[i])) return i
  return -1
}

export function effortRank(effort: unknown): number {
  return typeof effort === 'string' && effort in EFFORT_RANK ? EFFORT_RANK[effort] : -1
}

export type SpawnFacts = {
  subagentType: string
  provider?: { plugin?: string }
  model?: string
  parentModel?: string
  fork: boolean
}

export type Ctx = {
  pins: Record<string, string>
  calibrated: ReadonlySet<string>
  agentMap: Record<string, string>
}

export type Plan = {
  kind: 'inherited' | 'forced' | 'suggested'
  /** The model to send in agent.spawn, or null to leave e.model alone. */
  model: string | null
  baseline: string | null
  /** May turn.step lower this agent's effort (checked/calibrated class, and agent_map names a plugin type)? */
  lowerAllowed: boolean
  /** Leave effort alone except the cap: caller chose the model or the effort. */
  keepEffort: boolean
  /** Route changes that were not applied (logged as suggestions). */
  notApplied: string[]
  /** Step 3b: the model was raised by escalation after a failed check (set by register, see escalate.ts). */
  escalate: boolean
}

export function isPluginType(e: SpawnFacts): boolean {
  return (e.provider?.plugin ?? 'engine') !== 'engine'
}

export function planSpawn(e: SpawnFacts, d: Decision, ctx: Ctx, callerEffort: unknown): Plan {
  const plan: Plan = { kind: 'suggested', model: null, baseline: null, lowerAllowed: false, keepEffort: false, notApplied: [], escalate: false }
  if (e.fork) return { ...plan, kind: 'inherited', keepEffort: true }
  if (e.model) return { ...plan, kind: 'forced', keepEffort: true }
  const plugin = isPluginType(e)
  const pin = ctx.pins[e.subagentType]
  plan.baseline = pin ?? e.parentModel ?? null
  plan.keepEffort = callerEffort !== undefined && callerEffort !== null
  plan.lowerAllowed = (d.mode === 'checked' || ctx.calibrated.has(d.cls)) && (!plugin || e.subagentType in ctx.agentMap)
  if (d.model === 'inherit') return plan
  const tr = tier(d.model)
  const tb = tier(plan.baseline)
  if (tr < 0 || tb < 0) return plan
  // An unpinned (plugin) type's baseline is the parent, so a raise is always to at least the parent's
  // tier: an unknown pin is never risked downward by a raise.
  if (tr > tb) plan.model = d.model
  else if (tr < tb) {
    if (plan.lowerAllowed) plan.model = d.model
    else plan.notApplied.push(`lower model ${plan.baseline}→${d.model}`)
  }
  return plan
}

/**
 * The effort to send on a subagent step. `route` is the route's effort (undefined: none, e.g. haiku
 * or inherit). Absent or numeric step effort is left alone (a model without effort, or a budget).
 */
export function stepEffort(
  current: unknown,
  route: string | undefined,
  plan: Pick<Plan, 'lowerAllowed' | 'keepEffort'> | null,
): { effort: unknown; note: string | null } {
  let out = current
  let note: string | null = null
  const rc = effortRank(current)
  const rr = effortRank(route)
  if (plan && !plan.keepEffort && rc >= 0 && rr >= 0 && rr !== rc) {
    if (rr > rc || plan.lowerAllowed) out = route
    else note = `lower effort ${String(current)}→${route}`
  }
  if (out === 'max') out = 'xhigh' // the cap: no subagent step runs at max
  return { effort: out, note }
}
