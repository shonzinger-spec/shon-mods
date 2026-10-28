import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HealthReport } from '../types'
import { jobsText, lseColor, lseText, overheadText } from './stats'

const report = atom({ plugin: 'health-band', key: 'report' } as const, null)
const isHidden = atom({ plugin: 'health-band', key: 'isHidden' } as const, false)
const EVERY_MS = 5 * 60 * 1000

let isTicking = false
let lastLevel = 'ok'

async function check($: EngineInterface): Promise<HealthReport | null> {
  try {
    const run = await $.process.run(['python3', `${$.plugin.root}/scripts/health_check.py`], { timeoutMs: 60000 })
    if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n').pop() || `exit ${run.exitCode}`)
    const r = JSON.parse(run.stdout) as HealthReport
    await update($, report, () => r)
    // a level that got worse shows again even if the band was hidden
    if (r.level === 'red' && lastLevel !== 'red') await update($, isHidden, () => false)
    lastLevel = r.level
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
    await update($, isHidden, () => false)
    if (!r) return { text: 'health-band: no report' }
    const lines = r.issues.map(i => `${i.level === 'red' ? '🔴' : '🟡'} ${i.text}`)
    return { text: [`health-band: ${r.level.toUpperCase()} (${r.checked_at})`, ...(lines.length ? lines : ['🟢 all checks pass'])].join('\n') }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, report)
    if (e.props.hasSurvey || !r) return next(e)
    const isShowingIssues = r.level !== 'ok' && !(await read($, isHidden))
    if (!isShowingIssues && !r.stats) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const color = r.level === 'red' ? 'red' : 'yellow'
    const shown = [...r.issues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1)).slice(0, 3)
    const s = r.stats
    // the gauges stay drawn while the issues are hidden, so the bands beneath still draw
    const below = await next(e)
    return (
      <Box flexDirection="column">
        {isShowingIssues &&
          shown.map(i => (
            <Text color={i.level === 'red' ? 'red' : 'yellow'}>
              {i.level === 'red' ? '🔴' : '🟡'} {i.text}
            </Text>
          ))}
        {isShowingIssues && (
          <Box>
            <Text color={color} dimColor>
              {r.issues.length > 3 ? `+${r.issues.length - 3} more · ` : ''}/healthband for all{' '}
            </Text>
            <Button key="recheck" label="Recheck" onPress={() => check($)} />
            <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
          </Box>
        )}
        {s && (
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
        )}
        {below}
      </Box>
    )
  })
}
