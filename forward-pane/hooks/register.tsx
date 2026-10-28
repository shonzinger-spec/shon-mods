import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FwdStatus } from '../types'
import { ago, countText, sorted, summary, tone } from './lib'

const PANE = 'forward-pane'
const status = atom({ plugin: 'forward-pane', key: 'status' } as const, null)
const error = atom({ plugin: 'forward-pane', key: 'error' } as const, '')
const DOT = { red: '●', yellow: '●', green: '●' } as const

async function refresh($: EngineInterface): Promise<void> {
  try {
    const run = await $.process.run(['python3', `${$.plugin.root}/scripts/forward_status.py`], { timeoutMs: 30000 })
    if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n').pop() || `exit ${run.exitCode}`)
    const s = JSON.parse(run.stdout) as FwdStatus
    await update($, status, () => s)
    await update($, error, () => '')
  } catch (err) {
    await update($, error, () => `collector failed: ${String(err).slice(0, 160)}`)
  }
}

let isTicking = false

async function open($: EngineInterface): Promise<void> {
  await refresh($)
  if (!isTicking) {
    isTicking = true
    await $.clock.every(5 * 60 * 1000, () => void refresh($))
  }
  await $.ui.open({ id: PANE, title: 'Forward tests' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'forward', description: 'Open the forward-test pane: live launchd jobs, last run, errors, trades vs target' })
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'forward' }, async $ => {
    await open($)
    const s = await read($, status)
    return { text: s ? `Forward tests: ${summary(s.jobs)}.` : 'Forward tests pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, status)
    const err = await read($, error)
    const head = (
      <Box>
        <Text dimColor>{s ? `${summary(s.jobs)} · ${s.generated_at.slice(11, 16)} ` : 'loading… '}</Text>
        <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
      </Box>
    )
    if (!s) {
      return (
        <Box flexDirection="column">
          {head}
          {err !== '' && <Text color="red">{err}</Text>}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {head}
        {err !== '' && <Text color="red">{err}</Text>}
        {sorted(s.jobs).map(j => {
          const t = tone(j)
          const exit = j.running ? `pid ${j.pid}` : `exit ${j.last_exit ?? '?'}`
          return (
            <Box flexDirection="column">
              <Text color={t} bold={t !== 'green'}>
                {DOT[t]} {j.name}
              </Text>
              <Text dimColor>
                {'   '}
                {j.schedule} · last {ago(j.age_min)} · {exit}
                {countText(j) ? ` · ${countText(j)}` : ''}
              </Text>
              {j.stale && <Text color="red">   STALE: {j.stale_reason}</Text>}
              {j.errors.map(x => (
                <Text color="yellow">   ! {x.slice(0, 140)}</Text>
              ))}
            </Box>
          )
        })}
      </Box>
    )
  })
}
