import type { EngineInterface } from 'claude-code'

import { tier } from './enforce.ts'

// Step 8: calibration (SPEC §4). Off by default (store key `calibrate`).
// One run in SAMPLE_EVERY of a read-only class is repeated as a shadow on the other side of the
// route's lowering, tagged SHADOW_TAG; shadows are never routed or sampled again. Each pair is
// judged (identical text, else an opus judge); PROMOTE_AT straight agreements promote the class,
// which makes its lowering enforced; any miss resets it. Shadow + judge spend is capped per UTC day.

export const SHADOW_TAG = 'cx-shadow'
/** Only these classes may be shadowed: anything that edits, runs scripts or sends would execute twice. */
export const READ_ONLY: ReadonlySet<string> = new Set(['locate', 'extract'])
export const SAMPLE_EVERY = 10
export const DAILY_CAP_USD = 10
export const PROMOTE_AT = 60
export const JUDGE_MODEL = 'opus'

export type ClassCal = { agree: number; total: number; promoted: boolean; seen: number }
export type CalState = { version: 1; classes: Record<string, ClassCal>; spend: { day: string; usd: number } }
export type Verdict = 'agree' | 'miss' | 'void'
export type EvalRow = {
  ts: string; cls: string; original: string; shadow: string; originalModel: string | null; shadowModel: string
  verdict: Verdict; judge: 'exact' | 'opus' | 'none'; costUsd: number; note?: string
}

export function emptyState(): CalState {
  return { version: 1, classes: {}, spend: { day: '', usd: 0 } }
}

export function isShadow(description: unknown): boolean {
  return typeof description === 'string' && description.includes(SHADOW_TAG)
}

export function tagShadow(description: string, id = 0): string {
  return `${description} [${SHADOW_TAG} #${id}]`
}

export function shadowId(description: string): number | null {
  const m = new RegExp(`\\[${SHADOW_TAG} #(\\d+)\\]`).exec(description)
  return m ? Number(m[1]) : null
}

/** A run that may be sampled: a read-only class, not a fork or workflow agent, not itself a shadow. */
export function eligible(cls: string, e: { fork: boolean; workflow?: unknown; description: string }): boolean {
  return READ_ONLY.has(cls) && !e.fork && !e.workflow && !isShadow(e.description)
}

function cal(st: CalState, cls: string): ClassCal {
  return (st.classes[cls] ??= { agree: 0, total: 0, promoted: false, seen: 0 })
}

export function spendToday(st: CalState, day: string): number {
  return st.spend.day === day ? st.spend.usd : 0
}

export function addSpend(st: CalState, day: string, usd: number): void {
  if (st.spend.day !== day) st.spend = { day, usd: 0 }
  st.spend.usd += usd
}

/** Count an eligible run; true on every SAMPLE_EVERY-th one while today's spend is under the cap. */
export function shouldSample(st: CalState, cls: string, day: string): boolean {
  const c = cal(st, cls)
  c.seen += 1
  return c.seen % SAMPLE_EVERY === 0 && spendToday(st, day) < DAILY_CAP_USD
}

/** Apply one judged pair: an agreement counts, a miss resets the class (and demotes it). */
export function record(st: CalState, cls: string, verdict: Verdict): void {
  if (verdict === 'void') return
  const c = cal(st, cls)
  if (verdict === 'miss') {
    c.agree = 0
    c.total = 0
    c.promoted = false
    return
  }
  c.agree += 1
  c.total += 1
  if (c.agree >= PROMOTE_AT && c.agree === c.total) c.promoted = true
}

export function promoted(st: CalState): Set<string> {
  return new Set(Object.entries(st.classes).filter(([k, c]) => c.promoted && READ_ONLY.has(k)).map(([k]) => k))
}

/** The shadow runs on the other side of the lowering; null when both sides are the same tier. */
export function shadowModel(routeModel: string, originalModel: string | null | undefined, parentModel: string | undefined): string | null {
  const tr = tier(routeModel)
  const to = tier(originalModel)
  if (tr < 0 || to < 0) return null
  if (to > tr) return routeModel
  const up = parentModel && tier(parentModel) > tr ? parentModel : null
  return up
}

