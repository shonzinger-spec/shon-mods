import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { nullLost, nullProblem, nullsText, toastFor } from './lib'
import { applyPolicy } from './policy'
import { CASES } from './policy_cases.ts'

// ---- the shared copy of policy.ts is intact: it answers every shared case as verdict.py does ----
type Case = {
  name: string
  verdict_in: Record<string, unknown>
  policy: unknown
  costs: unknown
  variants_tried: number | null
  expect: { verdict: string; basis: string; blocked_by: string[] }
}
const cases = CASES as unknown as Case[]

test('the shared case file has null_first cases', () => {
  expect(cases.filter(c => c.name.includes('null')).length).toBeGreaterThan(5)
})

for (const c of cases) {
  test(`port: ${c.name}`, () => {
    const r = applyPolicy(c.verdict_in, c.policy, c.costs, c.variants_tried)
    expect({ verdict: r.verdict, basis: r.basis, blocked_by: r.blocked_by }).toEqual(c.expect)
  })
}

// nullLost agrees with applyPolicy's null_first verdict on every case that has the rule on.
test('nullLost agrees with the shared null_first cases', () => {
  for (const c of cases.filter(c => c.name.startsWith('null_first:'))) {
    expect([c.name, nullLost(c.verdict_in)]).toEqual([c.name, !c.expect.blocked_by.includes('null_first')])
  }
})

// ---- pure wording ----
const NOW = Date.parse('2026-10-21T12:00:00Z')
const V = {
  schema: 'verdict/2', test: 'v64 demo NQ', idea: 'demo', variant: 'abc', pf: 1.3, t_stat: 2.5, p_value: 0.01,
  p_kind: 'SPA', n_trades: 300, null_kind: 'flip', null_pf: 0.8, null_pct: null, verdict: 'PASS',
  written_at: '2026-10-21T11:00:00Z',
}

test('the problem is worded: no null vs a null that did not lose', () => {
  expect(nullProblem({ ...V, null_kind: null })).toBe('no null ran')
  expect(nullProblem({ ...V, null_pf: 1.08, pf: 1.1 })).toBe('null did not lose: flip PF 1.08 vs real 1.10 (flip must be < 1.0)')
  expect(nullProblem({ ...V, null_pf: 0.95, pf: 0.9 })).toBe('null did not lose: flip PF 0.95 vs real 0.90')
  expect(nullProblem({ ...V, null_kind: 'random_entry', null_pct: 80 })).toBe('null did not lose: random_entry pct 80.0 (needs >= 95)')
  expect(nullProblem(V)).toBeNull()
  expect(nullProblem({ ...V, null_kind: 'random_entry', null_pct: 97 })).toBeNull()
})

test('a FAIL, a week-old verdict or a foreign schema raises nothing', () => {
  expect(toastFor({ ...V, null_kind: null, verdict: 'FAIL' }, NOW)).toBeNull()
  expect(toastFor({ ...V, null_kind: null, written_at: '2026-10-01T00:00:00Z' }, NOW)).toBeNull()
  expect(toastFor({ ...V, null_kind: null, schema: 'other' }, NOW)).toBeNull()
  expect(toastFor({ ...V, null_kind: null }, NOW)).toBe('null-first: v64 demo NQ PASS: no null ran')
})

// ---- end to end through the hooks ----
type Seen = { toasts: string[] }
function engine(on: On, seen: Seen, files: Record<string, string>) {
  mock.env(on, { HOME: '/h' })
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('fs.read', (_, e) => {
    const p = String((e as { path?: string }).path ?? e)
    return (p in files ? { value: files[p] } : { deny: 'ENOENT' }) as never
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'nulls' } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
}
const LATEST = '/h/.claude/verdict/latest.json'
const POLICY = '/h/.claude/verdict/policy.json'
const LEDGER = '/h/Trading/_ledger/experiments.jsonl'
const START = { cwd: '/', surface: 'desktop', isInteractive: true } as const
const turn = { answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const }
const RUN = (args = '') => ({ command: 'nulls', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false } }) as never
const text = (r: unknown) => String((r as { text?: string }).text)

