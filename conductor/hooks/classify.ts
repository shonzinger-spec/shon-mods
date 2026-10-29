// Pure routing classifier for agent.spawn. Reads the description only (never the prompt), no paths.
//
// Precedence (first that applies wins):
//   1. overriding classes (overrides_agent) with enough keyword evidence, in routes order: skeptic2 on any
//      hit; an xhigh class (verdict) only on one STRONG keyword (strong_keywords) or two separate weak ones.
//      A reviewer or builder agent is often handed skeptic/verdict work, so its agent_map must not pull it below.
//   1b. a leading judgement verb (the unclassified class's keywords: vet, find, assess, investigate, research...)
//      keeps the main model (inherit), beating agent_map and every keyword class below: a scout asked to vet
//      repos or find why a job burned quota is doing judgement, not locate. Only the description's first word(s)
//      count, so a name like "mnq-mgc-research" stays a noun. Inherit is the safe direction to err.
//   2. agent_map, plugin-qualified keys only (a bare "builder" never matches): agents whose job is the class.
//   3. keyword hits of the non-xhigh classes; most separate hits wins, ties go to the earlier class in routes.
//      Order is precedence: spec_code ("build", "engine", "per prereg") sits before run_report ("run script",
//      "backtest"), and checked_fix sits before review so applying fixes beats the word "review".
//   4. agent_fallback: general maker agents (delegate:builder) lose to any task keyword above.
//   5. an xhigh class with some but too little evidence demotes (demote_to).
//   6. unclassified -> inherit.
// Hard guarantee: an xhigh class is only ever returned from step 1 (strong, or two weak) or step 2 (agent_map);
// step 3 skips xhigh classes and validation forbids demote_to / agent_fallback targets that are xhigh.
import { AGENT_KEY, validate, type Effort, type LoadResult, type Mode, type Routes } from './routes.ts'

export { loadRoutes, validate } from './routes.ts'

export type SpawnInput = {
  description: string
  subagentType: string
  model?: string
  fork: boolean
  workflow?: { runId: string }
}

export type Decision = {
  cls: string
  model: string | 'inherit'
  effort?: Effort
  mode: Mode
  reason: string
  hits: string[]
}

/** Separate weak keyword hits an xhigh class needs without a strong hit or an agent_map hit. */
export const XHIGH_MIN_WEAK = 2

/** The one rule for reaching an xhigh class from the description: one strong word, or two separate weak ones. */
export function xhighEvidence(strong: string[], weak: string[]): boolean {
  return strong.length >= 1 || weak.length >= XHIGH_MIN_WEAK
}

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const reCache = new Map<string, RegExp>()
function keywordRe(kw: string): RegExp {
  let re = reCache.get(kw)
  if (!re) {
    // each word may end in * (any word tail); words are separated by one or more spaces
    const body = kw.split(' ').map(w => (w.endsWith('*') ? `${w.slice(0, -1)}[a-z0-9]*` : w)).join(' +')
    re = new RegExp(`\\b${body}\\b`, 'g')
    reCache.set(kw, re)
  }
  re.lastIndex = 0
  return re
}

/** Keywords of one class found in text, counting overlapping matches ("re verify"/"verif*") once. */
export function keywordHits(text: string, keywords: string[]): string[] {
  const spans: { s: number; e: number; kw: string }[] = []
  for (const kw of keywords) {
    const re = keywordRe(kw)
    for (let m = re.exec(text); m; m = re.exec(text)) spans.push({ s: m.index, e: m.index + m[0].length, kw })
  }
  spans.sort((a, b) => a.s - b.s || b.e - a.e)
  const out: string[] = []
  let end = -1
  for (const sp of spans) {
    if (sp.s < end) continue
    out.push(sp.kw)
    end = sp.e
  }
  return out
}

/** The keyword that matches at the very start of text, if any. */
export function leadingHit(text: string, keywords: string[]): string | null {
  for (const kw of keywords) {
    const re = keywordRe(kw)
    if (re.exec(text)?.index === 0) return kw
  }
  return null
}

function resolve(raw: unknown): LoadResult {
  if (raw && typeof raw === 'object' && 'ok' in raw) return raw as LoadResult
  return validate(raw)
}

export function classify(input: SpawnInput, routesIn: Routes | LoadResult | unknown): Decision {
  const loaded = resolve(routesIn)
  if (!loaded.ok) return { cls: 'error', model: 'inherit', mode: 'suggest', reason: `routes invalid: ${loaded.error}`, hits: [] }
  const { classes, agent_map } = loaded.routes
  const decide = (cls: string, reason: string, hits: string[]): Decision => {
    const r = classes[cls]!
    const d: Decision = { cls, model: r.model, mode: r.mode, reason, hits }
    if (r.effort) d.effort = r.effort
    return d
  }
  const isXhigh = (cls: string) => classes[cls]!.effort === 'xhigh'

  const text = normalize(input.description ?? '')
  const scored = Object.keys(classes)
    .filter(c => c !== 'unclassified')
    .map(c => ({ cls: c, hits: keywordHits(text, classes[c]!.keywords), strong: keywordHits(text, classes[c]!.strong_keywords ?? []) }))
  const enough = (s: (typeof scored)[number]) => (isXhigh(s.cls) ? xhighEvidence(s.strong, s.hits) : s.hits.length + s.strong.length >= 1)

  // 1. overriding classes (skeptic2, verdict) with enough evidence, in routes order
  for (const s of scored)
    if (classes[s.cls]!.overrides_agent && enough(s))
      return decide(s.cls, `keywords (${s.strong.length} strong, ${s.hits.length} weak; override agent_map)`, [...s.strong, ...s.hits])

  // 1b. judgement words keep the main model
  const judgement = leadingHit(text, classes.unclassified!.keywords)
  if (judgement) return decide('unclassified', `leading judgement verb "${judgement}": inherit`, [judgement])

  // 2. agent_map, plugin-qualified exact key only
  const agent = input.subagentType ?? ''
  const own = (m: Record<string, string> | undefined) =>
    AGENT_KEY.test(agent) && m && Object.prototype.hasOwnProperty.call(m, agent) ? m[agent]! : null
  const mapped = own(agent_map)
  if (mapped) return decide(mapped, `agent_map ${agent}`, [`agent:${agent}`])

  // 3. keywords of non-xhigh classes: most separate hits, ties by routes order
  let best: { cls: string; hits: string[] } | null = null
  for (const s of scored) {
    if (isXhigh(s.cls) || s.hits.length === 0) continue
    if (!best || s.hits.length > best.hits.length) best = s
  }
  if (best) return decide(best.cls, `keywords (${best.hits.length} hits)`, best.hits)

  // 4. general maker agent default
  const fallback = own(loaded.routes.agent_fallback)
  if (fallback) return decide(fallback, `agent_fallback ${agent}`, [`agent:${agent}`])

  // 5. xhigh class short of evidence demotes
  for (const s of scored) {
    const to = classes[s.cls]!.demote_to
    if (isXhigh(s.cls) && to && s.hits.length + s.strong.length > 0)
      return decide(to, `${s.cls} needs 1 strong or ${XHIGH_MIN_WEAK} weak hits, got ${s.hits.length} weak: demoted`, s.hits)
  }

  // 6. nothing
  return decide('unclassified', 'no agent_map or keyword hit', [])
}
