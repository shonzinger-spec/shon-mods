import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { DAILY_CAP_USD, PROMOTE_AT, SAMPLE_EVERY, eligible, emptyState, promoted, record, shouldSample, tagShadow } from './calibrate.ts'
import { ROUTES_TEXT } from './fixtures.ts'

// ---- step 8: calibration ----

const STATE = '/Users/t/.claude/conductor/state.json'
const EVALS = '/Users/t/.claude/conductor/evals.jsonl'
const DAY = '2026-10-27'

function engine(on: On, o: { files?: Record<string, string>; store?: Record<string, unknown>; judge?: string } = {}) {
  const files: Record<string, string> = { ...o.files }
  const store: Record<string, unknown> = { ...o.store }
  const seen = { spawns: [] as any[], judged: [] as any[] }
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 27, 12) })
  const anyOn = on as any
  anyOn('env.get', () => ({ value: '/Users/t' }))
  anyOn('session.id', () => ({ value: 'sess-1' }))
  anyOn('fs.exists', (_: any, e: any) => ({ value: String(e.path) in files }))
  anyOn('fs.read', (_: any, e: any) => ({ value: files[String(e.path)] ?? ROUTES_TEXT }))
  anyOn('fs.write', (_: any, e: any) => {
    files[String(e.path)] = e.text
    return { value: undefined }
  })
  anyOn('store.get', (_: any, e: any) => ({ value: store[e.key] }))
  anyOn('store.set', (_: any, e: any) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  anyOn('command.register', () => ({ value: { command: 'conductor' } }))
  anyOn('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  anyOn('agent.spawn', (_: any, e: any) => {
    seen.spawns.push(structuredClone(e))
    return { model: e.model ?? e.parentModel, agentId: `ag${seen.spawns.length}` }
  })
  anyOn('turn.step', async function* (_: any, e: any) {
    return {
      turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn',
      usage: { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: e.model },
    }
  })
  anyOn('agent.list', () => ({ value: seen.spawns.map((x, i) => ({ id: `ag${i + 1}`, description: x.description, type: x.subagentType, status: 'running' })) }))
  anyOn('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  anyOn('model.complete', (_: any, e: any) => {
    seen.judged.push(e)
    return { value: { isAnswered: true, text: o.judge ?? 'AGREE\nsame files', usage: { input_tokens: 1000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  return { seen, files, store, clock }
}

const base = { tool_use_id: 'tu', prompt: 'find where the loader lives', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false }
const locate = (extra: any = {}) => ({ ...base, description: 'Locate the loader file', subagentType: 'general-purpose', ...extra })
const ON = { calibrate: true }
const seeded = (classes: any, spend = { day: DAY, usd: 0 }) => JSON.stringify({ version: 1, classes, spend })
const shadows = (spawns: any[]) => spawns.filter(s => String(s.description).includes('cx-shadow'))

async function start($: any) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}
async function done($: any, agentId: string, answer: string) {
  await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: `t-${agentId}`, agentId, reason: 'answer' })
}
const evalRows = (files: Record<string, string>) => (files[EVALS] ?? '').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
const state = (files: Record<string, string>) => JSON.parse(files[STATE])

test('calibration is off by default: 30 read-only runs spawn no shadow', async ($, on) => {
  const { seen, files } = engine(on)
  await start($)
  for (let i = 0; i < 30; i++) await $.agent.spawn(locate() as any)
  expect(seen.spawns.length).toBe(30)
  expect(shadows(seen.spawns).length).toBe(0)
  expect(files[STATE]).toBeUndefined()
})

test('1 run in 10 is shadowed, tagged cx-shadow, on the route model, and the shadow is never sampled again', async ($, on) => {
  const { seen, files } = engine(on, { store: ON })
  await start($)
  for (let i = 0; i < 20; i++) await $.agent.spawn(locate() as any)
  const sh = shadows(seen.spawns)
  expect(seen.spawns.length).toBe(22)
  expect(sh.length).toBe(20 / SAMPLE_EVERY)
  expect(sh[0].description).toBe(tagShadow('Locate the loader file', 1))
  expect(sh[0].model).toBe('haiku')
  expect(sh[0].prompt).toBe(base.prompt)
  // the 10th original is ag10, its shadow ag11; shadows reached the engine and were not counted as runs
  expect(seen.spawns[10].description).toContain('cx-shadow')
  expect(state(files).classes.locate.seen).toBe(20)
})

