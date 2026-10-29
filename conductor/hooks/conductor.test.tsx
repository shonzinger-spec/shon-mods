import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { ROUTES_TEXT } from './fixtures.ts'

const BAND = {
  plugin: 'conductor',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 160, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

type Seen = { spawns: any[]; steps: any[]; writes: { path: string; text: string }[]; storeDown: boolean }
type Opts = { ledgerText?: string; userRoutes?: string; store?: Record<string, unknown>; resolves?: Record<string, string> }

function engine(on: On, o: Opts = {}) {
  const seen: Seen = { spawns: [], steps: [], writes: [], storeDown: false }
  const store: Record<string, unknown> = { ...o.store }
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 27, 12) })
  const anyOn = on as any
  anyOn('env.get', () => ({ value: '/Users/t' }))
  anyOn('session.id', () => ({ value: 'sess-1' }))
  const LEDGER = '/Users/t/.claude/conductor/ledger/2026-10-27-sess-1.jsonl'
  anyOn('fs.exists', (_: any, e: any) => ({
    value: (o.userRoutes !== undefined && String(e.path) === '/Users/t/.claude/conductor/routes.json') || (o.ledgerText !== undefined && String(e.path) === LEDGER),
  }))
  anyOn('fs.read', (_: any, e: any) => ({
    value: String(e.path) === LEDGER ? o.ledgerText : String(e.path).endsWith('routes.json') && o.userRoutes !== undefined ? o.userRoutes : ROUTES_TEXT,
  }))
  anyOn('fs.write', (_: any, e: any) => {
    seen.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  anyOn('store.get', (_: any, e: any) => {
    if (seen.storeDown) throw new Error('store down')
    return { value: store[e.key] }
  })
  anyOn('store.set', (_: any, e: any) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  // a Bash command fails when it contains FAIL (step 3b checks)
  anyOn('tool.call', (_: any, e: any) => ({ result: {}, isError: typeof e.command === 'string' && e.command.includes('FAIL') }))
  anyOn('command.register', () => ({ value: { command: 'conductor' } }))
  anyOn('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  // the engine beneath: records exactly what reached it and "starts" an agent
  anyOn('agent.spawn', (_: any, e: any) => {
    seen.spawns.push(structuredClone(e))
    return { model: e.model ?? o.resolves?.[e.subagentType] ?? e.parentModel, agentId: `ag${seen.spawns.length}` }
  })
  anyOn('turn.step', async function* (_: any, e: any) {
    seen.steps.push(structuredClone(e))
    return {
      turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, model: e.model },
    }
  })
  anyOn('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return { seen, clock, store }
}

const base = { tool_use_id: 'tu', prompt: 'do it', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false }
const SPAWNS: any[] = [
  { ...base, description: 'Skeptic: prop option sim', subagentType: 'general-purpose' },
  { ...base, description: 'Draft outreach email', subagentType: 'general-purpose' },
  { ...base, description: 'Find the loader file', subagentType: 'frugal:scout', model: 'haiku' },
  { ...base, description: 'Fork it', subagentType: 'fork', fork: true },
  { ...base, description: 'Implement per spec', subagentType: 'delegate:builder' },
  { ...base, tool_use_id: 'wf', description: 'wf: extract facts', subagentType: 'workflow-subagent', workflow: { runId: 'r1', agentIndex: 0 } },
  { ...base, tool_use_id: 'wf', description: 'wf: review diff', subagentType: 'workflow-subagent', workflow: { runId: 'r1', agentIndex: 1 } },
  { ...base, tool_use_id: 'wf', description: 'wf: leak audit', subagentType: 'workflow-subagent', workflow: { runId: 'r1', agentIndex: 2 }, model: 'opus' },
  { ...base, description: 'Run the backtest', subagentType: 'general-purpose' },
  { ...base, description: 'Something vague', subagentType: 'Explore' },
]

async function start($: any) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

async function rows(seen: Seen, clock: any) {
  await clock.advance(2000)
  // the ledger file; the bus (step 5) writes its own file too
  const last = seen.writes.filter(w => w.path.includes('/conductor/ledger/')).at(-1)
  return last ? last.text.trim().split('\n').map(l => JSON.parse(l)) : []
}

async function bandLine($: any) {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const t = (await ui.find({ type: 'Text', text: /conductor/ }))?.text
  await ui.unmount()
  return t
}

async function step($: any, extra: any) {
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5', messageCount: 1, ...extra })) {
    // drain
  }
}

test('10 spawns (Agent tool + workflow) reach the engine unchanged and leave 10 route rows', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($)
  for (const e of SPAWNS) await $.agent.spawn(e)
  expect(seen.spawns.length).toBe(10)
  for (let i = 0; i < 10; i++) expect(seen.spawns[i]).toEqual(SPAWNS[i])
  const rs = (await rows(seen, clock)).filter((r: any) => r.type === 'route')
  expect(rs.length).toBe(10)
  expect(seen.writes.at(-1)?.path).toBe('/Users/t/.claude/conductor/ledger/2026-10-27-sess-1.jsonl')
  expect(rs[0].cls).toBe('verdict')
  expect(rs.every((r: any) => r.applied === false && r.mode === 'enforce' && r.escalated === false && r.checkFailed === false)).toBe(true)
  expect(rs[2].kind).toBe('forced')
  expect(rs[3].kind).toBe('inherited')
  expect(rs[4].kind).toBe('suggested')
  expect(rs[5].workflowRunId).toBe('r1')
  expect(rs[6].workflowIndex).toBe(1)
  expect(rs[9].agentId).toBe('ag10')
  expect(rs[2].resolvedModel).toBe('haiku')
  expect(await bandLine($)).toBe('conductor · enforce · last: Something vague → unclassified inherit · unchanged')
})

test('/conductor off: 5 spawns, 0 rewrites, 0 route rows; on again resumes', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($)
  await $.command.run({ command: 'conductor', args: 'off' } as any)
  for (const e of SPAWNS.slice(0, 5)) await $.agent.spawn(e)
  for (let i = 0; i < 5; i++) expect(seen.spawns[i]).toEqual(SPAWNS[i])
  expect((await rows(seen, clock)).length).toBe(0)
  expect(await bandLine($)).toBe('conductor · off')
  const st = await $.command.run({ command: 'conductor', args: 'status' } as any)
  expect(st.text).toContain('route rows 0')
  await $.command.run({ command: 'conductor', args: 'on' } as any)
  await $.agent.spawn(SPAWNS[0])
  expect((await rows(seen, clock)).length).toBe(1)
})

