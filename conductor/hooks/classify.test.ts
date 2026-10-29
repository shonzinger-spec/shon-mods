import { expect, test } from 'claude-code/testing'

import { classify, loadRoutes, type Decision, type SpawnInput } from './classify.ts'
import { LABELS_DEV, ROUTES_TEXT } from './fixtures.ts'

const loaded = loadRoutes(ROUTES_TEXT)
const ROUTES = loaded.ok ? loaded.routes : null
const EFFORT_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, xhigh: 4 }
const input = (description: string, subagentType = 'general-purpose'): SpawnInput => ({ description, subagentType, fork: false })
const run = () => LABELS_DEV.map(x => ({ x, d: classify(input(x.description, x.subagent_type), ROUTES) }))
const mutate = (f: (r: any) => void) => {
  const r = JSON.parse(ROUTES_TEXT)
  f(r)
  return JSON.stringify(r)
}

test('routes.default.json loads', async () => {
  expect(loaded.ok).toBe(true)
})

test('dev-set accuracy >= 90%', async () => {
  const res = run()
  const misses = res.filter(r => r.d.cls !== r.x.label)
  for (const m of misses) console.log(`MISS #${m.x.id} "${m.x.description}" [${m.x.subagent_type}] want ${m.x.label} got ${m.d.cls} (${m.d.reason})`)
  const acc = (res.length - misses.length) / res.length
  console.log(`dev accuracy ${res.length - misses.length}/${res.length} = ${(acc * 100).toFixed(1)}%`)
  expect(acc >= 0.9).toBe(true)
})

test('no verdict-labelled item lands below opus/high', async () => {
  for (const { x, d } of run().filter(r => r.x.label === 'verdict')) {
    expect(`${x.id}:${d.model}`).toBe(`${x.id}:opus`)
    expect(EFFORT_RANK[d.effort ?? ''] ?? 0).toBeGreaterThanOrEqual(3)
  }
})

test('at most 2 non-verdict dev items land on xhigh', async () => {
  const over = run().filter(r => r.x.label !== 'verdict' && r.d.effort === 'xhigh')
  for (const o of over) console.log(`XHIGH non-verdict #${o.x.id} "${o.x.description}" hits=${o.d.hits.join(',')}`)
  expect(over.length).toBeLessThanOrEqual(2)
})

test('one weak verdict word alone does not reach xhigh', async () => {
  // code-from-spec that merely names a verdict, routed by agent type or by keywords alone
  expect(classify(input('Verdict schema v2 Python side', 'delegate:builder'), ROUTES).cls).toBe('spec_code')
  expect(classify(input('Audit data pipeline freshness'), ROUTES).cls).toBe('run_report')
  for (const desc of ['Verdict schema v2 Python side', 'Audit data pipeline freshness', 'Add null check to loader', 'Leak-lint mod polish', 'Gate check']) {
    const d = classify(input(desc), ROUTES)
    expect(`${desc}:${d.effort}`).not.toBe(`${desc}:xhigh`)
  }
  // two separate weak hits do
  expect(classify(input('Data integrity audit'), ROUTES).cls).toBe('verdict')
  expect(classify(input('Leak audit of the loader'), ROUTES).effort).toBe('xhigh')
})

test('a single strong word reaches verdict', async () => {
  for (const desc of ['Skeptic: prop option sim', 'Refute the tier result', 'Intra-night drift gauntlet', 'Adversarial pass on the runner', 'Overfit check', 'Prereg gate for study B']) {
    const d = classify(input(desc), ROUTES)
    expect(`${desc}:${d.cls}:${d.effort}`).toBe(`${desc}:verdict:xhigh`)
  }
  expect(classify(input('Skeptic: prop option sim', 'delegate:reviewer'), ROUTES).cls).toBe('verdict')
})

test('general maker fallback loses to task keywords; decisive agent_map does not', async () => {
  expect(classify(input('Fix fadj seam in equivalence, re-run A1', 'delegate:builder'), ROUTES).cls).toBe('checked_fix')
  expect(classify(input('Rerun the study on new data', 'delegate:builder'), ROUTES).cls).toBe('run_report')
  expect(classify(input('Build mod 19 cost-band', 'delegate:builder'), ROUTES).cls).toBe('spec_code')
  expect(classify(input('Fix the folder list', 'frugal:scout'), ROUTES).cls).toBe('locate')
  expect(classify(input('Write the parser and run gates'), ROUTES).cls).toBe('spec_code')
  expect(classify(input('Scan Drive for gaps'), ROUTES).cls).toBe('locate')
  // no usable task signal -> unclassified/inherit, even from a general agent
  const d = classify(input('Semiconductor and telecom firms', 'delegate:mechanic'), ROUTES)
  expect(`${d.cls}:${d.model}`).toBe('unclassified:inherit')
})