test('a verdict with no null toasts "no null ran"', async ($, on) => {
  const seen: Seen = { toasts: [] }
  engine(on, seen, { [LATEST]: JSON.stringify({ ...V, null_kind: null, null_pf: null }) })
  await $.session.start(START)
  expect(seen.toasts).toEqual(['null-first: v64 demo NQ PASS: no null ran'])
})

test('a flip null at PF 1.05 toasts that the null did not lose, even with the rule off', async ($, on) => {
  const seen: Seen = { toasts: [] }
  engine(on, seen, {
    [LATEST]: JSON.stringify({ ...V, null_pf: 1.05 }),
    [POLICY]: JSON.stringify({ schema: 'policy/1', rules: { null_first: false } }),
  })
  await $.session.start(START)
  expect(seen.toasts.length).toBe(1)
  expect(seen.toasts[0]).toContain('null did not lose: flip PF 1.05 vs real 1.30')
})

test('a flip null at 0.8 under a real 1.3 raises nothing', async ($, on) => {
  const seen: Seen = { toasts: [] }
  engine(on, seen, { [LATEST]: JSON.stringify(V) })
  await $.session.start(START)
  await $.turn.complete(turn)
  expect(seen.toasts).toEqual([])
})

test('a random_entry null at pct 97 raises nothing', async ($, on) => {
  const seen: Seen = { toasts: [] }
  engine(on, seen, { [LATEST]: JSON.stringify({ ...V, null_kind: 'random_entry', null_pf: 1.2, null_pct: 97 }) })
  await $.session.start(START)
  expect(seen.toasts).toEqual([])
})

test('the same verdict seen twice toasts once; a new verdict date toasts again', async ($, on) => {
  const seen: Seen = { toasts: [] }
  const files = { [LATEST]: JSON.stringify({ ...V, null_kind: null }) }
  engine(on, seen, files)
  await $.session.start(START)
  await $.turn.complete(turn)
  await $.turn.complete(turn)
  expect(seen.toasts.length).toBe(1)
  files[LATEST] = JSON.stringify({ ...V, null_kind: null, written_at: '2026-10-21T11:30:00Z' })
  await $.turn.complete(turn)
  expect(seen.toasts.length).toBe(2)
})

test('no latest.json and no ledger: no toast, /nulls answers in words', async ($, on) => {
  const seen: Seen = { toasts: [] }
  engine(on, seen, {})
  await $.session.start(START)
  expect(seen.toasts).toEqual([])
  const t = text(await $.command.run(RUN()))
  expect(t).toContain('null_first rule: off (warn only)')
  expect(t).toContain(`latest: no readable verdict at ${LATEST}`)
  expect(t).toContain(`No experiment ledger yet at ${LEDGER}`)
})

const row = (o: Record<string, unknown>) =>
  JSON.stringify({ date: '2026-10-20T10:00:00', slug: 's', idea: 'demo', variant: 'v', pf: 1.3, null_kind: 'flip', null_pf: 0.8, verdict: 'PASS', ...o })

