import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ArStatus } from '../types'
import { followUpLine, split, summary } from './lib'

const PANE = 'autorank-pane'
const status = atom({ plugin: 'autorank-pane', key: 'status' } as const, null)
const error = atom({ plugin: 'autorank-pane', key: 'error' } as const, '')

async function refresh($: EngineInterface): Promise<void> {
  try {
    const home = (await $.env.get('HOME')) ?? ''
    const run = await $.process.run(['node', `${$.plugin.root}/scripts/autorank_status.mjs`, '--repo', `${home}/AutoRank`], {
      timeoutMs: 30000,
      cwd: $.plugin.root,
    })
    if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n').slice(-2).join(' ') || `exit ${run.exitCode}`)
    const s = JSON.parse(run.stdout) as ArStatus
    await update($, status, () => s)
    await update($, error, () => '')
  } catch (err) {
    await update($, error, () => `collector failed: ${String(err).slice(0, 200)}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'autorank', description: 'Open the AutoRank pane: follow-ups due (last email date + subject), first touches queued, replies and leads from HANDOFF.md' })
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'autorank' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'AutoRank' })
    const s = await read($, status)
    return { text: s ? `AutoRank ${s.today}: ${summary(s)}.` : 'AutoRank pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, status)
    const err = await read($, error)
    const head = (
      <Box>
        <Text dimColor>{s ? `${s.today} · last send ${s.last_send_date ?? 'never'} ` : 'loading… '}</Text>
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
    const { due, lapsed } = split(s)
    const oldest = lapsed.reduce((m, f) => Math.max(m, f.days_since), 0)
    return (
      <Box flexDirection="column">
        {head}
        {err !== '' && <Text color="red">{err}</Text>}
        {s.gmail_status && <Text dimColor>Gmail {s.gmail_status.date}: {s.gmail_status.text}</Text>}
        <Text> </Text>
        <Text bold>Follow-ups due today ({due.length})</Text>
        {due.length === 0 && <Text dimColor>None due today.</Text>}
        {due.map(f => (
          <Text>{followUpLine(f)}</Text>
        ))}
        {lapsed.length > 0 && (
          <Text color="yellow">
            {lapsed.length} lapsed (gap over 10 days, oldest {oldest}d; send-pack flags these, restarting is a decision): {lapsed.slice(0, 4).map(f => f.name).join(', ')}
            {lapsed.length > 4 ? ' …' : ''}
          </Text>
        )}
        <Text> </Text>
        <Text bold>First touches queued ({s.first_touches.count})</Text>
        {s.first_touches.count === 0 && <Text dimColor>None queued.</Text>}
        {s.first_touches.count > 0 && (
          <Text dimColor>
            from {s.first_touches.source}: {s.first_touches.names.slice(0, 8).join(', ')}
            {s.first_touches.count > 8 ? ' …' : ''}
          </Text>
        )}
        <Text> </Text>
        <Text bold>Replies and live leads (HANDOFF.md)</Text>
        {s.leads.length === 0 && <Text dimColor>No “Leads and conversations” section found.</Text>}
        {s.leads.map(l => (
          <Text color="green">• {l}</Text>
        ))}
      </Box>
    )
  })
}
