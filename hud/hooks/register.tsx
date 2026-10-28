import { atom, read, update, type Hook, type Register } from 'claude-code'

import type { EffortNow, MemNow, Trend } from '../types'
import {
  arrow, bar, effortCells, effortColor, fillFrames, freeGB, isPlacement, MEM_COLOR, parseEffort, parseMem, PLACEMENTS, runAnim, SEP,
  sourceText, stale, stripText, swapColor, swapPct, tween, usedPct,
  type Placement,
} from './lib'

const effortA = atom({ plugin: 'hud', key: 'effort' } as const, null)
const memA = atom({ plugin: 'hud', key: 'mem' } as const, null)
const trendA = atom({ plugin: 'hud', key: 'trend' } as const, { prev: null, level: null, since: 0 })
const placementA = atom({ plugin: 'hud', key: 'placement' } as const, 'footer')
// Frames of the running animations: effort cells and RAM used %; null = draw the real value.
const animA = atom({ plugin: 'hud', key: 'anim' } as const, { cells: null, flash: false, pct: null })

const EFFORT_MS = 80
const FLASH_MS = 600
const MEM_MS = 60
const MEM_STEPS = 6
let stopEffort: (() => void) | null = null
let stopMem: (() => void) | null = null

const PANE = 'hud'
let started = false
let sessionId = ''

type Ctx = Parameters<Hook<'turn.complete'>>[0]

async function readText($: Ctx, path: string): Promise<string> {
  try {
    return String(await $.fs.read(path))
  } catch {
    return ''
  }
}

async function refresh($: Ctx): Promise<void> {
  try {
    const home = (await $.env.get('HOME')) ?? ''
    if (!sessionId) sessionId = String(await $.session.id())
    const now = await $.clock.now()
    const e = parseEffort(await readText($, `${home}/.claude/mods-src/effort-router/state/now-${sessionId}.json`))
    const m = parseMem(await readText($, `${home}/.claude/mods-src/memory-guard/state/now.json`))
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
    const oldE = await read($, effortA)
    const oldM = await read($, memA)
    if (!same(e, oldE)) await update($, effortA, () => e as EffortNow | null)
    if (!same(m, oldM)) await update($, memA, () => m as MemNow | null)
    if ((await savedMotion($)) === 'on') await animate($, oldE, e, oldM, m)
    const t = await read($, trendA)
    if (e && e.level !== t.level) await update($, trendA, () => ({ prev: t.level, level: e.level, since: now }) as Trend)
  } catch {
    // never throw out of a hook
  }
}

async function savedMotion($: Ctx): Promise<'on' | 'off'> {
  try {
    return (await $.store.get('motion')) === 'off' ? 'off' : 'on'
  } catch {
    return 'on'
  }
}

// Start the effort fill / RAM slide for whatever changed. Each uses one timer, stopped on its last frame.
async function animate($: Ctx, oldE: EffortNow | null, e: EffortNow | null, oldM: MemNow | null, m: MemNow | null): Promise<void> {
  const set = (p: Partial<{ cells: number | null; flash: boolean; pct: number | null }>) => void update($, animA, s => ({ ...s, ...p }))
  if (oldE && e && oldE.level !== e.level) {
    const cur = (await read($, animA)).cells
    const from = cur ?? effortCells(oldE.level).split('▰').length - 1
    const to = effortCells(e.level).split('▰').length - 1
    const frames = fillFrames(from, to)
    while (frames.length && frames.length < FLASH_MS / EFFORT_MS + 1) frames.push(to)
    stopEffort?.()
    set({ cells: from, flash: true })
    stopEffort = runAnim(
      (ms, fn) => $.clock.every(ms, fn), EFFORT_MS, frames,
      (v, i) => set({ cells: v, flash: (i + 1) * EFFORT_MS < FLASH_MS }),
      () => set({ cells: null, flash: false }),
    )
  }
  const a = oldM && m ? usedPct(oldM) : undefined
  const b = m ? usedPct(m) : undefined
  if (a !== undefined && b !== undefined && Math.abs(b - a) >= 1) {
    const from = (await read($, animA)).pct ?? a
    stopMem?.()
    set({ pct: from })
    stopMem = runAnim((ms, fn) => $.clock.every(ms, fn), MEM_MS, tween(from, b, MEM_STEPS), v => set({ pct: v }), () => set({ pct: null }))
  }
}

async function savedPlacement($: Ctx): Promise<Placement> {
  try {
    const v = await $.store.get('placement')
    return isPlacement(v) ? v : 'footer'
  } catch {
    return 'footer'
  }
}

async function apply($: Ctx, p: Placement, old?: Placement): Promise<void> {
  await update($, placementA, () => p)
  if (old === 'pane' && p !== 'pane') await Promise.resolve($.ui.close({ id: PANE })).catch(() => undefined)
  if (p === 'pane') await Promise.resolve($.ui.open({ id: PANE, title: 'HUD' })).catch(() => undefined)
}

