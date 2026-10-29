import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'friction-review',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80, scroll: { offset: 0, bodyRows: 5 }, view: {} },
} as const
const COMPOSE = { model: 'opus', promptModel: 'opus', surfaces: [], tools: [], outputStyle: null, traits: [] }
const RUN = { command: 'friction', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

const LATEST = {
  date: '2026-10-30',
  path: '/home/t/.claude/friction-review/reports/2026-10-30.md',
  counts: { total: 71, patterns: 3 },
  top3: [{ pattern: 'no_such_tool', count: 45, sessions: 4 }, { pattern: 'user_correction', count: 20, sessions: 3 }, { pattern: 'file_not_read', count: 6, sessions: 2 }],
}

function engine(on: any, files: Record<string, string>, writes: Record<string, string> = {}) {
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', (_: any, e: any) => {
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.write', (_: any, e: any) => {
    writes[e.path] = e.text
    files[e.path] = e.text
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'friction' } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.compose', () => ({ sections: [] }))
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}

const LATEST_PATH = '/home/t/.claude/friction-review/latest.json'
const READ_PATH = '/home/t/.claude/friction-review/read.json'

test('the amber band shows while the report is unread, on terminal and desktop', async ($, on) => {
  engine(on, { [LATEST_PATH]: JSON.stringify(LATEST) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /Weekly friction report/ }))?.text).toBe('Weekly friction report ready (3 patterns) - /friction')
    await ui.unmount()
  }
  // a survey holds the band: the mod yields
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Weekly friction report/ })).toBe(undefined)
  await ui.unmount()
})

const HIDDEN: [string, () => Record<string, string>][] = [
  ['there is no report', () => ({})],
  ['it was already read', () => ({ [LATEST_PATH]: JSON.stringify(LATEST), [READ_PATH]: JSON.stringify({ date: '2026-10-30' }) })],
  ['it found no patterns', () => ({ [LATEST_PATH]: JSON.stringify({ ...LATEST, counts: { total: 0, patterns: 0 }, top3: [] }) })],
  ['latest.json is not json', () => ({ [LATEST_PATH]: 'not json' })],
]
for (const [why, files] of HIDDEN) {
  test(`the band stays hidden when ${why}`, async ($, on) => {
    engine(on, files())
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /Weekly friction report/ })).toBe(undefined)
    await ui.unmount()
    expect((await $.prompt.compose(COMPOSE as any)).sections.length).toBe(0)
  })
}

test('a newer report is unread even when an older one was read', async ($, on) => {
  engine(on, { [LATEST_PATH]: JSON.stringify(LATEST), [READ_PATH]: JSON.stringify({ date: '2026-10-23' }) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Weekly friction report/ }))?.text).toContain('(3 patterns)')
  await ui.unmount()
})

test('/friction prints the top patterns, writes read.json and clears the band', async ($, on) => {
  const writes: Record<string, string> = {}
  engine(on, { [LATEST_PATH]: JSON.stringify(LATEST) }, writes)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = await $.command.run(RUN)
  const text = JSON.stringify(r)
  expect(text).toContain('45x no_such_tool')
  expect(text).toContain('20x user_correction')
  expect(text).toContain('/home/t/.claude/friction-review/reports/2026-10-30.md')
  expect(JSON.parse(writes[READ_PATH] ?? '{}')).toEqual({ date: '2026-10-30' })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Weekly friction report/ })).toBe(undefined)
  await ui.unmount()
})

test('/friction with no report says so and writes nothing', async ($, on) => {
  const writes: Record<string, string> = {}
  engine(on, {}, writes)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = await $.command.run(RUN)
  expect(JSON.stringify(r)).toContain('No friction report yet')
  expect(Object.keys(writes)).toEqual([])
})

test('the system prompt carries the offer only while the report is unread', async ($, on) => {
  engine(on, { [LATEST_PATH]: JSON.stringify(LATEST) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const before = await $.prompt.compose(COMPOSE as any)
  expect(before.sections.map((s: any) => s.id)).toEqual(['friction-review:unread'])
  expect(before.sections[0]?.scope).toBe('session')
  expect(before.sections[0]?.text).toContain('/home/t/.claude/friction-review/reports/2026-10-30.md')
  expect(before.sections[0]?.text).toContain('Offer once to read it')
  expect(before.sections[0]?.text).toContain('do not build without approval')
  await $.command.run(RUN)
  const after = await $.prompt.compose(COMPOSE as any)
  expect(after.sections.length).toBe(0)
})

test('a headless run (claude -p, the SDK) gets no offer in its system prompt', async ($, on) => {
  engine(on, { [LATEST_PATH]: JSON.stringify(LATEST) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = await $.prompt.compose({ ...COMPOSE, traits: ['print'] } as any)
  expect(r.sections.length).toBe(0)
})