test('invalid routes.json: spawns pass through unchanged, band shows the routes error', async ($, on) => {
  const { seen, clock } = engine(on, { userRoutes: '{ "version": 1, "classes": 7 }' })
  await start($)
  for (const e of SPAWNS.slice(0, 3)) await $.agent.spawn(e)
  for (let i = 0; i < 3; i++) expect(seen.spawns[i]).toEqual(SPAWNS[i])
  expect((await rows(seen, clock)).length).toBe(0)
  expect(await bandLine($)).toMatch(/^conductor · enforce · routes invalid: /)
  const st = await $.command.run({ command: 'conductor', args: 'status' } as any)
  expect(st.text).toContain('/Users/t/.claude/conductor/routes.json · INVALID')
})

test('a hook failure never blocks a spawn; the band counts it', async ($, on) => {
  const { seen } = engine(on)
  await start($)
  seen.storeDown = true
  await $.agent.spawn(SPAWNS[1])
  expect(seen.spawns.length).toBe(1)
  expect(seen.spawns[0]).toEqual(SPAWNS[1])
  expect(await bandLine($)).toContain('errors 1')
})

test('turn.step usage of a subagent is summed under its agentId; main steps are not', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($)
  await $.agent.spawn(SPAWNS[2]) // -> ag1, frugal:scout
  await step($, { agentId: 'ag1' })
  await step($, { agentId: 'ag1', index: 1 })
  await step($, {}) // main thread
  const us = (await rows(seen, clock)).filter((r: any) => r.type === 'usage')
  expect(us.length).toBe(1)
  expect(us[0]).toMatchObject({ agentId: 'ag1', subagentType: 'frugal:scout', model: 'claude-sonnet-5', steps: 2, input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 200, cache_creation_input_tokens: 40 })
})

test('/conductor why lists the last 5 rows with reasons', async ($, on) => {
  engine(on)
  await start($)
  for (const e of SPAWNS) await $.agent.spawn(e)
  const w = await $.command.run({ command: 'conductor', args: 'why' } as any)
  const lines = w.text.split('\n')
  expect(lines.length).toBe(5)
  expect(lines[4]).toContain('Something vague')
})