test('edit, run, verdict and other side-effect classes are never shadowed', async ($, on) => {
  const { seen } = engine(on, { store: ON })
  await start($)
  for (const d of ['Fix the failing test', 'Run the backtest', 'Skeptic: prop option sim', 'Commit and push the branch', 'Implement per spec', 'Draft outreach email']) {
    for (let i = 0; i < 12; i++) await $.agent.spawn({ ...base, description: d, subagentType: 'general-purpose' } as any)
  }
  expect(shadows(seen.spawns).length).toBe(0)
  expect(seen.spawns.length).toBe(72)
})

test('eligible(): only locate/extract, never a fork, workflow agent or a tagged shadow', () => {
  const e = { fork: false, description: 'Locate x' }
  expect(eligible('locate', e)).toBe(true)
  expect(eligible('extract', e)).toBe(true)
  for (const c of ['mech_edit', 'checked_fix', 'run_report', 'verdict', 'spec_code', 'drafts', 'unclassified']) expect(eligible(c, e)).toBe(false)
  expect(eligible('locate', { ...e, fork: true })).toBe(false)
  expect(eligible('locate', { ...e, workflow: { runId: 'r' } })).toBe(false)
  expect(eligible('locate', { ...e, description: tagShadow('Locate x') })).toBe(false)
})

test('a spawn carrying the cx-shadow tag passes through unrouted and unsampled', async ($, on) => {
  const { seen, files } = engine(on, { store: ON, files: { [STATE]: seeded({ locate: { agree: 0, total: 0, promoted: true, seen: 9 } }) } })
  await start($)
  await $.agent.spawn(locate({ description: tagShadow('Locate the loader file') }) as any)
  expect(seen.spawns.length).toBe(1)
  expect(seen.spawns[0].model).toBeUndefined() // promoted locate would lower an untagged run to haiku
  expect(state(files).classes.locate.seen).toBe(9)
})

test('no sampling once the day\'s shadow spend reaches $10', async ($, on) => {
  const { seen } = engine(on, { store: ON, files: { [STATE]: seeded({ locate: { agree: 0, total: 0, promoted: false, seen: 0 } }, { day: DAY, usd: DAILY_CAP_USD }) } })
  await start($)
  for (let i = 0; i < 30; i++) await $.agent.spawn(locate() as any)
  expect(shadows(seen.spawns).length).toBe(0)
})

test('shadow step usage counts toward the cap and stops further sampling', async ($, on) => {
  const { seen, files } = engine(on, { store: ON, files: { [STATE]: seeded({ locate: { agree: 0, total: 0, promoted: false, seen: 9 } }) } })
  await start($)
  await $.agent.spawn(locate() as any) // ag1 original, ag2 shadow on haiku
  // 2M haiku input tokens per step at $1/MTok = $2 a step; 5 steps reach $10
  for (let i = 0; i < 5; i++) for await (const _ of $.turn.step({ turnId: 't', index: i, model: 'haiku', messageCount: 1, agentId: 'ag2' } as any)) { /* drain */ }
  expect(state(files).spend.usd).toBeGreaterThanOrEqual(DAILY_CAP_USD - 5.0001)
  for (let i = 0; i < 5; i++) for await (const _ of $.turn.step({ turnId: 't', index: 5 + i, model: 'haiku', messageCount: 1, agentId: 'ag2' } as any)) { /* drain */ }
  expect(state(files).spend.usd).toBeGreaterThanOrEqual(DAILY_CAP_USD)
  for (let i = 0; i < 20; i++) await $.agent.spawn(locate() as any)
  expect(shadows(seen.spawns).length).toBe(1)
})

test('shouldSample(): every 10th eligible run while under the cap', () => {
  const st = emptyState()
  const picks = Array.from({ length: 30 }, () => shouldSample(st, 'locate', DAY))
  expect(picks.filter(Boolean).length).toBe(3)
  expect(picks[9] && picks[19] && picks[29]).toBe(true)
  st.spend = { day: DAY, usd: DAILY_CAP_USD }
  expect(Array.from({ length: 10 }, () => shouldSample(st, 'locate', DAY)).some(Boolean)).toBe(false)
  // a new day starts a new budget
  expect(Array.from({ length: 10 }, () => shouldSample(st, 'locate', '2026-10-28')).some(Boolean)).toBe(true)
})

