import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HealthIssue, HealthReport } from '../types'
import { jobsText, lseColor, lseText, overheadText } from './stats'

const report = atom({ plugin: 'health-band', key: 'report' } as const, null)
const EVERY_MS = 5 * 60 * 1000

let isTicking = false
// Red issues the last good check saw, digits folded so "12 days behind" -> "13 days behind" is the same issue.
// null until the first good check, which only records: a restart never re-notifies what is already red.
let knownRed: Set<string> | null = null

const issueKey = (i: HealthIssue): string => `${i.check}|${i.text.replace(/\d+/g, '#')}`

async function notifyNewRed($: EngineInterface, r: HealthReport): Promise<void> {
  const red = r.issues.filter(i => i.level === 'red')
  const prev = knownRed
  knownRed = new Set(red.map(issueKey))
  if (!prev) return
  for (const i of red) {
    if (prev.has(issueKey(i))) continue
    // notify can reject (a hook's deny, a failed write); the band must not care
    try {
      await $.ui.notify(i.text, { title: 'health-band' })
    } catch {
      // nothing to do
    }
  }
}

async function check($: EngineInterface): Promise<HealthReport | null> {
  try {
    const run = await $.process.run(['python3', `${$.plugin.root}/scripts/health_check.py`], { timeoutMs: 60000 })
    if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n').pop() || `exit ${run.exitCode}`)
    const r = JSON.parse(run.stdout) as HealthReport
    await update($, report, () => r)
    await notifyNewRed($, r)
    return r
  } catch (err) {
    const r: HealthReport = {
      level: 'amber',
      issues: [{ level: 'amber', check: 'health-band', text: `health check failed: ${String(err).slice(0, 120)}` }],
      checked_at: '',
    }
    await update($, report, () => r)
    return r
  }
}

// The first check runs just after start (it takes ~3 s), never holding the session up.
async function start($: EngineInterface): Promise<void> {
  if (isTicking) return
  isTicking = true
  await $.clock.after(50, () => void check($))
  await $.clock.every(EVERY_MS, () => void check($))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'healthband', description: 'health-band: re-run the ops checks (API credit, LSE key, feed staleness, forward jobs) and list every issue' })
    await start($)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'healthband' }, async $ => {
    const r = await check($)
    if (!r) return { text: 'health-band: no report' }
    const lines = r.issues.map(i => `${i.level === 'red' ? '🔴' : '🟡'} ${i.text}`)
    return { text: [`health-band: ${r.level.toUpperCase()} (${r.checked_at})`, ...(lines.length ? lines : ['🟢 all checks pass'])].join('\n') }
  })

  // Issue rows live in the second-brain window (brain-sync); /healthband lists them. The band draws only the gauges.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, report)
    if (e.props.hasSurvey || !r || !r.stats) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const s = r.stats
    const below = await next(e)
    return (
      <Box flexDirection="column">
        <Box>
          <Text color={lseColor(s.lse)} dimColor={!lseColor(s.lse)}>
            {lseText(s.lse)}
          </Text>
          <Text dimColor>
            {' | '}
            {jobsText(s.jobs)}
          </Text>
          <Text dimColor>
            {' | '}
            {overheadText(s.overhead_tokens)}
          </Text>
        </Box>
        {below}
      </Box>
    )
  })
}