// ---- step 3a: enforcement ----

const SONNET = 'claude-sonnet-5'
const gp = (description: string, extra: any = {}) => ({ ...base, description, subagentType: 'general-purpose', ...extra })

test('verdict on an unpinned engine agent under a sonnet parent: raised to opus, first step to xhigh', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($)
  const r = await $.agent.spawn(gp('Skeptic: prop option sim', { parentModel: SONNET }))
  expect(seen.spawns[0].model).toBe('opus')
  await step($, { agentId: r.agentId, effort: 'high', model: 'opus' })
  expect(seen.steps[0].effort).toBe('xhigh')
  const [row] = (await rows(seen, clock)).filter((x: any) => x.type === 'route')
  expect(row).toMatchObject({ applied: true, before: { model: SONNET, effort: 'high' }, after: { model: 'opus', effort: 'xhigh' }, escalated: false, checkFailed: false })
  expect(await bandLine($)).toContain('applied model opus · effort xhigh')
})

test('a subagent step at max is sent as xhigh; a main-session step at max is untouched', async ($, on) => {
  const { seen } = engine(on)
  await start($)
  await step($, { agentId: 'unrouted', effort: 'max' })
  await step($, { effort: 'max' })
  expect(seen.steps[0].effort).toBe('xhigh')
  expect(seen.steps[1].effort).toBe('max')
})

test('a caller-set model is kept although the route differs; its effort is left alone', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($)
  const e = gp('Skeptic: prop option sim', { parentModel: SONNET, model: 'haiku' })
  const r = await $.agent.spawn(e)
  expect(seen.spawns[0]).toEqual(e)
  await step($, { agentId: r.agentId, effort: 'high' })
  expect(seen.steps[0].effort).toBe('high')
  const [row] = (await rows(seen, clock)).filter((x: any) => x.type === 'route')
  expect(row).toMatchObject({ kind: 'forced', applied: false })
})

test('a caller-set effort (from the Agent tool call) is kept', async ($, on) => {
  const { seen } = engine(on)
  await start($)
  await $.tool.call({ tool: 'Agent', tool_use_id: 'tu-eff', effort: 'medium', description: 'x', prompt: 'x' } as any)
  const r = await $.agent.spawn(gp('Skeptic: prop option sim', { parentModel: SONNET, tool_use_id: 'tu-eff' }))
  expect(seen.spawns[0].model).toBe('opus')
  await step($, { agentId: r.agentId, effort: 'medium' })
  expect(seen.steps[0].effort).toBe('medium')
})

test('a fork is never rewritten', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($)
  const e = { ...base, description: 'Skeptic: fork it', subagentType: 'fork', fork: true, parentModel: SONNET }
  await $.agent.spawn(e)
  expect(seen.spawns[0]).toEqual(e)
  const [row] = (await rows(seen, clock)).filter((x: any) => x.type === 'route')
  expect(row).toMatchObject({ kind: 'inherited', applied: false })
})

test('lowerings: checked class applied on an unpinned type; suggest class not; pinned plugin type not', async ($, on) => {
  const { seen, clock } = engine(on, { store: { pins: { 'delegate:builder': 'opus' } } })
  await start($)
  const fix = await $.agent.spawn(gp('Fix the failing test'))
  expect(seen.spawns[0].model).toBe('sonnet')
  await step($, { agentId: fix.agentId, effort: 'high', model: 'sonnet' })
  expect(seen.steps[0].effort).toBe('medium')

  const draft = gp('Draft outreach email')
  const d = await $.agent.spawn(draft)
  expect(seen.spawns[1]).toEqual(draft)
  await step($, { agentId: d.agentId, effort: 'high' })
  expect(seen.steps[1].effort).toBe('high')

  const pinned = { ...base, description: 'Fix the failing test', subagentType: 'delegate:builder', provider: { plugin: 'delegate', tier: 'user' }, parentModel: SONNET }
  await $.agent.spawn(pinned)
  expect(seen.spawns[2]).toEqual(pinned)

  const rs = (await rows(seen, clock)).filter((x: any) => x.type === 'route')
  expect(rs[0]).toMatchObject({ applied: true, after: { model: 'sonnet', effort: 'medium' } })
  expect(rs[1].applied).toBe(false)
  expect(rs[1].notApplied).toEqual(['lower model claude-opus-5-5→sonnet', 'lower effort high→medium'])
  expect(rs[2].applied).toBe(false)
  expect(rs[2].notApplied).toEqual(['lower model opus→sonnet'])
})

