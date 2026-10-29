import { atom, read, update } from 'claude-code'
import type { ElementConstructor, EngineInterface, Register, SvgProps } from 'claude-code'

import type { Agent, Health } from '../types'
import {
  COLOR, DEFAULTS, ago, barSvg, bandItems, counts, dotSvg, eventId, eventText, headline, kindOf, latestEvents, mergePing,
  parseConfig, parseHealth, recentEvents, safeUrl, signature, terminalArgv, worksText, type Config,
} from './lib'

const PANE = 'agent-status'
const TITLE = 'Coding agents'
const TWEEN_MS = 70

const healthA = atom({ plugin: 'agent-status', key: 'health' } as const, null, { shape: 'health-1' })
const errorA = atom({ plugin: 'agent-status', key: 'error' } as const, '')
const pingingA = atom({ plugin: 'agent-status', key: 'pinging' } as const, [], { shape: 'pinging-1' })
const dismissedA = atom({ plugin: 'agent-status', key: 'dismissed' } as const, '')
const shownA = atom({ plugin: 'agent-status', key: 'shown' } as const, null)
const checkingA = atom({ plugin: 'agent-status', key: 'checking' } as const, false)

let timerStarted = false
let inFlight = false
let stopTween: (() => void) | null = null

async function config($: EngineInterface): Promise<Config> {
  try {
    return parseConfig(String(await $.fs.read(`${$.plugin.root}/config.json`)))
  } catch {
    return DEFAULTS
  }
}

const lastLine = (s: string): string => s.trim().split('\n').pop() ?? ''

// Toast once per works -> down change and once per new context event; both tracked in the store.
async function notify($: EngineInterface, hs: Health, cfg: Config): Promise<void> {
  try {
    const prev = (await $.store.get('works')) as Record<string, boolean | null> | undefined
    const map: Record<string, boolean | null> = {}
    for (const a of hs.agents) {
      map[a.id] = a.works
      if (prev && prev[a.id] === true && a.works === false) $.ui.toast(`${a.name} stopped working${a.reason ? `: ${a.reason}` : ''}`, { timeoutMs: 9000 })
    }
    await $.store.set('works', map)
    const seen = new Set((((await $.store.get('seen')) as string[] | undefined) ?? []).map(String))
    const now = await $.clock.now()
    for (const ev of recentEvents(hs, now, cfg.eventMinutes)) {
      const id = eventId(ev)
      if (seen.has(id)) continue
      seen.add(id)
      $.ui.toast(eventText(ev), { timeoutMs: 10000 })
    }
    await $.store.set('seen', [...seen].slice(-200))
  } catch {
    // notices are best effort
  }
}

// The header count glides to its new value, one step per tick.
async function tween($: EngineInterface, from: number, to: number): Promise<void> {
  stopTween?.()
  const n = Math.abs(to - from)
  if (n === 0) return
  let step = 0
  let done = false
  await update($, shownA, () => from)
  const timer = $.clock.every(TWEEN_MS, () => {
    if (done) return
    step++
    done = step >= n
    void update($, shownA, () => (done ? null : from + Math.sign(to - from) * step))
    if (done) timer.cancel()
  })
  stopTween = () => {
    done = true
    timer.cancel()
  }
}

