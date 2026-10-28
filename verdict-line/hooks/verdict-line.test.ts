import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { line, type Verdict } from './lib'

const NOW = Date.parse('2026-10-21T12:00:00Z')
const V: Verdict = {
  schema: 'verdict/1', test: 'v63 sweep-reclaim MNQ 5m', slug: 'v63', pf: 0.91, t_stat: -1.2, p_value: 0.62, p_kind: 'SPA',
  n_trades: 412, verdict: 'FAIL', written_at: '2026-10-21T09:00:00Z',
  gates: [{ name: 'pf', metric: 'pf', op: '>=', threshold: 1.3, value: 0.91, pass: false }],
}

test('the line carries dot, verdict, PF, t, p, n, failed gates and age', () => {
  expect(line(V, NOW)).toBe('🔴 FAIL v63 sweep-reclaim MNQ 5m · PF 0.91 · t -1.20 · SPA p 0.620 · n 412 · failed: pf · 3h ago')
  expect(line({ ...V, verdict: 'PASS', gates: [] }, NOW)?.startsWith('🟢 PASS')).toBe(true)
  expect(line({ ...V, pf: null }, NOW)).toContain('PF —')
})

test('nothing shows for no file, a foreign schema, or a week-old verdict', () => {
  expect(line(null, NOW)).toBeUndefined()
  expect(line({ ...V, schema: 'other' }, NOW)).toBeUndefined()
  expect(line({ ...V, written_at: '2026-10-10T00:00:00Z' }, NOW)).toBeUndefined()
})