// USD per million tokens [input, output]; cache read 0.1x input, cache write 1.25x input.
// Unknown models are priced as opus, so the daily cap errs toward stopping early.
const PRICES: [string, number, number][] = [['haiku', 1, 5], ['sonnet', 3, 15], ['opus', 5, 25]]
export type Tok = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
export function costUSD(model: string | null | undefined, u: Tok): number {
  const m = (model ?? '').toLowerCase()
  const [, pin, pout] = PRICES.find(([k]) => m.includes(k)) ?? PRICES[2]
  const inTok = (u.input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0)
  return (inTok * pin + (u.output_tokens ?? 0) * pout) / 1e6
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

export function judgePrompt(task: string, a: string, b: string): string {
  return [
    'Two runs of the same read-only task (locating or extracting information) produced the outputs below.',
    'Judge against the task and the source material it names: do both outputs give the same substantive answer',
    '(same files/locations/facts; wording and order may differ)? A missing or wrong item in either is a disagreement.',
    'Reply with AGREE or DISAGREE on the first line, then one line of reason.',
    '', '<task>', task, '</task>', '', '<output_a>', a, '</output_a>', '', '<output_b>', b, '</output_b>',
  ].join('\n')
}

export function parseVerdict(text: string): Verdict {
  const first = text.trim().split('\n')[0]?.trim().toUpperCase() ?? ''
  if (first.startsWith('DISAGREE')) return 'miss'
  if (first.startsWith('AGREE')) return 'agree'
  return 'void'
}

export function parseState(text: string): CalState {
  const j = JSON.parse(text) as Partial<CalState>
  return { version: 1, classes: { ...(j.classes ?? {}) }, spend: j.spend ?? { day: '', usd: 0 } }
}

export function statusLines(st: CalState, on: boolean, day: string): string[] {
  const cls = [...READ_ONLY].map(k => {
    const c = st.classes[k]
    return `${k} ${c?.agree ?? 0}/${c?.total ?? 0}${c?.promoted ? ' promoted' : ''}`
  })
  const p = [...promoted(st)]
  return [
    `calibration ${on ? 'on' : 'off'} · ${cls.join(' · ')} · promoted: ${p.length ? p.join(', ') : 'none'}`,
    `shadow spend today $${spendToday(st, day).toFixed(2)} of $${DAILY_CAP_USD}`,
  ]
}

// ---- runtime: files, pending pairs, the shadow spawn and the judge ----
// Plain functions over a Cal record (the engine accepts $ passed only to named functions).

type Pair = {
  cls: string; task: string; original: string; shadow: string; originalModel: string | null; shadowModel: string
  originalAnswer?: string; shadowAnswer?: string; costUsd: number; voided?: string
}

export type Cal = {
  st: CalState; evals: string[]; loaded: boolean; statePath: string; evalsPath: string
  pairs: Map<string, Pair> // by original and by shadow agentId
  starting: Map<number, Pair> // shadows spawned whose agentId is not yet known, by tag id
  nextId: number
}

export function calibrator(): Cal {
  return { st: emptyState(), evals: [], loaded: false, statePath: '', evalsPath: '', pairs: new Map(), starting: new Map(), nextId: 1 }
}

async function today($: EngineInterface): Promise<string> {
  return new Date(await $.clock.now()).toISOString().slice(0, 10)
}

async function saveState($: EngineInterface, c: Cal): Promise<void> {
  await $.fs.write(c.statePath, JSON.stringify(c.st, null, 1) + '\n')
}

export async function calLoad($: EngineInterface, c: Cal, home: string): Promise<void> {
  if (c.loaded) return
  c.loaded = true
  c.statePath = `${home}/.claude/conductor/state.json`
  c.evalsPath = `${home}/.claude/conductor/evals.jsonl`
  // A reload starts with empty memory: take what earlier loads wrote, never overwrite it.
  if (await $.fs.exists(c.statePath)) c.st = parseState(String(await $.fs.read(c.statePath)))
  if (await $.fs.exists(c.evalsPath)) c.evals = String(await $.fs.read(c.evalsPath)).split('\n').filter(l => l.trim())
}

export async function calOn($: EngineInterface): Promise<boolean> {
  return (await $.store.get('calibrate')) === true
}

export async function calStatus($: EngineInterface, c: Cal): Promise<string[]> {
  return statusLines(c.st, await calOn($), await today($))
}

/** After an original spawn started: maybe repeat it as a tagged shadow. */
export async function calAfterSpawn(
  $: EngineInterface,
  c: Cal,
  e: { prompt: string; description: string; subagentType: string; fork: boolean; workflow?: unknown; parentModel?: string },
  cls: string,
  routeModel: string,
  r: { agentId?: string; model?: string } | undefined,
): Promise<void> {
  if (!r?.agentId || !(await calOn($)) || !eligible(cls, e)) return
  const model = shadowModel(routeModel, r.model, e.parentModel)
  if (!model) return
  const sample = shouldSample(c.st, cls, await today($))
  await saveState($, c)
  if (!sample) return
  const id = c.nextId++
  const p: Pair = { cls, task: e.prompt, original: r.agentId, shadow: '', originalModel: r.model ?? null, shadowModel: model, costUsd: 0 }
  c.starting.set(id, p)
  c.pairs.set(p.original, p)
  // The call skips the calling hook, so the shadow does not come back through ours; when its result
  // carries no agentId, find the started shadow by its unique tagged description.
  const tagged = tagShadow(e.description, id)
  const sh = await $.agent.spawn({ prompt: e.prompt, description: tagged, subagentType: e.subagentType, model })
  if (sh?.deny) c.starting.delete(id)
  const agentId = sh?.agentId ?? (sh?.deny ? undefined : (await $.agent.list()).find(a => a.description === tagged)?.id)
  calShadowStarted(c, tagged, agentId)
  if (c.starting.delete(id)) c.pairs.delete(p.original) // never started: drop the pair
}

/** A tagged shadow passed through agent.spawn and started: bind its agentId to its pair. */
export function calShadowStarted(c: Cal, description: string, agentId: string | undefined): void {
  const id = shadowId(description)
  const p = id === null ? undefined : c.starting.get(id)
  if (!p || !agentId || id === null) return
  c.starting.delete(id)
  p.shadow = agentId
  c.pairs.set(agentId, p)
}

/** A shadow's step usage counts toward today's spend. */
export async function calUsage($: EngineInterface, c: Cal, agentId: string, model: string | undefined, u: Tok): Promise<void> {
  const p = c.pairs.get(agentId)
  if (!p || p.shadow !== agentId) return
  const usd = costUSD(model ?? p.shadowModel, u)
  p.costUsd += usd
  addSpend(c.st, await today($), usd)
  await saveState($, c)
}

export async function calComplete($: EngineInterface, c: Cal, agentId: string, reason: string, answer: string): Promise<void> {
  const p = c.pairs.get(agentId)
  if (!p) return
  if (reason !== 'answer') p.voided = `${agentId === p.shadow ? 'shadow' : 'original'} ended: ${reason}`
  if (agentId === p.shadow) p.shadowAnswer = answer
  else p.originalAnswer = answer
  if (p.voided || (p.shadowAnswer !== undefined && p.originalAnswer !== undefined)) await judge($, c, p)
}

async function judge($: EngineInterface, c: Cal, p: Pair): Promise<void> {
  c.pairs.delete(p.original)
  c.pairs.delete(p.shadow)
  let verdict: Verdict = 'void'
  let how: EvalRow['judge'] = 'none'
  let note = p.voided
  if (!p.voided) {
    const a = p.originalAnswer ?? ''
    const b = p.shadowAnswer ?? ''
    if (norm(a) === norm(b)) {
      verdict = 'agree'
      how = 'exact'
    } else {
      how = 'opus'
      const r = await $.model.complete({ model: JUDGE_MODEL, prompt: judgePrompt(p.task, a, b), maxTokens: 300 })
      if (r.isAnswered) {
        const usd = costUSD(JUDGE_MODEL, r.usage)
        p.costUsd += usd
        addSpend(c.st, await today($), usd)
        verdict = parseVerdict(r.text)
        note = r.text.split('\n').slice(0, 2).join(' ').slice(0, 200)
      } else note = `judge: ${r.reason}`
    }
  }
  record(c.st, p.cls, verdict)
  const row: EvalRow = {
    ts: new Date(await $.clock.now()).toISOString(), cls: p.cls, original: p.original, shadow: p.shadow,
    originalModel: p.originalModel, shadowModel: p.shadowModel, verdict, judge: how, costUsd: p.costUsd, ...(note ? { note } : {}),
  }
  c.evals.push(JSON.stringify(row))
  await $.fs.write(c.evalsPath, c.evals.join('\n') + '\n')
  await saveState($, c)
}