// One check. Without `ping`, the whole fleet from the cached script; with it, a live check of one agent.
export async function check($: EngineInterface, ping?: string): Promise<void> {
  if (!ping) {
    if (inFlight) return
    inFlight = true
    await update($, checkingA, () => true)
  } else {
    await update($, pingingA, s => [...s.filter(x => x !== ping), ping])
  }
  try {
    const cfg = await config($)
    const argv = ['python3', cfg.script || `${$.plugin.root}/scripts/agent_health.py`, '--json', ...(ping ? ['--ping', ping] : [])]
    const run = await $.process.run(argv, { timeoutMs: ping ? 90_000 : 120_000 })
    if (run.exitCode !== 0) throw new Error(lastLine(run.stderr) || `exit ${run.exitCode}`)
    const parsed = parseHealth(run.stdout)
    if (!parsed) throw new Error('script printed no agent list')
    const cur = await read($, healthA)
    const next = ping ? mergePing(cur, parsed, ping) : parsed
    const before = cur ? counts(cur).working : null
    await update($, healthA, () => next)
    await update($, errorA, () => '')
    await notify($, next, cfg)
    const after = counts(next).working
    if (before !== null && before !== after) void tween($, before, after)
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 160)
    await update($, errorA, () => `health check failed: ${msg}`)
  } finally {
    if (ping) await update($, pingingA, s => s.filter(x => x !== ping))
    else {
      inFlight = false
      await update($, checkingA, () => false)
    }
  }
}

async function startTimer($: EngineInterface): Promise<void> {
  if (timerStarted) return
  timerStarted = true
  const cfg = await config($)
  await $.clock.every(cfg.intervalMinutes * 60_000, () => void check($))
  void check($)
}

// Run the fix the script offered: a command in Terminal, or a URL in the browser.
export async function runFix($: EngineInterface, a: Agent): Promise<void> {
  const fix = a.user_fix
  if (!fix) return
  try {
    if (fix.command) await $.process.run(terminalArgv(fix.command), { timeoutMs: 15_000 })
    else if (fix.url && safeUrl(fix.url)) await $.process.run(['open', fix.url], { timeoutMs: 15_000 })
  } catch (err) {
    $.ui.toast(`${a.name}: could not run the fix (${String(err).slice(0, 80)})`)
  }
}

async function openPane($: EngineInterface): Promise<{ text: string }> {
  await $.ui.open({ id: PANE, title: TITLE })
  void startTimer($)
  void check($)
  const hs = await read($, healthA)
  if (!hs) return { text: 'Coding agents: checking…' }
  const c = counts(hs)
  return { text: `Coding agents: ${headline(c.working, c.total)}.` }
}

