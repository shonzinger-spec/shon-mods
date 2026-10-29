// Routing table: load + hand validation against the same rules as routes.schema.json.
// No external libs; the hook will read the file with $.fs.read and pass the text here.

export const MODELS = ['opus', 'sonnet', 'haiku', 'fable', 'inherit'] as const
export const EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const // never 'max': the cap is xhigh
export const MODES = ['enforce', 'suggest', 'checked'] as const
export const CLASSES = [
  'verdict', 'skeptic2', 'spec_code', 'review', 'checked_fix', 'run_report',
  'extract', 'drafts', 'final_pack', 'locate', 'mech_edit', 'unclassified',
] as const

export type Model = (typeof MODELS)[number]
export type Effort = (typeof EFFORTS)[number]
export type Mode = (typeof MODES)[number]

export type Route = {
  model: Model
  effort?: Effort
  mode: Mode
  keywords: string[]
  /** Keyword evidence for this class beats an agent_map hit. */
  overrides_agent?: boolean
  /** Class used when this class has some keyword hits but fewer than it needs. */
  demote_to?: string
  /** xhigh classes only: one of these alone is enough evidence (weak `keywords` need two). */
  strong_keywords?: string[]
}

export type Routes = {
  version: 1
  /** Key order is the tie-break order between classes with equal keyword hits. */
  classes: Record<string, Route>
  /** Plugin-qualified agent type whose job is the class itself ("frugal:scout") -> class; decisive. */
  agent_map: Record<string, string>
  /** General maker agents ("delegate:builder") -> class used only when no keyword class hit; never xhigh. */
  agent_fallback?: Record<string, string>
}

export type LoadResult = { ok: true; routes: Routes } | { ok: false; error: string }

export const AGENT_KEY = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/
const KEYWORD = /^[a-z0-9]+\*?( [a-z0-9]+\*?)*$/
const ROUTE_KEYS = new Set(['model', 'effort', 'mode', 'keywords', 'overrides_agent', 'demote_to', 'strong_keywords'])

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const has = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T)

export function validate(raw: unknown): LoadResult {
  const fail = (error: string): LoadResult => ({ ok: false, error })
  if (!isObj(raw)) return fail('routes: not an object')
  for (const k of Object.keys(raw)) if (!['version', 'classes', 'agent_map', 'agent_fallback'].includes(k)) return fail(`routes: unknown key "${k}"`)
  if (raw.version !== 1) return fail('routes.version: must be 1')
  const classes = raw.classes
  if (!isObj(classes)) return fail('routes.classes: not an object')
  for (const c of CLASSES) if (!(c in classes)) return fail(`routes.classes: missing class "${c}"`)
  for (const [name, r] of Object.entries(classes)) {
    const at = `routes.classes.${name}`
    if (!has(CLASSES, name)) return fail(`${at}: unknown class`)
    if (!isObj(r)) return fail(`${at}: not an object`)
    for (const k of Object.keys(r)) if (!ROUTE_KEYS.has(k)) return fail(`${at}: unknown key "${k}"`)
    if (!has(MODELS, r.model)) return fail(`${at}.model: "${String(r.model)}" is not one of ${MODELS.join('|')}`)
    if ('effort' in r && !has(EFFORTS, r.effort)) return fail(`${at}.effort: "${String(r.effort)}" is not one of ${EFFORTS.join('|')}`)
    if (r.model === 'haiku' && 'effort' in r) return fail(`${at}: a haiku route carries no effort`)
    if (!has(MODES, r.mode)) return fail(`${at}.mode: "${String(r.mode)}" is not one of ${MODES.join('|')}`)
    if (!Array.isArray(r.keywords) || !r.keywords.every(k => typeof k === 'string' && KEYWORD.test(k)))
      return fail(`${at}.keywords: must be lowercase words/phrases, each word may end in *`)
    if ('strong_keywords' in r) {
      const sk = r.strong_keywords
      if (r.effort !== 'xhigh') return fail(`${at}.strong_keywords: only an xhigh class has strong keywords`)
      if (!Array.isArray(sk) || sk.length === 0 || !sk.every(k => typeof k === 'string' && KEYWORD.test(k)))
        return fail(`${at}.strong_keywords: must be a non-empty list of lowercase words/phrases, each word may end in *`)
      const weak = new Set(r.keywords as string[])
      const dup = sk.find(k => weak.has(k))
      if (dup) return fail(`${at}.strong_keywords: "${dup}" is also a weak keyword`)
    }
    if ('overrides_agent' in r && typeof r.overrides_agent !== 'boolean') return fail(`${at}.overrides_agent: not a boolean`)
    if ('demote_to' in r) {
      const d = r.demote_to
      if (!has(CLASSES, d) || d === name) return fail(`${at}.demote_to: not another class`)
      const target = classes[d]
      if (isObj(target) && target.effort === 'xhigh') return fail(`${at}.demote_to: cannot demote to an xhigh class`)
    }
  }
  if (classes.unclassified && isObj(classes.unclassified) && classes.unclassified.model !== 'inherit')
    return fail('routes.classes.unclassified.model: must be inherit')
  const map = raw.agent_map
  if (!isObj(map)) return fail('routes.agent_map: not an object')
  for (const [k, v] of Object.entries(map)) {
    if (!AGENT_KEY.test(k)) return fail(`routes.agent_map: key "${k}" must be plugin-qualified (plugin:agent)`)
    if (!has(CLASSES, v) || v === 'unclassified') return fail(`routes.agent_map.${k}: "${String(v)}" is not a routable class`)
  }
  if ('agent_fallback' in raw) {
    const fb = raw.agent_fallback
    if (!isObj(fb)) return fail('routes.agent_fallback: not an object')
    for (const [k, v] of Object.entries(fb)) {
      if (!AGENT_KEY.test(k)) return fail(`routes.agent_fallback: key "${k}" must be plugin-qualified (plugin:agent)`)
      if (!has(CLASSES, v) || v === 'unclassified') return fail(`routes.agent_fallback.${k}: "${String(v)}" is not a routable class`)
      const t = classes[v]
      if (isObj(t) && t.effort === 'xhigh') return fail(`routes.agent_fallback.${k}: a fallback cannot route to an xhigh class`)
    }
  }
  return { ok: true, routes: raw as unknown as Routes }
}

export function loadRoutes(text: string): LoadResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `routes: invalid JSON (${e instanceof Error ? e.message : String(e)})` }
  }
  return validate(raw)
}