// What the strip needs at draw time: values, or null when there is nothing to show.
async function data($: Ctx) {
  const now = await $.clock.now()
  const e = await read($, effortA)
  const m0 = await read($, memA)
  const m = m0 && !stale(m0.at, now) ? m0 : null
  if (!e && !m) return null
  const t = await read($, trendA)
  const an = await read($, animA)
  return { e, m, arr: e ? arrow(t.prev, t.level, t.since, now) : '', an }
}

type D = NonNullable<Awaited<ReturnType<typeof data>>>

function strip(Box: any, Text: any, d: D) {
  const { e, m, an } = d
  const used = m ? (an.pct ?? usedPct(m)) : undefined
  const b = m ? bar(used ?? 0) : null
  const mc = m ? MEM_COLOR[m.level] : undefined
  const ec = e ? effortColor(e.level) : undefined
  const free = m ? freeGB(m) : null
  const sw = m ? swapPct(m) : null
  const sc = sw === null ? null : swapColor(sw)
  const cells = e ? (an.cells === null ? effortCells(e.level) : '▰'.repeat(an.cells) + '▱'.repeat(5 - an.cells)) : ''
  const sep = (k: string) => <Text key={k} dimColor>{SEP}</Text>
  return (
    <Box>
      {e ? (
        <Box>
          <Text color={ec}>⚡ </Text>
          <Text bold inverse={an.flash} color={ec}>{d.arr}{e.level}</Text>
          <Text color={ec}> {cells}</Text>
          <Text dimColor> {sourceText(e.source)}</Text>
          {e.ultracode ? <Text color={ec}> + team</Text> : null}
        </Box>
      ) : null}
      {e && m ? sep('s1') : null}
      {m && b ? (
        <Box>
          <Text color={mc}>▣ </Text>
          <Text dimColor>RAM </Text>
          <Text color={mc}>{b.fill}</Text>
          <Text dimColor>{b.track}</Text>
          <Text color={mc}> {used === undefined ? '?' : `${Math.round(used)}%`}</Text>
          {free ? <Text dimColor> · </Text> : null}
          {free ? <Text>{free}G free</Text> : null}
        </Box>
      ) : null}
      {m && sw !== null ? sep('s2') : null}
      {m && sw !== null ? (
        <Box>
          <Text dimColor>swap </Text>
          {sc ? <Text color={sc}>{sw}%</Text> : <Text dimColor>{sw}%</Text>}
        </Box>
      ) : null}
    </Box>
  )
}

const HELP = 'Pick where the strip sits: /hud place <footer|band|hint|pane|off>; animations: /hud motion <on|off>. Dragging is not possible: Claude only draws mods in fixed slots.'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'hud', description: 'Effort + RAM strip: /hud place footer|band|hint|pane|off' })
      sessionId = String(await $.session.id()).trim() || sessionId
      await apply($, await savedPlacement($))
      if (!started) {
        started = true
        $.clock.every(5000, () => void refresh($))
      }
      await refresh($)
    } catch {
      // never throw out of a hook
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    void refresh($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    try {
      const args = e.args.trim().split(/\s+/).filter(Boolean)
      const cur = (await read($, placementA)) as Placement
      if (args.length === 0) return { text: `hud: sits in ${cur}, motion ${await savedMotion($)}. ${HELP}` }
      if (args[0] === 'motion' && args.length === 2 && (args[1] === 'on' || args[1] === 'off')) {
        await $.store.set('motion', args[1])
        if (args[1] === 'off') {
          stopEffort?.()
          stopMem?.()
          await update($, animA, () => ({ cells: null, flash: false, pct: null }))
        }
        return { text: `hud: motion ${args[1]}.` }
      }
      const want = args[1]
      if (args[0] !== 'place' || args.length !== 2 || !isPlacement(want)) return { text: `hud: usage /hud place <${PLACEMENTS.join('|')}> or /hud motion <on|off>` }
      await $.store.set('placement', want)
      await apply($, want, cur)
      await refresh($)
      return { text: `hud: now in ${want}.` }
    } catch (err) {
      return { text: `hud: ${String(err)}` }
    }
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    try {
      if ((await read($, placementA)) !== 'footer') return next(e)
      const d = await data($)
      if (!d) return next(e)
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box>
          {e.props.modes.length ? <Text dimColor>{e.props.modes.join(' & ')}  </Text> : null}
          {strip(Box, Text, d)}
        </Box>
      )
    } catch {
      return next(e)
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (e.props.hasSurvey || (await read($, placementA)) !== 'band') return next(e)
      const d = await data($)
      if (!d) return next(e)
      const { Box, Text } = $.ui.resolve(e)
      return strip(Box, Text, d)
    } catch {
      return next(e)
    }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    try {
      if ((await read($, placementA)) !== 'hint') return next(e)
      const d = await data($)
      if (!d) return next(e)
      return next({ ...e, props: { ...e.props, tail: stripText(d.e, d.arr, d.m) } })
    } catch {
      return next(e)
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    try {
      const d = await data($)
      if (!d) return next(e)
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box borderStyle="round" borderColor={d.m ? MEM_COLOR[d.m.level] : undefined} paddingX={1}>
          {strip(Box, Text, d)}
        </Box>
      )
    } catch {
      return next(e)
    }
  })
}
