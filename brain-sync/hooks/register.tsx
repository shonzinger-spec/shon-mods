import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, Register, SvgProps } from 'claude-code'

import type { Alert, Item, SyncStatus, Usage } from '../types'
import { FILL, ago, barsSvg, due, headline, healText, heroSvg, idleText, pct, pill, saved, tone, usageTone } from './lib'

const PANE = 'brain-sync'
const TITLE = 'Second brain'
const EVERY_MS = 30 * 1000
const ALERTS_EVERY = 10 // ticks: job alerts every 5 min
const HEALTH = './health-band/scripts/health_check.py'
const status = atom({ plugin: 'brain-sync', key: 'status' } as const, null, { shape: 'status-1' })
const error = atom({ plugin: 'brain-sync', key: 'error' } as const, '')
const checking = atom({ plugin: 'brain-sync', key: 'checking' } as const, false)
const usage = atom({ plugin: 'brain-sync', key: 'usage' } as const, null, { shape: 'usage-1' })
const alerts = atom({ plugin: 'brain-sync', key: 'alerts' } as const, [], { shape: 'alerts-1' })
let ticks = 0

// Context and the 5h / 7d windows, the numbers the band above the prompt shows.
async function refreshUsage($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage()
    const c = u.context
    const context = Math.round(c.percent ?? (c.tokens && c.window ? (c.tokens / c.window) * 100 : 0))
    const windows = u.rateLimits.map(r => ({ kind: r.kind, percent: Math.round(r.percentUsed), resetsAt: r.resetsAt }))
    await update($, usage, () => ({ context, windows }))
  } catch {
    /* usage not reported on this surface */
  }
}

// Job and data alerts from the health-band mod's own checker (read only).
async function refreshAlerts($: EngineInterface): Promise<void> {
  try {
    const run = await $.process.run(['python3', HEALTH], { timeoutMs: 60000 })
    if (run.exitCode !== 0) return
    const j = JSON.parse(run.stdout) as { issues?: Alert[] }
    await update($, alerts, () => (j.issues ?? []).map(i => ({ level: i.level, text: i.text })))
  } catch {
    /* health-band not installed */
  }
}

let isTicking = false
let lastBad: number | null = null
let lastAction = ''

// One check: the Python collector reads the archive and, with --heal, reruns the save jobs.
export async function refresh($: EngineInterface, force = false): Promise<SyncStatus | null> {
  await update($, checking, () => true)
  try {
    const argv = ['python3', `${$.plugin.root}/scripts/sync_status.py`, '--json', force ? '--force' : '--heal']
    const run = await $.process.run(argv, { timeoutMs: 120000 })
    if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n').pop() || `exit ${run.exitCode}`)
    const s = JSON.parse(run.stdout) as SyncStatus
    await update($, status, () => s)
    await update($, error, () => '')
    await popOut($, s)
    return s
  } catch (err) {
    await update($, error, () => `check failed: ${String(err).slice(0, 200)}`)
    return null
  } finally {
    await update($, checking, () => false)
  }
}

// A chat that stops saving pops the pane open and says so; so does giving up.
async function popOut($: EngineInterface, s: SyncStatus): Promise<void> {
  const bad = s.totals.failed + s.totals.stuck
  const struggling = s.heal?.struggling ? 'struggling' : ''
  if (lastBad !== null && bad > lastBad) {
    void $.ui.open({ id: PANE, title: TITLE })
    $.ui.toast(`Second brain: ${bad} chat${bad === 1 ? '' : 's'} not saved. Rerunning the save.`, { timeoutMs: 8000 })
  } else if (struggling && lastAction !== struggling) {
    void $.ui.open({ id: PANE, title: TITLE })
    $.ui.toast(`Second brain: ${bad} chats still not saved after ${s.heal?.cap} reruns. Still retrying every hour.`, { timeoutMs: 10000 })
  } else if (lastBad !== null && lastBad > 0 && bad === 0) {
    $.ui.toast('Second brain: every finished chat is saved.')
  }
  lastBad = bad
  lastAction = struggling
}