export const register: Register = (on, _options) => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'agent-status', description: 'Open the coding-agents pane: does each external agent work, which model, why not, fixes.' })
    await $.command.register({ name: 'coders', description: 'Alias of /agent-status.' })
    void startTimer($)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'agent-status' }, $ => openPane($))
  on('command.run', { command: 'coders' }, $ => openPane($))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const hs = await read($, healthA)
    const err = await read($, errorA)
    const pinging = await read($, pingingA)
    const checking = await read($, checkingA)
    const shown = await read($, shownA)
    const now = await $.clock.now()
    const SvgEl = (ui as { Svg?: ElementConstructor<SvgProps> }).Svg
    const isSvg = e.surface !== 'terminal' && !!SvgEl
    const cols = e.props.bodyColumns ?? 40

    const errLine = err ? <Text dimColor wrap="truncate-end">{err}</Text> : null
    if (!hs) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Coding agents</Text>
          <Text dimColor>{checking ? '⟳ checking the agents…' : 'No data yet.'}</Text>
          {errLine}
        </Box>
      )
    }

    const c = counts(hs)
    const count = shown ?? c.working
    const worst = hs.agents.some(a => kindOf(a) === 'down') ? 'down' : c.working === c.total ? 'ok' : 'idle'
    const bar = isSvg && SvgEl ? (() => { const g = barSvg(hs.agents, cols * 7.4); return <SvgEl source={g.svg} alt={headline(c.working, c.total)} width={g.w} height={g.h} /> })() : (
      <Text>{hs.agents.map((a, i) => <Text key={`b${i}`} color={COLOR[kindOf(a)]}>▰</Text>)}</Text>
    )

    const row = (a: Agent) => {
      const k = kindOf(a)
      const busy = pinging.includes(a.id)
      const when = a.last_run ? `last run ${ago(a.last_run.at, now)}` : `checked ${ago(hs.checked_at, now)}`
      const dot = isSvg && SvgEl ? <SvgEl source={dotSvg(k)} alt={worksText(a)} width={18} height={18} /> : <Text color={COLOR[k]}>●</Text>
      return (
        <Box key={`r-${a.id}`} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            {dot}
            <Text bold>{a.name}</Text>
            {a.model_label ? <Text color="#8B5CF6">[{a.model_label}]</Text> : null}
          </Box>
          <Box flexDirection="row" gap={1}>
            <Text dimColor>Works:</Text>
            <Text bold color={COLOR[k]}>{worksText(a)}</Text>
            {a.reason ? <Text wrap="truncate-end">· {a.reason}</Text> : null}
          </Box>
          <Text dimColor wrap="truncate-end">{when}{a.last_run?.verdict ? ` · ${a.last_run.verdict}` : ''}</Text>
          {a.fallback.length ? <Text dimColor wrap="truncate-end">then: {a.fallback.join(' → ')}</Text> : null}
          <Box flexDirection="row" gap={1}>
            {busy ? <Text color="#A78BFA">⟳ checking…</Text> : <Button key={`re-${a.id}`} label="Recheck" onPress={() => check($, a.id)} />}
            {a.user_fix ? <Button key={`fix-${a.id}`} label={a.user_fix.label} onPress={() => runFix($, a)} /> : null}
          </Box>
        </Box>
      )
    }

    const evs = latestEvents(hs, 6)
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold color={COLOR[worst]}>{headline(count, c.total)}</Text>
          {bar}
        </Box>
        {hs.agents.map(row)}
        <Box flexDirection="column">
          <Text bold>Model switches</Text>
          {evs.length === 0 ? <Text dimColor>None yet.</Text> : null}
          {evs.map(ev => (
            <Box key={`e-${eventId(ev)}`} flexDirection="row" gap={1}>
              <Text color="#F59E0B">↪</Text>
              <Text wrap="truncate-end">{eventText(ev)}</Text>
              <Text dimColor>{ago(ev.at, now)}</Text>
            </Box>
          ))}
        </Box>
        {errLine}
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{checking ? '⟳ checking…' : `checked ${ago(hs.checked_at, now)} · auto-check every 5 min`}</Text>
          <Button key="check-now" label="Check now" onPress={() => check($)} />
        </Box>
      </Box>
    )
  })

  // The band: only when something needs the person; dismissible, and it comes back for anything new.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (e.props.hasSurvey) return next(e)
      const hs = await read($, healthA)
      const now = await $.clock.now()
      const cfg = await config($)
      const items = bandItems(hs, now, cfg.eventMinutes)
      if (!hs || items.length === 0 || (await read($, dismissedA)) === signature(items)) return next(e)
      const drawn = await Promise.resolve(next(e)).catch(() => null)
      const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null
      const { Box, Text, Button } = $.ui.resolve(e)
      const agentOf = (id: string) => hs.agents.find(a => a.id === id)
      const mine = (
        <Box flexDirection="column">
          {items.slice(0, 3).map(it => (
            <Box key={`band-${it.key}`} flexDirection="row" gap={1}>
              <Text color={it.fix ? COLOR.down : '#F59E0B'}>{it.fix ? '●' : '↪'}</Text>
              <Text wrap="truncate-end">{it.text}</Text>
              {it.fix && agentOf(it.fix.agentId) ? <Button key={`bf-${it.fix.agentId}`} label={it.fix.label} onPress={() => runFix($, agentOf(it.fix!.agentId)!)} /> : null}
            </Box>
          ))}
          {items.length > 3 ? <Text dimColor>+{items.length - 3} more · /agent-status</Text> : null}
          <Button key="dismiss" label="Dismiss" onPress={() => update($, dismissedA, () => signature(items))} />
        </Box>
      )
      return below ? <Box flexDirection="column">{mine}{below as never}</Box> : mine
    } catch {
      return next(e)
    }
  })
}