test('learned pin: an unrewritten spawn records its resolved model; one equal to the parent records none', async ($, on) => {
  const { store } = engine(on, { resolves: { Explore: 'claude-haiku-4-5' } })
  await start($)
  await $.agent.spawn({ ...base, description: 'Something vague', subagentType: 'Explore' })
  await $.agent.spawn(gp('Something vague'))
  expect(store.pins).toEqual({ Explore: 'claude-haiku-4-5' })
})

test('a hook error on a step passes it on unchanged (no cap) and the band counts it', async ($, on) => {
  const { seen } = engine(on)
  await start($)
  seen.storeDown = true
  await step($, { agentId: 'ag9', effort: 'max' })
  expect(seen.steps[0].effort).toBe('max')
  expect(await bandLine($)).toContain('errors 1')
})

// ---- step 3b: escalation after a failed check ----

const MIN = 60 * 1000
const bash = ($: any, agentId: string, command: string) => $.tool.call({ tool: 'Bash', tool_use_id: `b-${command}`, agentId, command } as any)

test('a checked task whose last test fails is re-spawned one tier up, once; a third spawn holds', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($)
  const a = await $.agent.spawn(gp('Fix the failing test'))
  expect(seen.spawns[0].model).toBe('sonnet')
  await bash($, a.agentId, 'cd x && python -m pytest -q FAIL')
  await clock.advance(10 * MIN)
  const b = await $.agent.spawn(gp('Fix the failing test (round 2)'))
  expect(seen.spawns[1].model).toBe('opus')
  await step($, { agentId: b.agentId, effort: 'medium', model: 'opus' })
  expect(seen.steps[0].effort).toBe('high')
  await bash($, b.agentId, 'claude plugin test x FAIL')
  await $.agent.spawn(gp('Fix the failing test #3'))
  expect(seen.spawns[2].model).toBe('opus')
  const rs = (await rows(seen, clock)).filter((x: any) => x.type === 'route')
  expect(rs.map((r: any) => [r.escalated, r.checkFailed])).toEqual([[false, true], [true, true], [true, false]])
})

test('a checked task whose last test passes (an earlier one failed) is not escalated', async ($, on) => {
  const { seen } = engine(on)
  await start($)
  const a = await $.agent.spawn(gp('Fix the failing test'))
  await bash($, a.agentId, 'npm test FAIL')
  await bash($, a.agentId, 'npm test')
  await $.agent.spawn(gp('Fix the failing test'))
  expect(seen.spawns[1].model).toBe('sonnet')
})

test('a re-spawn after 30 minutes is not escalated', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($)
  const a = await $.agent.spawn(gp('Fix the failing test'))
  await bash($, a.agentId, 'cargo test FAIL')
  await clock.advance(31 * MIN)
  await $.agent.spawn(gp('Fix the failing test'))
  expect(seen.spawns[1].model).toBe('sonnet')
})

test('a non-checked class with a failing test is not escalated', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($)
  const a = await $.agent.spawn(gp('Draft outreach email'))
  await bash($, a.agentId, 'pytest FAIL')
  await $.agent.spawn(gp('Draft outreach email'))
  expect(seen.spawns[1].model).toBeUndefined()
  const rs = (await rows(seen, clock)).filter((x: any) => x.type === 'route')
  expect(rs.map((r: any) => [r.escalated, r.checkFailed])).toEqual([[false, false], [false, false]])
})

test('a failing Bash command that is not a check sets no checkFailed', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($)
  const a = await $.agent.spawn(gp('Fix the failing test'))
  await bash($, a.agentId, 'ls FAIL')
  await $.agent.spawn(gp('Fix the failing test'))
  expect(seen.spawns[1].model).toBe('sonnet')
  const rs = (await rows(seen, clock)).filter((x: any) => x.type === 'route')
  expect(rs[0].checkFailed).toBe(false)
})

