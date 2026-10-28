import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { ideaText, limitsOf, listText, rows, toastFor } from './lib'
import { applyPolicy } from './policy'
import { CASES } from './policy_cases.ts'

const NOW = Date.parse('2026-10-21T12:00:00Z')
const VERDICT = '/h/.claude/verdict/latest.json'
const POLICY = '/h/.claude/verdict/policy.json'
const LEDGER = '/h/Trading/_ledger/experiments.jsonl'
const POLICY_OFF = { schema: 'policy/1', rules: { cost_gate: false, variant_counter: false, null_first: false, experiment_ledger: false }, variant_limit: 20, rc_alpha: 0.05 }

type R = { idea: string; variant: string; pf?: number; t_stat?: number; p_value?: number | null; p_kind?: string; verdict?: string; date?: string }
const ledgerOf = (rs: R[]) => rs.map(r => JSON.stringify({ date: '2026-10-20T10:00:00', pf: 1.1, t_stat: 1.0, p_value: 0.3, p_kind: 'naive', verdict: 'FAIL', ...r })).join('\n') + '\n'
// n distinct variants v1..vn of an idea, one run each
const distinct = (idea: string, n: number) => Array.from({ length: n }, (_, i) => ({ idea, variant: `v${i + 1}` }))
const verdictOf = (idea: string, variant: string, written_at = '2026-10-21T11:00:00Z') =>
  JSON.stringify({ schema: 'verdict/2', test: 't', idea, variant, pf: 1.4, t_stat: 2.4, p_value: 0.02, p_kind: 'naive', n_trades: 200, verdict: 'PASS', variants_tried: 1, written_at })

const RUN = (args: string) => ({ command: 'variants', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false } }) as never
const turn = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const }

