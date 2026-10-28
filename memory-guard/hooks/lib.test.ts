import { expect, test } from 'claude-code/testing'
import { alertText, classify, cleanCandidates, meterText, DEFAULT_CFG as cfg, groupUsage, levelOf, memReport, mergeCfg, parsePs, parseSysctl, parseTop, shouldAlert, statusText } from './lib.js'

const SW = 'total = 39936.00M  used = 38606.88M  free = 1329.12M  (encrypted)'

test('parseSysctl reads the real line, M and G units, all levels', () => {
  const s = parseSysctl(`2\n${SW}\n`)
  expect(s.pressure).toBe('warn')
  expect(s.swapTotalMB).toBe(39936)
  expect(s.swapUsedMB).toBe(38606.88)
  expect(parseSysctl('1\ntotal = 2.00G  used = 1.50G  free = 0.50G').swapUsedMB).toBe(1536)
  expect(parseSysctl(`4\n${SW}`).pressure).toBe('critical')
  expect(parseSysctl(`1\n${SW}`).pressure).toBe('normal')
  expect(parseSysctl('').pressure).toBe('unknown')
})

test('parseTop skips the header and handles K/M/G and +/- suffixes', () => {
  const t = 'Processes: 900 total\nLoad Avg: 1, 2, 3\n\nPID    PPID   MEM\n10     1      3194M\n11     10     512K\n12     1      1.2G+\n13     1      80M-\n'
  expect(parseTop(t)).toEqual([
    { pid: 10, ppid: 1, mb: 3194 }, { pid: 11, ppid: 10, mb: 0.5 }, { pid: 12, ppid: 1, mb: 1.2 * 1024 }, { pid: 13, ppid: 1, mb: 80 },
  ])
})

const CHAT = '/Users/x/Library/Application Support/Claude/claude-code/2.1.309/5af865b9901c/claude.app/Contents/MacOS/claude --foo'
const CHROME = '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/155/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)'
const ps = parsePs([
  ` 100 1 /Applications/Claude.app/Contents/MacOS/Claude`,
  ` 200 100 ${CHAT}`,
  ` 201 200 node /x/.npm/_npx/99/node_modules/.bin/xcodebuildmcp mcp`,
  ` 202 201 npm exec chrome-devtools-mcp@latest`,
  ` 203 200 npx -y @scope/some-server@1.2.3`,
  ` 204 200 /usr/bin/foo /opt/bar/baz.js`,
  ` 300 1 ${CHROME}`,
  ` 301 1 /opt/homebrew/bin/python3 -u /a/b/job.py`,
  ` 302 1 /usr/sbin/mdworker`,
].join('\n'))

test('classify: chat, mcp, app, python, other', () => {
  expect(classify(200, ps)).toEqual({ kind: 'chat', name: 'claude' })
  expect(classify(201, ps)).toEqual({ kind: 'mcp', name: 'xcodebuildmcp' })
  expect(classify(202, ps)).toEqual({ kind: 'mcp', name: 'chrome-devtools-mcp' })
  expect(classify(203, ps)).toEqual({ kind: 'mcp', name: '@scope/some-server' })
  expect(classify(204, ps)).toEqual({ kind: 'mcp', name: 'baz.js' })
  expect(classify(300, ps)).toEqual({ kind: 'app', name: 'Google Chrome' })
  expect(classify(100, ps)).toEqual({ kind: 'app', name: 'Claude' })
  expect(classify(301, ps)).toEqual({ kind: 'other', name: 'python: job.py' })
  expect(classify(302, ps)).toEqual({ kind: 'other', name: 'mdworker' })
})

test('groupUsage sums apps, chats and mcp children', () => {
  const top = [
    { pid: 300, ppid: 1, mb: 1000 }, { pid: 300 + 0, ppid: 1, mb: 500 },
    { pid: 200, ppid: 100, mb: 400 }, { pid: 201, ppid: 200, mb: 600 }, { pid: 202, ppid: 201, mb: 100 },
  ]
  const { groups, chats } = groupUsage(top, ps)
  expect(groups[0]).toEqual({ kind: 'app', name: 'Google Chrome', mb: 1500, n: 2 })
  expect(groups.find(g => g.name === 'All Claude chats')).toEqual({ kind: 'chat', name: 'All Claude chats', mb: 400, n: 1 })
  expect(groups.find(g => g.name === 'xcodebuildmcp')?.mb).toBe(600)
  expect(chats).toEqual([{ pid: 200, mb: 400, childMb: 700, children: ['chrome-devtools-mcp', 'xcodebuildmcp'] }])
  expect(memReport(groups, chats, null)).toContain('Google Chrome')
})