test('promotion only at 60/60 (59/59 is not promoted); one miss demotes and resets', () => {
  const st = emptyState()
  for (let i = 0; i < PROMOTE_AT - 1; i++) record(st, 'locate', 'agree')
  expect(st.classes.locate.agree).toBe(59)
  expect(st.classes.locate.promoted).toBe(false)
  expect(promoted(st).has('locate')).toBe(false)
  record(st, 'locate', 'agree')
  expect(st.classes.locate.promoted).toBe(true)
  expect(promoted(st).has('locate')).toBe(true)
  record(st, 'locate', 'miss')
  expect(st.classes.locate).toEqual({ agree: 0, total: 0, promoted: false, seen: 0 })
  expect(promoted(st).has('locate')).toBe(false)
  record(st, 'locate', 'void')
  expect(st.classes.locate.total).toBe(0)
})

test('a judged miss demotes a promoted class (opus judge on differing outputs)', async ($, on) => {
  const { seen, files } = engine(on, { store: ON, judge: 'DISAGREE\nmissed a file', files: { [STATE]: seeded({ locate: { agree: 60, total: 60, promoted: true, seen: 9 } }) } })
  await start($)
  await $.agent.spawn(locate() as any) // promoted: original lowered to haiku, shadow runs on the parent model
  expect(seen.spawns[0].model).toBe('haiku')
  expect(seen.spawns[1].model).toBe('claude-opus-5-5')
  await done($, 'ag1', 'src/loader.ts')
  await done($, 'ag2', 'src/loader.ts and lib/loader.js')
  expect(seen.judged.length).toBe(1)
  expect(seen.judged[0].model).toBe('opus')
  const ev = evalRows(files)
  expect(ev.length).toBe(1)
  expect(ev[0].verdict).toBe('miss')
  expect(ev[0].judge).toBe('opus')
  expect(state(files).classes.locate.promoted).toBe(false)
  await $.agent.spawn(locate() as any)
  expect(seen.spawns.at(-1).model).toBeUndefined()
})

test('a promoted class has its lowering enforced; an unpromoted one only suggests it', async ($, on) => {
  const { seen } = engine(on, { files: { [STATE]: seeded({ extract: { agree: 60, total: 60, promoted: true, seen: 0 } }) } })
  await start($)
  await $.agent.spawn({ ...base, description: 'Extract facts per item', subagentType: 'general-purpose' } as any)
  await $.agent.spawn(locate() as any)
  expect(seen.spawns[0].model).toBe('sonnet')
  expect(seen.spawns[1].model).toBeUndefined()
})

test('evals and state survive a reload: earlier rows kept, counts continue to promotion', async ($, on) => {
  const prior = [{ ts: 'x', cls: 'locate', verdict: 'agree' }, { ts: 'y', cls: 'locate', verdict: 'agree' }].map(r => JSON.stringify(r)).join('\n') + '\n'
  const { files } = engine(on, { store: ON, files: { [STATE]: seeded({ locate: { agree: 59, total: 59, promoted: false, seen: 9 } }), [EVALS]: prior } })
  await start($)
  await $.agent.spawn(locate() as any)
  await done($, 'ag2', 'src/loader.ts\n')
  await done($, 'ag1', '  src/loader.ts')
  const ev = evalRows(files)
  expect(ev.length).toBe(3)
  expect(ev[0].ts).toBe('x')
  expect(ev[2].verdict).toBe('agree')
  expect(ev[2].judge).toBe('exact')
  expect(state(files).classes.locate).toEqual({ agree: 60, total: 60, promoted: true, seen: 10 })
})

test('/conductor calibrate on|off toggles the store key; status shows per-class counts and promoted classes', async ($, on) => {
  const { store } = engine(on, { files: { [STATE]: seeded({ locate: { agree: 60, total: 60, promoted: true, seen: 0 }, extract: { agree: 3, total: 3, promoted: false, seen: 0 } }) } })
  await start($)
  expect(store.calibrate).toBeUndefined()
  await $.command.run({ command: 'conductor', args: 'calibrate on' } as any)
  expect(store.calibrate).toBe(true)
  const st = (await $.command.run({ command: 'conductor', args: 'status' } as any)) as any
  expect(st.text).toContain('calibration on')
  expect(st.text).toContain('locate 60/60 promoted')
  expect(st.text).toContain('extract 3/3')
  expect(st.text).toContain('promoted: locate')
  await $.command.run({ command: 'conductor', args: 'calibrate off' } as any)
  expect(store.calibrate).toBe(false)
})