function engine(on: On, file: string | null, statuses: unknown[]) {
  mock.env(on, { HOME: '/h' })
  mock.clock(on, { now: NOW })
  on('fs.stat', () => (file === null ? { deny: 'ENOENT' } : { value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }) as never)
  on('fs.read', () => (file === null ? { deny: 'ENOENT' } : { value: file }) as never)
  on('ui.status', (_, e) => {
    statuses.push(e)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

test('session start pins the verdict as this plugin’s status line', async ($, on) => {
  const statuses: unknown[] = []
  engine(on, JSON.stringify(V), statuses)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(JSON.stringify(statuses.at(-1))).toContain('FAIL v63')
})

test('no verdict file clears the line instead of failing', async ($, on) => {
  const statuses: unknown[] = []
  engine(on, null, statuses)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(statuses.length).toBeGreaterThan(0)
  expect(JSON.stringify(statuses.at(-1))).not.toContain('FAIL')
})

// --- draw-time re-check (verdict/2 + policy) ---

const ON = { schema: 'policy/1', rules: { cost_gate: true, variant_counter: true, null_first: true, experiment_ledger: false }, variant_limit: 20, rc_alpha: 0.05 }
const OFF = { schema: 'policy/1', rules: { cost_gate: false, variant_counter: false, null_first: false, experiment_ledger: false } }
const COSTS = { NQ: { rt_pts: 0.9, rt_pts_open: 2.5, source: 'measured' } }
const V2: Verdict = {
  schema: 'verdict/2', test: 'v64 demo NQ', idea: 'demo', variant: 'abc', pf: 1.5, t_stat: 2.5, p_value: 0.01, p_kind: 'SPA',
  n_trades: 300, costs_applied: true, cost_model: { symbol: 'NQ', rt_pts: 1.0, source: 'measured' }, basis: 'NET',
  null_kind: 'flip', null_pf: 0.9, null_pct: null, variants_tried: 1, blocked_by: [], gates: [], verdict: 'PASS',
  written_at: '2026-10-21T11:00:00Z',
}

test('a hand-written PASS with costs_applied false and cost_gate on shows INCONCLUSIVE, GROSS and the block', () => {
  const forged: Verdict = { ...V2, costs_applied: false, basis: 'NET', blocked_by: [], variants_tried: 1 }
  const s = line(forged, NOW, { policy: ON, costs: COSTS, variantsTried: 1 })
  expect(s).toBe('🟡 INCONCLUSIVE v64 demo NQ · GROSS · PF 1.50 · t 2.50 · SPA p 0.010 · n 300 · blocked: cost_gate · 1h ago')
})

test('every rule satisfied: PASS stays PASS, no GROSS, nothing blocked', () => {
  const s = line(V2, NOW, { policy: ON, costs: COSTS, variantsTried: 1 })
  expect(s).toBe('🟢 PASS v64 demo NQ · PF 1.50 · t 2.50 · SPA p 0.010 · n 300 · 1h ago')
})

test('all rules off: a GROSS PASS with no null is shown as PASS (with GROSS)', () => {
  const s = line({ ...V2, costs_applied: false, null_kind: null }, NOW, { policy: OFF, costs: COSTS, variantsTried: 50 })
  expect(s?.startsWith('🟢 PASS v64 demo NQ · GROSS · PF 1.50')).toBe(true)
  expect(s).not.toContain('blocked')
})

test('the file’s own verdict, blocked_by and variants_tried are not trusted', () => {
  // claims 1 variant; the ledger count says 30 and the p is a permutation p -> blocked
  const s = line({ ...V2, p_kind: 'perm', variants_tried: 1 }, NOW, { policy: ON, costs: COSTS, variantsTried: 30 })
  expect(s).toContain('🟡 INCONCLUSIVE')
  expect(s).toContain('blocked: variant_counter')
  // a FAIL is never upgraded and lists no blocks
  expect(line({ ...V2, verdict: 'FAIL' }, NOW, { policy: OFF, costs: COSTS, variantsTried: 1 })?.startsWith('🔴 FAIL')).toBe(true)
})

test('a file written already downgraded shows the current reasons and never goes back up', () => {
  const written: Verdict = { ...V2, costs_applied: false, null_kind: null, verdict: 'INCONCLUSIVE', blocked_by: ['cost_gate', 'null_first'] }
  expect(line(written, NOW, { policy: ON, costs: COSTS, variantsTried: 1 })).toContain('🟡 INCONCLUSIVE v64 demo NQ · GROSS · PF 1.50 · t 2.50 · SPA p 0.010 · n 300 · blocked: cost_gate,null_first')
  const off = line(written, NOW, { policy: OFF, costs: COSTS, variantsTried: 1 })
  expect(off?.startsWith('🟡 INCONCLUSIVE')).toBe(true)
  expect(off).not.toContain('blocked')
})

test('v1 files still draw; enabled rules apply to them (cost_gate on -> GROSS + INCONCLUSIVE)', () => {
  const pass1: Verdict = { ...V, verdict: 'PASS', gates: [] }
  expect(line(pass1, NOW, { policy: OFF, costs: COSTS, variantsTried: null })).toBe('🟢 PASS v63 sweep-reclaim MNQ 5m · PF 0.91 · t -1.20 · SPA p 0.620 · n 412 · 3h ago')
  const onlyCost = { ...OFF, rules: { ...OFF.rules, cost_gate: true } }
  expect(line(pass1, NOW, { policy: onlyCost, costs: COSTS, variantsTried: null })).toBe('🟡 INCONCLUSIVE v63 sweep-reclaim MNQ 5m · GROSS · PF 0.91 · t -1.20 · SPA p 0.620 · n 412 · blocked: cost_gate · 3h ago')
  expect(line(pass1, NOW, { policy: ON, costs: COSTS, variantsTried: null })).toContain('blocked: cost_gate,variant_counter,null_first')
})

function engine2(on: On, files: Record<string, string>, statuses: unknown[]) {
  mock.env(on, { HOME: '/h' })
  mock.clock(on, { now: NOW })
  on('fs.read', (_, e) => (e.path in files ? { value: files[e.path] } : { deny: 'ENOENT' }) as never)
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }) as never)
  on('ui.status', (_, e) => {
    statuses.push(e)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

test('drawing reads policy.json, bad-data costs and the ledger: a forged PASS shows INCONCLUSIVE', async ($, on) => {
  const statuses: unknown[] = []
  engine2(on, {
    '/h/.claude/verdict/latest.json': JSON.stringify({ ...V2, costs_applied: false }),
    '/h/.claude/verdict/policy.json': JSON.stringify(ON),
    '/h/.claude/mods-src/bad-data/bad-data.json': JSON.stringify({ costs: COSTS }),
  }, statuses)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const last = JSON.stringify(statuses.at(-1))
  expect(last).toContain('INCONCLUSIVE v64')
  expect(last).toContain('GROSS')
  expect(last).toContain('blocked: cost_gate')
})

test('drawing counts variants from the ledger (25 for this idea, perm p -> blocked)', async ($, on) => {
  const statuses: unknown[] = []
  const ledger = Array.from({ length: 25 }, (_, i) => JSON.stringify({ idea: 'demo', variant: `v${i}` })).join('\n')
  engine2(on, {
    '/h/.claude/verdict/latest.json': JSON.stringify({ ...V2, p_kind: 'perm', variants_tried: 1 }),
    '/h/.claude/verdict/policy.json': JSON.stringify(ON),
    '/h/.claude/mods-src/bad-data/bad-data.json': JSON.stringify({ costs: COSTS }),
    '/h/Trading/_ledger/experiments.jsonl': ledger,
  }, statuses)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(JSON.stringify(statuses.at(-1))).toContain('blocked: variant_counter')
})

test('drawing with no policy file: rules off, a clean PASS shows PASS', async ($, on) => {
  const statuses: unknown[] = []
  engine2(on, { '/h/.claude/verdict/latest.json': JSON.stringify(V2) }, statuses)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const last = JSON.stringify(statuses.at(-1))
  expect(last).toContain('PASS v64')
  expect(last).not.toContain('blocked')
})

// verdict.py write_verdict: variant_counter on with experiment_ledger off means variants_tried is unknown,
// so the rule refuses PASS (the ledger is never appended to, its count would stay at 1).
const COUNTER_NO_LEDGER = { schema: 'policy/1', rules: { variant_counter: true, experiment_ledger: false }, variant_limit: 20 }

test('drawing with variant_counter on and experiment_ledger off: a hand-written PASS without RC/SPA p is blocked', async ($, on) => {
  const statuses: unknown[] = []
  engine2(on, {
    '/h/.claude/verdict/latest.json': JSON.stringify({ ...V2, p_kind: 'perm' }),
    '/h/.claude/verdict/policy.json': JSON.stringify(COUNTER_NO_LEDGER),
  }, statuses)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const last = JSON.stringify(statuses.at(-1))
  expect(last).toContain('INCONCLUSIVE v64')
  expect(last).toContain('blocked: variant_counter')
})

test('a file verdict.py already downgraded for variant_counter keeps showing the block', async ($, on) => {
  const statuses: unknown[] = []
  engine2(on, {
    '/h/.claude/verdict/latest.json': JSON.stringify({ ...V2, p_kind: 'perm', verdict: 'INCONCLUSIVE', variants_tried: null, blocked_by: ['variant_counter'] }),
    '/h/.claude/verdict/policy.json': JSON.stringify(COUNTER_NO_LEDGER),
  }, statuses)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(JSON.stringify(statuses.at(-1))).toContain('blocked: variant_counter')
})

// Python's json writes pf = inf as a bare Infinity token (a small-n run with no losers).
test('a latest.json with a bare Infinity pf still draws, as PF ∞', async ($, on) => {
  const statuses: unknown[] = []
  const text = JSON.stringify({ ...V2, verdict: 'FAIL' }).replace('"pf":1.5', '"pf": Infinity')
  expect(text).toContain('"pf": Infinity')
  engine2(on, { '/h/.claude/verdict/latest.json': text }, statuses)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const last = JSON.stringify(statuses.at(-1))
  expect(last).toContain('FAIL v64')
  expect(last).toContain('PF ∞')
})

test('ledger lines with bare Infinity still count as variants', async ($, on) => {
  const statuses: unknown[] = []
  const ledger = ['{"idea": "demo", "variant": "b", "pf": Infinity, "null_pf": NaN}', '{"idea": "demo", "variant": "c", "pf": 1.2}'].join('\n')
  engine2(on, {
    '/h/.claude/verdict/latest.json': JSON.stringify({ ...V2, p_kind: 'perm' }),
    '/h/.claude/verdict/policy.json': JSON.stringify({ rules: { variant_counter: true, experiment_ledger: true }, variant_limit: 2 }),
    '/h/Trading/_ledger/experiments.jsonl': ledger,
  }, statuses)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(JSON.stringify(statuses.at(-1))).toContain('blocked: variant_counter')
})

test('normal work: variant_counter and experiment_ledger both on, a small ledger, a clean PASS stays PASS', async ($, on) => {
  const statuses: unknown[] = []
  engine2(on, {
    '/h/.claude/verdict/latest.json': JSON.stringify(V2),
    '/h/.claude/verdict/policy.json': JSON.stringify({ rules: { variant_counter: true, experiment_ledger: true }, variant_limit: 20 }),
    '/h/Trading/_ledger/experiments.jsonl': '{"idea": "demo", "variant": "b", "pf": 1.1}\n',
  }, statuses)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const last = JSON.stringify(statuses.at(-1))
  expect(last).toContain('PASS v64')
  expect(last).not.toContain('blocked')
})