test('levelOf thresholds', () => {
  const s = (pressure: 'normal' | 'warn' | 'critical', used: number) => ({ pressure, swapTotalMB: 100, swapUsedMB: used })
  expect(levelOf(s('normal', 10), cfg)).toBe('ok')
  expect(levelOf(s('normal', 85), cfg)).toBe('warn')
  expect(levelOf(s('warn', 10), cfg)).toBe('warn')
  expect(levelOf(s('normal', 97), cfg)).toBe('critical')
  expect(levelOf(s('critical', 0), cfg)).toBe('critical')
})

test('shouldAlert: rise, cooldown, never on ok', () => {
  const now = 10_000_000
  expect(shouldAlert(null, 'warn', now, cfg)).toBe(true)
  expect(shouldAlert({ level: 'warn', at: now - 60_000 }, 'warn', now, cfg)).toBe(false)
  expect(shouldAlert({ level: 'warn', at: now - 31 * 60_000 }, 'warn', now, cfg)).toBe(true)
  expect(shouldAlert({ level: 'warn', at: now }, 'critical', now, cfg)).toBe(true)
  expect(shouldAlert({ level: 'critical', at: now - 99 * 60_000 }, 'ok', now, cfg)).toBe(false)
  expect(shouldAlert(null, 'ok', now, cfg)).toBe(false)
})

test('statusText, alertText, mergeCfg', () => {
  const sw = { swapTotalMB: 39936, swapUsedMB: 38606.88 }
  expect(statusText('warn', sw, { name: 'Google Chrome', mb: 52_000 })).toBe('mem warn · swap 38.6/39.9G · Google Chrome 52G')
  expect(statusText('ok', sw)).toBe('mem ok · swap 38.6/39.9G')
  expect(alertText('warn', [{ name: 'Google Chrome', mb: 52_000 }])).toContain('/mem')
  expect(alertText('critical', [])).toContain("can't hide it")
  expect(mergeCfg({ cooldownMin: 5, swapWarnPct: 'x' })).toEqual({ ...cfg, cooldownMin: 5 })
})

test('classify names the script for framework Python', () => {
  const ps = new Map([[7, { ppid: 1, command: '/Library/Frameworks/Python.framework/Versions/3.12/Resources/Python.app/Contents/MacOS/Python src/fetch_ticks.py' }]])
  expect(classify(7, ps)).toEqual({ kind: 'other', name: 'python: fetch_ticks.py' })
})

test('parseSysctl reads free percentage and total RAM; meterText formats', () => {
  const s = parseSysctl(`2\n${SW}\n17179869184\nThe system has 17179869184\nSystem-wide memory free percentage: 14%\n`)
  expect(s.freePct).toBe(14)
  expect(s.memTotalMB).toBe(16384)
  expect(meterText({ ...s, swapTotalMB: 37900, swapUsedMB: 37100 })).toBe('RAM 2.3G free (14%) · swap 37.1/37.9G')
  expect(meterText({ swapTotalMB: 100, swapUsedMB: 50 })).toContain('RAM ?')
})

test('cleanCandidates: apps only, exclusions, cap 4, sorted', () => {
  const home = '/Users/x'
  const rows = [
    [1, 52000, ' /Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    [2, 3000, ' /Applications/Slack.app/Contents/MacOS/Slack'],
    [3, 5000, ' /Applications/Claude.app/Contents/MacOS/Claude'],
    [4, 4000, ` ${CHAT}`],
    [5, 3500, ' npx -y @scope/some-server'],
    [6, 2500, ' /Applications/TradingView.app/Contents/MacOS/TradingView'],
    [7, 2400, ' /Applications/Foo.app/Contents/MacOS/Foo --data /Users/x/Trading/db'],
    [8, 2300, ' /Library/Frameworks/Python.framework/Versions/3.12/Resources/Python.app/Contents/MacOS/Python x.py'],
    [9, 2200, ' /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal'],
    [10, 2100, ' /Applications/iTerm2.app/Contents/MacOS/iTerm2'],
    [11, 100, ' /Applications/A.app/Contents/MacOS/A'],
    [12, 200, ' /Applications/B.app/Contents/MacOS/B'],
    [13, 300, ' /Applications/C.app/Contents/MacOS/C'],
    [14, 400, ' /Applications/D.app/Contents/MacOS/D'],
  ] as const
  const map = parsePs(rows.map(r => `${r[0]} ${r[0] === 5 ? 4 : 1} ${r[2].trim()}`).join('\n'))
  const { cands } = cleanCandidates(rows.map(r => ({ pid: r[0], ppid: 1, mb: r[1] })), map, home)
  expect(cands.map(c => c.name)).toEqual(['Google Chrome', 'Slack', 'D', 'C'])
  expect(cands[0]?.label).toBe('Google Chrome 52.0G (tabs restore on reopen)')
  expect(cands[1]?.label).toBe('Slack 3.0G')
})