test('a caller-set higher model on a re-spawn is kept and noted escalated', async ($, on) => {
  const { seen, clock } = engine(on)
  await start($)
  const a = await $.agent.spawn(gp('Fix the failing test'))
  await bash($, a.agentId, 'pytest FAIL')
  await $.agent.spawn(gp('Fix the failing test', { model: 'fable' }))
  expect(seen.spawns[1].model).toBe('fable')
  const rs = (await rows(seen, clock)).filter((x: any) => x.type === 'route')
  expect(rs[1]).toMatchObject({ escalated: true, applied: false, kind: 'forced' })
})

test('a reload keeps the rows an earlier load wrote to this session\'s ledger', async ($, on) => {
  const prior = [
    { type: 'route', ts: '2026-10-27T11:00:00.000Z', agentId: 'old1', description: 'Earlier spawn', subagentType: 'delegate:builder' },
    { type: 'usage', agentId: 'old1', subagentType: 'delegate:builder', description: 'Earlier spawn', model: 'claude-opus-5-5', steps: 3,
      firstTs: '2026-10-27T11:00:00.000Z', lastTs: '2026-10-27T11:05:00.000Z', input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 },
  ]
  const { seen, clock } = engine(on, { ledgerText: prior.map(r => JSON.stringify(r)).join('\n') + '\n{torn' })
  await start($)
  await $.agent.spawn(SPAWNS[4])
  const rs = await rows(seen, clock)
  expect(rs.filter((r: any) => r.type === 'route').map((r: any) => r.agentId)).toEqual(['old1', 'ag1'])
  const u = rs.find((r: any) => r.type === 'usage' && r.agentId === 'old1')
  expect(u?.steps).toBe(3)
  expect(u?.cache_creation_input_tokens).toBe(4)
})

const main = ($: any, v: string) => $.command.run({ command: 'conductor', args: `main ${v}` } as any)

test('main auto is off by default: a main max step reaches the engine as max and the band has no main line', async ($, on) => {
  const { seen } = engine(on)
  await start($)
  await step($, { effort: 'max' })
  expect(seen.steps[0].effort).toBe('max')
  expect(await bandLine($) ?? '').not.toContain('main:')
  expect((await $.command.run({ command: 'conductor', args: 'status' } as any)).text).toContain('main auto off')
})

test('main auto on: a main max step is sent as xhigh and the band shows each switch', async ($, on) => {
  const { seen } = engine(on)
  await start($)
  await main($, 'auto')
  expect((await $.command.run({ command: 'conductor', args: 'status' } as any)).text).toContain('main auto on')
  await step($, { effort: 'max' })
  expect(seen.steps[0].effort).toBe('xhigh')
  expect(seen.steps[0].model).toBe('claude-sonnet-5')
  expect(await bandLine($)).toContain('main: max→xhigh')
  await step($, { effort: 'high' })
  expect(seen.steps[1].effort).toBe('high')
  expect(await bandLine($)).toContain('main: claude-sonnet-5/high')
  await step($, { effort: 'max' })
  expect(seen.steps[2].effort).toBe('xhigh')
  expect(await bandLine($)).toContain('main: max→xhigh')
})

test('subagent steps are identical with main auto on and off, and never touch the main line', async ($, on) => {
  const { seen } = engine(on)
  await start($)
  const r = await $.agent.spawn(gp('Skeptic: prop option sim', { parentModel: SONNET }))
  const run = async () => {
    await step($, { agentId: r.agentId, effort: 'high', model: 'opus' })
    await step($, { agentId: 'unrouted', effort: 'max' })
    await step($, { agentId: 'unrouted', effort: 'low' })
  }
  await run()
  const off = seen.steps.map((x: any) => x.effort)
  seen.steps.length = 0
  await main($, 'auto')
  await run()
  expect(seen.steps.map((x: any) => x.effort)).toEqual(off)
  expect(off).toEqual(['xhigh', 'xhigh', 'low'])
  expect(await bandLine($) ?? '').not.toContain('main:')
})

test('/conductor main off restores pass-through', async ($, on) => {
  const { seen } = engine(on)
  await start($)
  await main($, 'auto')
  await step($, { effort: 'max' })
  await main($, 'off')
  await step($, { effort: 'max' })
  expect(seen.steps.map((x: any) => x.effort)).toEqual(['xhigh', 'max'])
})
