import { expect, test } from 'claude-code/testing'

import { applyPolicy, countVariants, parseCosts, parsePolicy } from './policy'
import { CASES } from './policy_cases.ts'

// G-port: the TS port answers every shared case exactly as verdict.py's apply_policy does.
type Case = {
  name: string
  verdict_in: Record<string, unknown>
  policy: unknown
  costs: unknown
  variants_tried: number | null
  expect: { verdict: string; basis: string; blocked_by: string[] }
}
const cases = CASES as unknown as Case[]

test('the shared case file is not empty', () => {
  expect(cases.length).toBeGreaterThan(0)
})

for (const c of cases) {
  test(`port: ${c.name}`, () => {
    const r = applyPolicy(c.verdict_in, c.policy, c.costs, c.variants_tried)
    expect({ verdict: r.verdict, basis: r.basis, blocked_by: r.blocked_by }).toEqual(c.expect)
  })
}

test('policy and costs files parse as verdict.py loads them', () => {
  expect(parsePolicy(null)).toEqual({})
  expect(parsePolicy('{broken')).toEqual({})
  expect(parsePolicy('[1]')).toEqual({})
  const costs = parseCosts(JSON.stringify({ costs: { _comment: 'x', nq: { rt_pts: 0.9 } } }))
  expect(costs).toEqual({ NQ: { rt_pts: 0.9 } })
  expect(parseCosts(null)).toEqual({})
})

test('variants are counted from the ledger for this idea, own variant included', () => {
  const ledger = [
    { idea: 'a', variant: 'v1' }, { idea: 'a', variant: 'v2' }, { idea: 'a', variant: 'v2' },
    { idea: 'b', variant: 'v9' }, { idea: 'a', variant: null },
  ].map(x => JSON.stringify(x)).join('\n') + '\nnot json\n'
  expect(countVariants(ledger, 'a', 'v3')).toBe(3)
  expect(countVariants(ledger, 'a', 'v1')).toBe(2)
  expect(countVariants(null, 'a', 'v1')).toBe(1)
  expect(countVariants(ledger, null, 'v1')).toBeNull()
  expect(countVariants(ledger, 'a', undefined)).toBeNull()
})

test('ledger lines carrying Python bare NaN / Infinity / -Infinity count as json.loads reads them', () => {
  const ledger = [
    '{"idea": "x", "variant": "b", "pf": Infinity}',
    '{"idea": "x", "variant": "c", "t_stat": -Infinity, "null_pf": NaN, "note": "NaN Infinity \\" stays text"}',
    '{"idea": "x", "variant": "d", "pf": 1.2}',
  ].join('\n')
  expect(countVariants(ledger, 'x', 'a')).toBe(4)
})