test('/nulls lists the last 15 rows with the rule result, plus the latest verdict', async ($, on) => {
  const seen: Seen = { toasts: [] }
  const rows = Array.from({ length: 20 }, (_, i) => row({ idea: `idea${i}` }))
  rows.push(row({ idea: 'gold', null_kind: null, null_pf: null }))
  rows.push(row({ idea: 'flipper', null_pf: 1.08, pf: 1.1 }))
  engine(on, seen, {
    [LATEST]: JSON.stringify(V),
    [POLICY]: JSON.stringify({ rules: { null_first: true } }),
    [LEDGER]: rows.join('\n') + '\nnot json\n',
  })
  const t = text(await $.command.run(RUN()))
  const lines = t.split('\n')
  expect(lines[0]).toBe('null_first rule: on (blocks a PASS without a losing null)')
  expect(lines[1]).toBe('latest: v64 demo NQ  PASS  PF 1.30  flip 0.80  null-first ok')
  expect(lines[2]).toBe('Last 15 ledger row(s):')
  expect(lines.length).toBe(3 + 15)
  expect(t).not.toContain('idea6 ')
  expect(t).toContain('2026-10-20T10:00  idea19  PF 1.30  flip 0.80  PASS  null-first ok')
  expect(t).toContain('gold  PF 1.30  no null  PASS  null-first FAIL (no null ran)')
  expect(t).toContain('flipper  PF 1.10  flip 1.08  PASS  null-first FAIL (null did not lose: flip PF 1.08 vs real 1.10 (flip must be < 1.0))')
})

test('/nulls <idea> lists only that idea; an unknown idea says so', async ($, on) => {
  const seen: Seen = { toasts: [] }
  engine(on, seen, {
    [LEDGER]: [row({ idea: 'demo' }), row({ idea: 'other' }), row({ idea: 'Demo', null_kind: 'random_entry', null_pf: 1.1, null_pct: 96 })].join('\n'),
  })
  const t = text(await $.command.run(RUN('demo')))
  expect(t).toContain('2 ledger row(s) for idea "demo":')
  expect(t).not.toContain('other')
  expect(t).toContain('random_entry 1.10 pct 96.0  PASS  null-first ok')
  expect(text(await $.command.run(RUN('zzz')))).toContain('No ledger rows for idea "zzz".')
})

// verdict.py's ledger rows have no null_pct key (LEDGER_KEYS lacked it), so a random_entry row must not be judged
// by the 'null_pf < pf' fallback that is meant only for a verdict without a pct.
test('/nulls: a random_entry ledger row without null_pct is not judged by the PF fallback', () => {
  const asWritten = (o: Record<string, unknown>) =>
    JSON.stringify({ date: '2026-10-20T10:00:00', slug: 's', idea: 'demo', variant: 'v', pf: 1.3, null_kind: 'random_entry', blocked_by: [], ...o })
  const ledger = [
    // write_verdict(null_pct=80, null_pf=0.9): refused by null_first; the PF fallback alone would say ok
    asWritten({ idea: 'a', null_pf: 0.9, verdict: 'INCONCLUSIVE', blocked_by: ['null_first'] }),
    // write_verdict(null_pct=97, no null_pf): the null lost; the PF fallback alone would say FAIL
    asWritten({ idea: 'b', null_pf: null, verdict: 'PASS' }),
    // a row written once null_pct is a ledger key: null means the verdict had no pct, so the fallback applies
    asWritten({ idea: 'c', null_pf: 0.9, null_pct: null, verdict: 'PASS' }),
  ].join('\n')
  const t = nullsText({ ledger, ledgerPath: 'L', latest: null, latestPath: 'P', ruleOn: true }, '')
  expect(t).toContain('a  PF 1.30  random_entry 0.90  INCONCLUSIVE  null-first FAIL (refused when written; random_entry pct not in the ledger)')
  expect(t).toContain('b  PF 1.30  random_entry —  PASS  null-first unknown (random_entry pct not in the ledger)')
  expect(t).toContain('c  PF 1.30  random_entry 0.90  PASS  null-first ok')
  expect(t).not.toContain('a  PF 1.30  random_entry 0.90  INCONCLUSIVE  null-first ok')
})

test('nullsText survives a broken latest.json', () => {
  const t = nullsText({ ledger: '', ledgerPath: 'L', latest: '{half', latestPath: 'P', ruleOn: false }, '')
  expect(t).toContain('latest: no readable verdict at P')
  expect(t).toContain('The ledger has no rows yet.')
})