test('strong verdict keywords beat a weaker agent_map class; second skeptic beats verdict', async () => {
  expect(classify(input('Adversarial audit of the v13 result', 'delegate:reviewer'), ROUTES).cls).toBe('verdict')
  expect(classify(input('Second skeptic on the refuted result'), ROUTES).cls).toBe('skeptic2')
  expect(classify(input('Second skeptic pass'), ROUTES).model).toBe('fable')
})

test('bare agent name never hits agent_map', async () => {
  for (const t of ['builder', 'scout', 'reviewer', 'extractor']) {
    const d: Decision = classify(input('do the thing', t), ROUTES)
    expect(d.hits.some(h => h.startsWith('agent:'))).toBe(false)
    expect(d.cls).toBe('unclassified')
    expect(d.model).toBe('inherit')
  }
  expect(classify(input('do the thing', 'frugal:scout'), ROUTES).cls).toBe('locate')
  expect(loadRoutes(mutate(r => (r.agent_map.builder = 'spec_code'))).ok).toBe(false)
})

test('haiku route has no effort; nothing routes to max', async () => {
  const l = loadRoutes(ROUTES_TEXT)
  if (!l.ok) throw new Error(l.error)
  for (const [name, r] of Object.entries(l.routes.classes)) {
    if (r.model === 'haiku') expect(`${name}:${r.effort}`).toBe(`${name}:undefined`)
    expect(r.effort).not.toBe('max')
  }
  const d = classify(input('Inventory the strategy folders'), ROUTES)
  expect(d.cls).toBe('locate')
  expect(d.model).toBe('haiku')
  expect(d.effort).toBeUndefined()
  expect(loadRoutes(mutate(r => (r.classes.locate.effort = 'low'))).ok).toBe(false)
})

test('invalid routes -> ok:false and classify returns error/inherit', async () => {
  const bad = [
    mutate(r => (r.classes.extract.model = 'gpt-5')),
    mutate(r => (r.classes.verdict.effort = 'max')),
    mutate(r => delete r.classes.review),
    mutate(r => (r.classes.review.strong_keywords = ['skeptic*'])),
    mutate(r => (r.classes.verdict.strong_keywords = [])),
    mutate(r => (r.classes.verdict.strong_keywords = ['audit*'])),
    mutate(r => (r.agent_fallback['delegate:builder'] = 'verdict')),
    mutate(r => (r.agent_fallback.builder = 'spec_code')),
    '{ not json',
  ]
  for (const text of bad) {
    const l = loadRoutes(text)
    expect(l.ok).toBe(false)
    if (!l.ok) expect(l.error.length).toBeGreaterThan(0)
    const d = classify(input('Refute the tier result'), l)
    expect(d.cls).toBe('error')
    expect(d.model).toBe('inherit')
    expect(d.effort).toBeUndefined()
  }
  // a raw invalid object passed straight in is validated too
  expect(classify(input('Refute the tier result'), JSON.parse(bad[1]!)).cls).toBe('error')
  expect(classify(input('Refute the tier result'), null).cls).toBe('error')
})

const cls = (desc: string, agent?: string) => classify(input(desc, agent), ROUTES)

test('a leading judgement verb keeps the main model, even from a scout or extractor', async () => {
  for (const [desc, agent] of [
    ['Vet plugin candidates', 'frugal:scout'],
    ['Vet the install list', 'general-purpose'],
    ['Find why the nightly job missed its run', 'frugal:scout'],
    ['Quality-test the outreach prompt', 'frugal:extractor'],
    ['Assess vendor options', 'general-purpose'],
  ] as const) {
    const d = cls(desc, agent)
    expect(`${desc}:${d.cls}:${d.model}`).toBe(`${desc}:unclassified:inherit`)
  }
  // only the leading word counts: a project name containing "research" stays a noun
  expect(cls('Inventory the trading-research repos', 'frugal:scout').cls).toBe('locate')
  expect(cls('Map the cron jobs').cls).toBe('locate')
  // judgement never pulls a strong verdict word down
  expect(cls('Find the overfit in the sweep').cls).toBe('verdict')
})

test('applying fixes beats the word review', async () => {
  expect(cls('Apply review fixes to the parser').cls).toBe('checked_fix')
  expect(cls('Address review comments on the loader').cls).toBe('checked_fix')
  expect(cls('Fresh review of the parser').cls).toBe('review')
})

test('a build reads as spec_code, not as a run', async () => {
  expect(cls('Build the pairs backtest per frozen prereg', 'delegate:builder').cls).toBe('spec_code')
  expect(cls('Sim engine remainder + run script', 'delegate:builder').cls).toBe('spec_code')
  expect(cls('Build status dashboard').cls).toBe('spec_code')
  expect(cls('Rerun the pairs backtest').cls).toBe('run_report')
})

test('doc updates are mechanical; resume building is final_pack', async () => {
  expect(cls('Update the README for project 2', 'delegate:builder-lite').cls).toBe('mech_edit')
  expect(cls('Build resume for the analyst role').cls).toBe('final_pack')
  expect(cls('Final résumé tailoring for the controls job').cls).toBe('final_pack')
})