function engine(on: On, files: Record<string, string>, toasts: string[]) {
  mock.env(on, { HOME: '/h' })
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('fs.read', (_, e) => {
    const v = files[e.path]
    return v === undefined ? { deny: 'ENOENT' } : { value: v }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.register', () => ({ value: undefined }) as never)
}
const start = { cwd: '/', surface: 'desktop', isInteractive: true } as const
const text = (r: { text?: unknown }) => String(r.text ?? '')

// --- the shared policy copy is intact: the copied policy.ts answers every case as verdict.py does ---

type Case = { name: string; verdict_in: Record<string, unknown>; policy: unknown; costs: unknown; variants_tried: number | null; expect: { verdict: string; basis: string; blocked_by: string[] } }
const cases = CASES as unknown as Case[]

test('the shared case file is not empty and covers variant_counter', () => {
  expect(cases.length).toBeGreaterThan(0)
  expect(cases.some(c => c.name.startsWith('variant_counter'))).toBe(true)
})

for (const c of cases) {
  test(`copy intact: ${c.name}`, () => {
    const r = applyPolicy(c.verdict_in, c.policy, c.costs, c.variants_tried)
    expect({ verdict: r.verdict, basis: r.basis, blocked_by: r.blocked_by }).toEqual(c.expect)
  })
}

// --- pure logic ---

test('21 distinct variants: toast text names the idea, the count and the RC/SPA bar', () => {
  const t = toastFor(JSON.parse(verdictOf('orb', 'v21')), ledgerOf(distinct('orb', 20)), limitsOf(POLICY_OFF), NOW)
  expect(t?.text).toBe('idea orb: 21 variants tried; PASS needs an RC/SPA p <= 0.05')
})

test('20 distinct, or 25 runs of 3 variants, or a stale or v1 file: no toast', () => {
  const lim = limitsOf(POLICY_OFF)
  expect(toastFor(JSON.parse(verdictOf('orb', 'v20')), ledgerOf(distinct('orb', 20)), lim, NOW)).toBeNull()
  const many = Array.from({ length: 25 }, (_, i) => ({ idea: 'orb', variant: `v${(i % 3) + 1}` }))
  expect(toastFor(JSON.parse(verdictOf('orb', 'v1')), ledgerOf(many), lim, NOW)).toBeNull()
  expect(toastFor(JSON.parse(verdictOf('orb', 'v99', '2026-10-01T00:00:00Z')), ledgerOf(distinct('orb', 30)), lim, NOW)).toBeNull()
  expect(toastFor({ schema: 'verdict/1', written_at: '2026-10-21T11:00:00Z' }, ledgerOf(distinct('orb', 30)), lim, NOW)).toBeNull()
})

test('the count ignores the file’s own variants_tried', () => {
  const v = { ...JSON.parse(verdictOf('orb', 'v1')), variants_tried: 99 }
  expect(toastFor(v, ledgerOf(distinct('orb', 2)), limitsOf(POLICY_OFF), NOW)).toBeNull()
})

test('the limit and alpha come from policy.json', () => {
  const t = toastFor(JSON.parse(verdictOf('orb', 'v6')), ledgerOf(distinct('orb', 5)), limitsOf({ variant_limit: 5, rc_alpha: 0.01 }), NOW)
  expect(t?.text).toBe('idea orb: 6 variants tried; PASS needs an RC/SPA p <= 0.01')
})

test('list: sorted by distinct variants, over-limit flagged, RC/SPA p <= alpha noted', () => {
  const rs = [...distinct('orb', 21), { idea: 'orb', variant: 'v1', p_kind: 'SPA', p_value: 0.2 }, ...distinct('demo', 3), { idea: 'demo', variant: 'v2', p_kind: 'rc', p_value: 0.04 }]
  const s = listText(rows(ledgerOf(rs)), limitsOf(POLICY_OFF), LEDGER)
  const lines = s.split('\n')
  expect(lines[0]).toContain('2 ideas')
  expect(lines[1]).toContain('orb')
  expect(lines[1]).toContain('21 variants')
  expect(lines[1]).toContain('OVER 20')
  expect(lines[1]).toContain('RC/SPA p<=0.05: no')
  expect(lines[1]).toContain('PASS blocked')
  expect(lines[2]).toContain('demo')
  expect(lines[2]).not.toContain('OVER')
  expect(lines[2]).toContain('RC/SPA p<=0.05: yes')
})

test('idea: one line per variant with date, PF, t, p p_kind and verdict', () => {
  const rs: R[] = [{ idea: 'orb', variant: 'a1', pf: 1.31, t_stat: 2.2, p_value: 0.031, p_kind: 'SPA', verdict: 'PASS', date: '2026-10-20T09:15:00+02:00' }, { idea: 'orb', variant: 'b2' }, { idea: 'orb', variant: 'b2' }, { idea: 'x', variant: 'z' }]
  const s = ideaText(rows(ledgerOf(rs)), 'ORB', limitsOf(POLICY_OFF), LEDGER)
  expect(s).toContain('idea orb: 2 variants tried, 3 runs')
  expect(s).toContain('a1 · 2026-10-20T09:15 · PF 1.31 · t 2.20 · p 0.031 SPA · PASS')
  expect(s).toContain('b2 ·')
  expect(s).toContain('(2 runs)')
  expect(ideaText(rows(ledgerOf(rs)), 'nope', limitsOf(POLICY_OFF), LEDGER)).toContain('no runs for idea "nope"')
})

// --- hooks end to end ---

test('a new verdict whose idea has 21 variants toasts, and /variants flags the idea', async ($, on) => {
  const toasts: string[] = []
  engine(on, { [VERDICT]: verdictOf('orb', 'v21'), [POLICY]: JSON.stringify(POLICY_OFF), [LEDGER]: ledgerOf(distinct('orb', 21)) }, toasts)
  await $.session.start(start)
  expect(toasts).toEqual(['idea orb: 21 variants tried; PASS needs an RC/SPA p <= 0.05'])
  const s = text(await $.command.run(RUN('')))
  expect(s).toContain('orb')
  expect(s).toContain('OVER 20')
})

// Python's json.dump writes bare Infinity / -Infinity / NaN (pf with no losing trade, t with std 0); JSON.parse refuses them.
const pyNonFinite = (line: string) => line.replace('"pf":1.1', '"pf":Infinity').replace('"t_stat":1', '"t_stat":-Infinity').replace('"p_value":0.3', '"p_value":NaN')
const pyLedger = (rs: R[], bare: string[]) =>
  ledgerOf(rs).split('\n').map(ln => (bare.some(v => ln.includes(`"variant":"${v}"`)) ? pyNonFinite(ln) : ln)).join('\n')

test('Python Infinity/NaN in the ledger and in latest.json: the run still counts and the 21st variant toasts', async ($, on) => {
  const toasts: string[] = []
  const ledger = pyLedger(distinct('inf', 20), ['v3', 'v7'])
  expect(ledger).toContain('"pf":Infinity')
  const verdict = verdictOf('inf', 'v21').replace('"pf":1.4', '"pf":Infinity')
  expect(verdict).toContain('"pf":Infinity')
  engine(on, { [VERDICT]: verdict, [POLICY]: JSON.stringify(POLICY_OFF), [LEDGER]: ledger }, toasts)
  await $.session.start(start)
  expect(toasts).toEqual(['idea inf: 21 variants tried; PASS needs an RC/SPA p <= 0.05'])
})

test('Python Infinity/NaN rows: /variants counts them and flags the idea over the limit', async ($, on) => {
  const toasts: string[] = []
  engine(on, { [VERDICT]: verdictOf('inf', 'v1'), [POLICY]: JSON.stringify(POLICY_OFF), [LEDGER]: pyLedger(distinct('inf', 21), ['v3', 'v21']) }, toasts)
  await $.session.start(start)
  const one = text(await $.command.run(RUN('inf')))
  expect(one).toContain('idea inf: 21 variants tried, 21 runs')
  expect(one).toContain('v3 · 2026-10-20T10:00 · PF Infinity · t -Infinity · p — naive')
  const all = text(await $.command.run(RUN('')))
  expect(all).toContain('21 variants')
  expect(all).toContain('OVER 20')
  expect(all).toContain('PASS blocked')
})

test('20 variants: no toast', async ($, on) => {
  const toasts: string[] = []
  engine(on, { [VERDICT]: verdictOf('lim', 'v20'), [POLICY]: JSON.stringify(POLICY_OFF), [LEDGER]: ledgerOf(distinct('lim', 20)) }, toasts)
  await $.session.start(start)
  await $.turn.complete(turn)
  expect(toasts).toEqual([])
})

test('25 runs but 3 distinct variants: no toast', async ($, on) => {
  const toasts: string[] = []
  const many = Array.from({ length: 25 }, (_, i) => ({ idea: 'few', variant: `v${(i % 3) + 1}` }))
  engine(on, { [VERDICT]: verdictOf('few', 'v2'), [LEDGER]: ledgerOf(many) }, toasts)
  await $.session.start(start)
  expect(toasts).toEqual([])
})

test('the same verdict seen twice (session start, then a turn end) toasts once', async ($, on) => {
  const toasts: string[] = []
  engine(on, { [VERDICT]: verdictOf('dup', 'v30'), [LEDGER]: ledgerOf(distinct('dup', 29)) }, toasts)
  await $.session.start(start)
  await $.turn.complete(turn)
  await $.turn.complete(turn)
  expect(toasts).toEqual(['idea dup: 30 variants tried; PASS needs an RC/SPA p <= 0.05'])
})

test('missing ledger: /variants answers in plain words and nothing toasts', async ($, on) => {
  const toasts: string[] = []
  engine(on, { [VERDICT]: verdictOf('gone', 'v1') }, toasts)
  await $.session.start(start)
  expect(toasts).toEqual([])
  const s = text(await $.command.run(RUN('')))
  expect(s).toContain('no experiment ledger yet')
  expect(s).toContain(LEDGER)
  expect(text(await $.command.run(RUN('gone')))).toContain('no experiment ledger yet')
})