async function start($: EngineInterface): Promise<void> {
  if (isTicking) return
  isTicking = true
  await $.clock.every(EVERY_MS, () => {
    void refresh($)
    void refreshUsage($)
    if (++ticks % ALERTS_EVERY === 0) void refreshAlerts($)
  })
  void refresh($)
  void refreshUsage($)
  void refreshAlerts($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'brain', description: 'Open the second-brain pane: is every chat saved (backup, note, Melxis)? Reruns failed saves.' })
    void $.ui.open({ id: PANE, title: TITLE })
    void start($)
    return r
  }).catch(($, e, next) => next(e))

  // A turn moves context and the usage windows: redraw them right away.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    void refreshUsage($)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'brain' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    void start($)
    const s = (await refresh($)) ?? (await read($, status))
    return { text: s ? `Second brain: ${headline(s)}.` : 'Second brain pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const s = await read($, status)
    const err = await read($, error)
    const busy = await read($, checking)
    const u = await read($, usage)
    const al = await read($, alerts)
    const cols = e.props.bodyColumns ?? 40
    const isSvg = e.surface !== 'terminal' && 'Svg' in ui
    const SvgEl = (ui as { Svg?: ElementConstructor<SvgProps> }).Svg
    const winLabel = (k: string) => (k === 'five_hour' ? '5h' : k === 'seven_day' ? '7d' : k.replace(/_/g, ' '))
    const urows = u
      ? [{ id: 'cx', label: 'Context', p: u.context }, ...u.windows.map(w => ({ id: `w${w.kind}`, label: winLabel(w.kind), p: w.percent }))]
      : []
    const session = urows.length ? (
      <Box flexDirection="column">
        <Text bold>Session</Text>
        {isSvg && SvgEl ? (
          (() => {
            const g = barsSvg(urows.map(r => ({ id: r.id, label: r.label, n: r.p, d: 100, tone: usageTone(r.p), tag: `${r.p}%` })), cols * 7.4)
            return <SvgEl source={g.svg} alt={urows.map(r => `${r.label} ${r.p}%`).join(', ')} width={g.w} height={g.h} />
          })()
        ) : (
          urows.map(r => (
            <Box key={r.id} flexDirection="row">
              <Text dimColor>{r.label.padEnd(10)}</Text>
              {pill(r.p, Math.max(10, Math.min(40, cols - 14)), FILL[usageTone(r.p)], `${r.p}%`).map((g, i) => (
                <Text key={`${r.id}${i}`} color={g.color} backgroundColor={g.backgroundColor} bold={g.bold}>{g.text}</Text>
              ))}
            </Box>
          ))
        )}
      </Box>
    ) : null
    const alertBox = al.length ? (
      <Box flexDirection="column">
        <Text bold>Alerts</Text>
        {al.slice(0, 4).map((a, i) => (
          <Text key={`a${i}`} color={a.level === 'red' ? FILL.critical : FILL.warn} wrap="truncate-end">● {a.text}</Text>
        ))}
        {al.length > 4 ? <Text dimColor>+{al.length - 4} more · /healthband for all</Text> : null}
      </Box>
    ) : null
    // No buttons: the check runs by itself every 30 s and reruns failed saves on its own.
    const auto = <Text dimColor>{busy ? '⟳ checking…' : '⟳ auto-check every 30 s · reruns failed saves by itself'}</Text>
    if (!s) {
      return (
        <Box flexDirection="column" gap={1}>
          {session}
          {alertBox}
          <Text dimColor>{err || 'Checking every chat in the second brain…'}</Text>
          {auto}
        </Box>
      )
    }
    const t = tone(s)
    const color = FILL[t]
    const d = due(s)
    let bars
    if (isSvg && SvgEl) {
      const hero = heroSvg(s, cols * 7.4)
      bars = <SvgEl source={hero.svg} alt={hero.alt} width={hero.w} height={hero.h} />
    } else {
      const w = Math.max(10, Math.min(40, cols - 14))
      const row = (label: string, n: number, of: number, fill: string, tag: string) => (
        <Box key={label} flexDirection="row">
          <Text dimColor>{label.padEnd(10)}</Text>
          {pill(pct(n, of), w, fill, tag).map((g, i) => (
            <Text key={`${label}${i}`} color={g.color} backgroundColor={g.backgroundColor} bold={g.bold}>{g.text}</Text>
          ))}
        </Box>
      )
      const st = s.stages
      const sf = (n: number) => FILL[n >= st.eligible ? 'ok' : t === 'critical' ? 'critical' : 'warn']
      bars = (
        <Box flexDirection="column">
          {row('Saved', saved(s), d, color, `${saved(s)}/${d}`)}
          {row('Backed up', st.backup, st.eligible, sf(st.backup), `${st.backup}`)}
          {row('Notes', st.note, st.eligible, sf(st.note), `${st.note}`)}
          {row('Melxis', st.melxis, st.eligible, sf(st.melxis), `${st.melxis}`)}
        </Box>
      )
    }
    const room = Math.max(3, (e.viewport?.rows ?? 30) - 16)
    const probRow = (i: Item) => (
      <Box key={`p${i.sid8}`} flexDirection="row" gap={1}>
        <Text color={i.status === 'stuck' ? FILL.critical : FILL.warn}>✕</Text>
        <Text dimColor tabular>{i.date.slice(5)}</Text>
        <Text wrap="truncate-end">{i.title}</Text>
        <Text dimColor wrap="truncate-end">· {i.reason}</Text>
      </Box>
    )
    const liveRow = (i: Item) => (
      <Box key={`l${i.sid8}`} flexDirection="row" gap={1}>
        <Text color="#60A5FA">◐</Text>
        <Text dimColor wrap="truncate-end">{i.title}</Text>
        <Text dimColor>idle {idleText(i.idle_min)}</Text>
      </Box>
    )
    const bad = s.totals.failed + s.totals.stuck
    const nowMs = Date.now()
    const healLine = healText(s.heal, s.totals.failed, nowMs / 1000)
    const runningJob = s.jobs.archive.running ? 'archive' : s.jobs.melxis.running ? 'melxis' : null
    const logLine = bad > 0 ? (s.jobs[s.heal?.job ?? 'archive']?.log.at(-1) ?? '') : ''
    return (
      <Box flexDirection="column" gap={1}>
        {session}
        {alertBox}
        <Text bold>Second brain</Text>
        <Text>
          <Text bold>{s.totals.total} chats</Text>
          <Text color={FILL.ok}>  ✓ {s.totals.saved} backed up</Text>
          <Text color={s.totals.total - s.totals.saved ? FILL.warn : undefined} dimColor={!(s.totals.total - s.totals.saved)}>  ○ {s.totals.total - s.totals.saved} not yet</Text>
        </Text>
        <Text bold color={color}>{t === 'ok' ? '●' : '▲'} {headline(s)}</Text>
        {bars}
        <Box flexDirection="row" gap={2}>
          <Text color={FILL.ok}>✓ {s.totals.saved} saved</Text>
          <Text color="#60A5FA">◐ {s.totals.live} live</Text>
          <Text color={bad ? FILL.warn : undefined} dimColor={!bad}>✕ {bad} not saved</Text>
        </Box>
        {healLine ? <Text color={runningJob ? '#A78BFA' : t === 'critical' ? FILL.critical : undefined} dimColor={!runningJob && t === 'ok'}>{runningJob ? '⟳ ' : ''}{healLine}</Text> : null}
        {bad > 0 ? (
          <Box flexDirection="column">
            <Text bold>Not saved yet</Text>
            {s.problems.slice(0, room).map(probRow)}
            {s.problems.length > room ? <Text dimColor>+{s.problems.length - room} more</Text> : null}
            {logLine ? <Text dimColor wrap="truncate-end">log: {logLine}</Text> : null}
          </Box>
        ) : null}
        {s.live.length ? (
          <Box flexDirection="column">
            <Text dimColor>In use (saved after 6h idle or when archived)</Text>
            {s.live.slice(0, Math.max(2, room - Math.min(bad, room))).map(liveRow)}
          </Box>
        ) : null}
        {err ? <Text color={FILL.critical}>{err}</Text> : null}
        <Box flexDirection="column">
          <Text dimColor>checked {ago(s.generated_at, nowMs)}</Text>
          {auto}
        </Box>
      </Box>
    )
  })
}
