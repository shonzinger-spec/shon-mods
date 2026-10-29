import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { CqGroup, CqRepo, CqScan } from '../types'

const BAND = {
  plugin: 'commit-queue',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

const group = (over: Partial<CqGroup> = {}): CqGroup => ({
  id: 'mods-src:health-band', group: 'health-band', repo: '/r/mods-src', repo_name: 'mods-src', branch: 'master',
  file_count: 3, allowed_count: 3, added: 40, deleted: 2, withheld: [], hash: 'h1', ...over,
})
const repo = (groups: CqGroup[], over: Partial<CqRepo> = {}): CqRepo => ({
  repo: '/r/mods-src', name: 'mods-src', branch: 'master', readable: true, error: null, truncated: false,
  identity: { name: 'Test Person', email: 't@users.noreply.example.org', source: 'config' }, groups, ...over,
})
const scanOf = (repos: CqRepo[], unreadable = 0): CqScan => {
  const gs = repos.flatMap(r => r.groups)
  return {
    ok: true, interval_min: 10,
    totals: { files: gs.reduce((n, g) => n + g.file_count, 0), groups: gs.length, repos: repos.filter(r => r.groups.length).length, unreadable },
    repos,
  }
}
const ONE = scanOf([repo([group()])])
const EMPTY = scanOf([repo([])])
const TWO = scanOf([repo([group(), group({ id: 'mods-src:kill-ledger', group: 'kill-ledger', hash: 'h2', file_count: 1, allowed_count: 1, added: 5, deleted: 0 })])])

type Wired = { calls: string[][]; asked: string[]; names: string[]; clock: ReturnType<typeof mock.clock> }

/** The engine under the plugin: the script answers from `scan`, asks come from `answers` ('<dismiss>' rejects). */
function wire(on: On, scan: CqScan | 'fail', answers: string[] = [], commitOut: unknown = { ok: true, sha: 'abc1234', author: 'Test Person', email: 't@users.noreply.example.org', files: 3, has_trailer: false }): Wired {
  const clock = mock.clock(on)
  const w: Wired = { calls: [], asked: [], names: [], clock }
  const out = (o: unknown) => ({ value: { exitCode: 0, stdout: JSON.stringify(o), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('command.register', (_, e) => {
    w.names.push((e as { name: string }).name)
    return { value: { command: 'review-commits' } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    const argv = (e as { argv: string[] }).argv
    w.calls.push(argv)
    const sub = argv[2]
    if (sub === 'scan') return scan === 'fail' ? { value: { exitCode: 1, stdout: '', stderr: 'Traceback\nboom', isStdoutTruncated: false, isStderrTruncated: false } } : out(scan)
    if (sub === 'commit') return out(commitOut)
    return out({ ok: true, files: [{ path: 'health-band/a.py', xy: ' M', added: 4, deleted: 1, withheld: null }] })
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('tool.call', (_, e) => {
    const q = e as { tool: string; questions: { question: string }[] }
    const a = answers.shift() ?? ''
    w.asked.push(q.questions[0]?.question ?? '')
    if (a === '<dismiss>') return { deny: 'dismissed' }
    return { result: { questions: q.questions, answers: { [q.questions[0]?.question ?? '']: a } }, text: a }
  })
  return w
}

const commits = (w: Wired) => w.calls.filter(c => c[2] === 'commit')
const startUp = async ($: Engine, w: Wired) => {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await w.clock.advance(100)
}
const review = ($: Engine, args: string) => $.command.run({ command: 'review-commits', args, ...RUN })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`band hidden when zero changes (${surface})`, async ($, on) => {
    const w = wire(on, EMPTY)
    await startUp($, w)
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /waiting for review/ })).toBeFalsy()
    expect((await ui.find({ type: 'Text', text: /^engine$/ }))?.text).toBe('engine')
    await ui.unmount()
  })

  test(`band shows the count, repos and groups, and keeps the band beneath (${surface})`, async ($, on) => {
    const w = wire(on, TWO)
    await startUp($, w)
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /waiting for review/ }))?.text).toBe('4 changes waiting for review in 1 repo (2 groups) - /review-commits')
    expect((await ui.find({ type: 'Text', text: /^engine$/ }))?.text).toBe('engine')
    await ui.unmount()
  })
}

test('band says "1 change" for one', async ($, on) => {
  const w = wire(on, scanOf([repo([group({ file_count: 1, allowed_count: 1 })])]))
  await startUp($, w)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /waiting/ }))?.text).toMatch(/^1 change waiting for review in 1 repo \(1 group\)/)
  await ui.unmount()
})

test('before the first scan nothing is drawn', async ($, on) => {
  wire(on, ONE)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /waiting/ })).toBeFalsy()
  await ui.unmount()
})

test('scan failure shows an amber line and does not throw', async ($, on) => {
  const w = wire(on, 'fail')
  await startUp($, w)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const line = await ui.find({ type: 'Text', text: /scan failed/ })
  expect(line?.text).toContain('boom')
  expect(line?.props?.color).toBe('yellow')
  await ui.unmount()
  const r = await review($, '')
  expect(JSON.stringify(r)).toContain('scan failed')
})

test('the clock rescans every interval_min', async ($, on) => {
  const w = wire(on, ONE)
  await startUp($, w)
  const n = w.calls.filter(c => c[2] === 'scan').length
  await w.clock.advance(10 * 60 * 1000)
  expect(w.calls.filter(c => c[2] === 'scan').length).toBe(n + 1)
})

