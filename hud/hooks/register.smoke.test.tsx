import { expect, mock, test } from 'claude-code/testing'

declare const setTimeout: (f: (v?: unknown) => void, ms: number) => unknown
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const EFFORT = JSON.stringify({ level: 'high', ultracode: false, reason: 'x', source: 'auto', at: 1_000_000 })
const MEM = JSON.stringify({ level: 'ok', freePct: 31, memTotalMB: 16384, swapUsedMB: 50, swapTotalMB: 100, at: 1_000_000 })

type On = (ev: string, fn: (_: unknown, e: any) => unknown) => void
// Most tests below exercise the footer placement; the default (band) has its own test.
function wire(on: On, files: Record<string, string>, store = new Map<string, unknown>([['placement', 'footer']]), clock = true) {
  on('command.register', () => ({ value: { command: 'x' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: '/home/t' }))
  if (clock) on('clock.now', () => ({ value: 1_000_000 }))
  on('session.id', () => ({ value: 'S1' }))
  on('fs.read', (_, e) => ({ value: files[(e as { path: string }).path] ?? '' }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    store.set((e as { key: string }).key, (e as { value: unknown }).value)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  // Stands for the engine beneath the mod: what shows when the mod passes.
  on('ui.render', ($: any, e) => { const { Text } = $.ui.resolve(e as never) as any; return <Text>engine</Text> })
  return store
}
const FILES = { '/home/t/.claude/mods-src/effort-router/state/now-S1.json': EFFORT, '/home/t/.claude/mods-src/memory-guard/state/now.json': MEM }
const START = { cwd: '/', surface: 'desktop', isInteractive: true } as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FOOTER = { plugin: 'hud', surface: 'terminal', component: 'SessionMode', props: { modes: [] } } as any
const BAND = { plugin: 'hud', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } } as any

test('footer draws effort and RAM by default', async ($, on) => {
  wire(on, FILES)
  await $.session.start(START)
  const ui = await $.ui.mount(FOOTER)
  const all = (await ui.findAll({ type: 'Text' })).map(x => x.text).join('')
  expect(all).toContain('high')
  expect(all).toContain('69%')
  const bgs = (await ui.findAll({ type: 'Text' })).map(x => x.props.backgroundColor)
  expect(bgs).toContain('#8B5CF6')
  expect(bgs).toContain('#14B8A6')
  await ui.unmount()
})

test('critical memory pill is red', async ($, on) => {
  wire(on, { ...FILES, '/home/t/.claude/mods-src/memory-guard/state/now.json': MEM.replace('"ok"', '"critical"').replace('"warn"', '"critical"') })
  await $.session.start(START)
  const ui = await $.ui.mount(FOOTER)
  expect((await ui.findAll({ type: 'Text' })).map(x => x.props.backgroundColor)).toContain('#EF4444')
  await ui.unmount()
})

test('/hud place band moves the strip: band draws, footer passes', async ($, on) => {
  wire(on, FILES)
  await $.session.start(START)
  const r = await $.command.run({ command: 'hud', args: 'place band', ...RUN })
  expect(JSON.stringify(r)).toContain('band')
  let ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /ram/ })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount(FOOTER)
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('placement persists into a fresh session', async ($, on) => {
  const store = wire(on, FILES)
  await $.session.start(START)
  await $.command.run({ command: 'hud', args: 'place hint', ...RUN })
  expect(store.get('placement')).toBe('hint')
  await $.session.start(START)
  const r = await $.command.run({ command: 'hud', args: '', ...RUN })
  expect(JSON.stringify(r)).toContain('hint')
  const ui = await $.ui.mount(FOOTER)
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('off draws nothing; bad arg gives usage', async ($, on) => {
  wire(on, FILES)
  await $.session.start(START)
  await $.command.run({ command: 'hud', args: 'place off', ...RUN })
  const ui = await $.ui.mount(FOOTER)
  expect(await ui.find({ type: 'Text', text: /ram/ })).toBeUndefined()
  await ui.unmount()
  const r = await $.command.run({ command: 'hud', args: 'place sideways', ...RUN })
  expect(JSON.stringify(r)).toContain('usage')
})

test('missing files pass to the engine', async ($, on) => {
  wire(on, {})
  await $.session.start(START)
  const ui = await $.ui.mount(FOOTER)
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

// Motion: effort goes low -> max; the mocked clock is moved 40 ms at a time and the drawn filled-cell count is read.
const EFFORT_KEY = '/home/t/.claude/mods-src/effort-router/state/now-S1.json'
const eff = (level: string) => JSON.stringify({ level, ultracode: false, reason: 'x', source: 'auto', at: 1_000_000 })
// Filled cells of the effort pill = characters on Texts with the violet background.
async function cellsDrawn(ui: any): Promise<number> {
  const ts = await ui.findAll({ type: 'Text' })
  return ts.filter((x: any) => x.props.backgroundColor === '#8B5CF6').reduce((n: number, x: any) => n + (x.text as string).length, 0)
}
async function effortRun(motionOff: boolean) {
  return async ($: any, on: any) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const files: Record<string, string> = { ...FILES, [EFFORT_KEY]: eff('low') }
    wire(on, files, new Map<string, unknown>([['placement', 'footer'], ...(motionOff ? [['motion', 'off'] as [string, unknown]] : [])]), false)
    await $.session.start(START)
    const ui = await $.ui.mount(FOOTER)
    files[EFFORT_KEY] = eff('max')
    await clock.advance(5000) // the 5 s refresh sees the change
    return { ui, clock }
  }
}

test('motion on: after low -> max the strip passes through intermediate fill counts and ends full', async ($, on) => {
  const { ui, clock } = await (await effortRun(false))($, on)
  const seen: number[] = []
  for (let i = 0; i < 14; i++) {
    seen.push(await cellsDrawn(ui))
    await clock.advance(40)
  }
  seen.push(await cellsDrawn(ui))
  expect(seen.some(n => n > 2 && n < 10)).toBe(true)
  expect(seen.at(-1)).toBe(10)
  await ui.unmount()
})

test('/hud motion off draws the final value at once and shows in /hud', async ($, on) => {
  const { ui, clock } = await (await effortRun(true))($, on)
  expect(await cellsDrawn(ui)).toBe(10)
  const r = await $.command.run({ command: 'hud', args: '', ...RUN })
  expect(JSON.stringify(r)).toContain('motion off')
  void clock
  await ui.unmount()
})

test('desktop footer draws one Svg strip; terminal keeps text pills', async ($, on) => {
  wire(on, FILES)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  expect(String(svg?.props.source)).toContain('high')
  expect(String(svg?.props.source)).toContain('69%')
  await ui.unmount()
  const t = await $.ui.mount(FOOTER)
  expect(await t.find({ type: 'Svg' })).toBeUndefined()
  expect(await t.find({ type: 'Text', text: /ram/ })).toBeDefined()
  await t.unmount()
})

test('default placement is the band, with other mods\' bands kept beneath it', async ($, on) => {
  wire(on, FILES, new Map())
  await $.session.start(START)
  const ui = await $.ui.mount(BAND)
  const texts = JSON.stringify(await ui.find({ type: 'Text', text: /engine/ }))
  expect(texts).toContain('engine')
  expect(await ui.find({ type: 'Text', text: /high|RAM|ram|%/ })).toBeDefined()
  await ui.unmount()
  const foot = await $.ui.mount(FOOTER)
  expect((await foot.find({ type: 'Text' }))?.text).toBe('engine')
  await foot.unmount()
})
