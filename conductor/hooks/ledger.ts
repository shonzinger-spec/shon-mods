// Pure helpers for the route/usage ledger and the band. No `$` here.
import type { Decision, SpawnInput } from './classify.ts'
import type { Band } from '../types'

export type RouteRow = {
  type: 'route'
  ts: string
  agentId: string | null
  description: string
  subagentType: string
  workflowRunId: string | null
  workflowIndex: number | null
  requestedModel: string | null
  resolvedModel: string | null
  cls: string
  suggestedModel: string
  suggestedEffort: string | null
  mode: string
  routeMode: string
  reason: string
  /** true when anything changed: the spawn's model or any step's effort. */
  applied: boolean
  before: { model: string | null; effort: string | null }
  after: { model: string | null; effort: string | null }
  /** Route changes logged but not applied (lowerings outside checked/calibrated, ...). */
  notApplied: string[]
  /** Reserved for step 3b (escalation after a failed check). */
  escalated: boolean
  checkFailed: boolean
  kind: 'inherited' | 'forced' | 'suggested'
}

export type Tokens = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

/** One row per (agentId, model): cumulative over the agent's steps, rewritten in place in memory. */
export type UsageRow = Tokens & {
  type: 'usage'
  agentId: string
  subagentType: string | null
  description: string | null
  model: string
  steps: number
  firstTs: string
  lastTs: string
}

export type SpawnEvent = SpawnInput & { workflow?: { runId: string; agentIndex?: number } }

export function kindOf(e: { fork: boolean; model?: string }): RouteRow['kind'] {
  return e.fork ? 'inherited' : e.model ? 'forced' : 'suggested'
}

export function routeRow(
  ts: string,
  mode: string,
  e: SpawnEvent,
  d: Decision,
  r: { model?: string; agentId?: string } | undefined,
  p: { kind?: RouteRow['kind']; model?: string | null; baseline?: string | null; notApplied?: string[] } = {},
): RouteRow {
  const rewrote = !!p.model
  return {
    type: 'route',
    ts,
    agentId: r?.agentId ?? null,
    description: e.description,
    subagentType: e.subagentType,
    workflowRunId: e.workflow?.runId ?? null,
    workflowIndex: e.workflow?.agentIndex ?? null,
    requestedModel: e.model ?? null,
    resolvedModel: r?.model ?? null,
    cls: d.cls,
    suggestedModel: d.model,
    suggestedEffort: d.effort ?? null,
    mode,
    routeMode: d.mode,
    reason: d.reason,
    applied: rewrote,
    before: { model: rewrote ? (p.baseline ?? null) : (r?.model ?? null), effort: null },
    after: { model: r?.model ?? null, effort: null },
    notApplied: p.notApplied ?? [],
    escalated: false,
    checkFailed: false,
    kind: p.kind ?? kindOf(e),
  }
}

export function addUsage(row: UsageRow, u: Partial<Tokens>, ts: string): void {
  row.input_tokens += u.input_tokens ?? 0
  row.output_tokens += u.output_tokens ?? 0
  row.cache_read_input_tokens += u.cache_read_input_tokens ?? 0
  row.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
  row.steps += 1
  row.lastTs = ts
}

export function ledgerPath(home: string, startMs: number, sessionId: string): string {
  const date = new Date(startMs).toISOString().slice(0, 10)
  return `${home}/.claude/conductor/ledger/${date}-${sessionId.replace(/[^A-Za-z0-9_.-]/g, '_')}.jsonl`
}

/** Rows already in a session's ledger file, so a mod reload appends instead of overwriting them. */
export function parseLedger(text: string): { routes: RouteRow[]; usage: UsageRow[] } {
  const routes: RouteRow[] = []
  const usage: UsageRow[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (r?.type === 'route') routes.push(r)
      else if (r?.type === 'usage' && typeof r.agentId === 'string') usage.push(r)
    } catch {
      // a torn line from a crash mid-write is dropped
    }
  }
  return { routes, usage }
}

export function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

export function bandText(b: Band, bus: { threads: number; held: number } = { threads: 0, held: 0 }): string {
  let t = bandBase(b)
  if (b.on && b.main) t = `${t} · ${b.main}`
  if (b.on && bus.threads) t = `${t} · threads ${bus.threads}`
  if (b.on && bus.held) t = `${t} · held ${bus.held}`
  return t
}

function bandBase(b: Band): string {
  if (!b.on) return 'conductor · off'
  const errs = b.errors ? ` · errors ${b.errors}` : ''
  if (b.routesError) return `conductor · ${b.mode} · routes invalid: ${clip(b.routesError, 80)}${errs}`
  if (!b.last) return `conductor · ${b.mode} · no spawns yet${errs}`
  const l = b.last
  const target = l.model === 'inherit' ? 'inherit' : `${l.model}/${l.effort ?? '-'}`
  const did = l.applied === undefined ? '' : l.applied ? ` · applied ${l.applied}` : ' · unchanged'
  return `conductor · ${b.mode} · last: ${clip(l.desc, 30)} → ${l.cls} ${target}${did}${errs}`
}

export function whyLine(r: RouteRow): string {
  const target = r.suggestedModel === 'inherit' ? 'inherit' : `${r.suggestedModel}/${r.suggestedEffort ?? '-'}`
  return `${r.ts.slice(11, 19)} ${clip(r.description, 40)} [${r.subagentType}] → ${r.cls} ${target} (${r.kind}${r.applied ? ', applied' : ''}, ran ${r.resolvedModel ?? '?'}): ${r.reason}`
}