test('/review-commits lists groups by repo with branch, files, +/- and withheld', async ($, on) => {
  const w = wire(on, scanOf([repo([group({ withheld: [{ path: 'health-band/.env', reason: 'secret-name' }] })])]))
  await startUp($, w)
  const txt = JSON.stringify(await review($, ''))
  expect(txt).toContain('mods-src [master]')
  expect(txt).toMatch(/health-band\s+3 files\s+\+40\/-2\s+withheld 1/)
  expect(w.asked).toEqual([])
  expect(commits(w).length).toBe(0)
})

test('/review-commits stat shows files and counts, no commit', async ($, on) => {
  const w = wire(on, ONE)
  await startUp($, w)
  const txt = JSON.stringify(await review($, 'stat mods-src:health-band'))
  expect(txt).toContain('health-band/a.py')
  expect(txt).toContain('+4/-1')
  expect(w.calls.some(c => c[2] === 'stat')).toBe(true)
  expect(commits(w).length).toBe(0)
})

test('no answer to the ask: nothing is committed', async ($, on) => {
  const w = wire(on, ONE, [''])
  await startUp($, w)
  const txt = JSON.stringify(await review($, 'commit'))
  expect(w.asked.length).toBe(1)
  expect(commits(w).length).toBe(0)
  expect(txt).toContain('skipped')
})

test('Skip answer: nothing is committed', async ($, on) => {
  const w = wire(on, ONE, ['Skip'])
  await startUp($, w)
  await review($, 'commit mods-src:health-band')
  expect(commits(w).length).toBe(0)
})

test('an answer that is not exactly Commit does not commit', async ($, on) => {
  const w = wire(on, ONE, ['commit it please'])
  await startUp($, w)
  await review($, 'commit')
  expect(commits(w).length).toBe(0)
})

test('dismissed ask is a skip', async ($, on) => {
  const w = wire(on, ONE, ['<dismiss>'])
  await startUp($, w)
  const txt = JSON.stringify(await review($, 'commit'))
  expect(commits(w).length).toBe(0)
  expect(txt).toContain('skipped')
})

test('Commit answer runs the script exactly once, with the hash the user was shown', async ($, on) => {
  const w = wire(on, ONE, ['Commit'])
  await startUp($, w)
  const txt = JSON.stringify(await review($, 'commit mods-src:health-band'))
  expect(w.asked.length).toBe(1)
  expect(w.asked[0]).toContain('mods-src:health-band')
  expect(w.asked[0]).toContain('3 files +40/-2 as Test Person?')
  expect(commits(w).length).toBe(1)
  expect(commits(w)[0]!.slice(2)).toEqual(['commit', '/r/mods-src', 'health-band', '--expect-hash', 'h1'])
  expect(txt).toContain('committed abc1234')
})

test('the question lists withheld files', async ($, on) => {
  const w = wire(on, scanOf([repo([group({ allowed_count: 2, withheld: [{ path: 'health-band/.env', reason: 'secret-name' }] })])]), ['Skip'])
  await startUp($, w)
  await review($, 'commit')
  expect(w.asked[0]).toContain('Withheld: health-band/.env')
})

test('Edit message asks again and passes the custom text', async ($, on) => {
  const w = wire(on, ONE, ['Edit message', 'add the band tests'])
  await startUp($, w)
  await review($, 'commit')
  expect(w.asked.length).toBe(2)
  expect(commits(w).length).toBe(1)
  expect(commits(w)[0]!.slice(2)).toEqual(['commit', '/r/mods-src', 'health-band', '-m', 'add the band tests', '--expect-hash', 'h1'])
})

test('Edit message then the default label commits with the default message', async ($, on) => {
  const w = wire(on, ONE, ['Edit message', 'Use the default'])
  await startUp($, w)
  await review($, 'commit')
  expect(commits(w)[0]!.slice(2)).toEqual(['commit', '/r/mods-src', 'health-band', '--expect-hash', 'h1'])
})

for (const second of ['Skip', '<dismiss>']) {
  test(`Edit message then ${second} commits nothing`, async ($, on) => {
    const w = wire(on, ONE, ['Edit message', second])
    await startUp($, w)
    await review($, 'commit')
    expect(w.asked.length).toBe(2)
    expect(commits(w).length).toBe(0)
  })
}

test('commit with no id asks once per group, in order, and commits only the confirmed one', async ($, on) => {
  const w = wire(on, TWO, ['Skip', 'Commit'])
  await startUp($, w)
  await review($, 'commit')
  expect(w.asked.length).toBe(2)
  expect(w.asked[0]).toContain('health-band')
  expect(w.asked[1]).toContain('kill-ledger')
  expect(commits(w).map(c => c[4])).toEqual(['kill-ledger'])
})

test('a group with no real identity or only withheld files is never asked', async ($, on) => {
  const w = wire(on, scanOf([repo([group()], { identity: null }), repo([group({ id: 'b:x', group: 'x', allowed_count: 0, file_count: 1, withheld: [{ path: '.env', reason: 'secret-name' }] })], { repo: '/r/b', name: 'b' })]), ['Commit', 'Commit'])
  await startUp($, w)
  const txt = JSON.stringify(await review($, 'commit'))
  expect(w.asked.length).toBe(0)
  expect(commits(w).length).toBe(0)
  expect(txt).toContain('no real git identity')
  expect(txt).toContain('every file is withheld')
})

test('a refused commit is reported, not thrown', async ($, on) => {
  const w = wire(on, ONE, ['Commit'], { ok: false, error: 'files changed since the stat you saw' })
  await startUp($, w)
  const txt = JSON.stringify(await review($, 'commit'))
  expect(txt).toContain('NOT committed: files changed since')
})

test('/review-commits is registered once', async ($, on) => {
  const w = wire(on, ONE)
  await startUp($, w)
  expect(w.names).toEqual(['review-commits'])
})
