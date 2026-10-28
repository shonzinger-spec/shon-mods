import { atom, read, update, type Hook, type Register } from 'claude-code'

import type { EffortNow, MemNow, Trend } from '../types'
import {
  arrow, EFFORT_FILL, EFFORT_TRACK, effortPct, freeGB, isPlacement, MEM_COLOR, MEM_FILL, MEM_TRACK, parseEffort, parseMem, pill, PLACEMENTS,
  runAnim, sourceText, stale, stripText, svgStrip, swapColor, swapPct, tween, usedPct,
  type Placement,
} from './lib'

const effortA = atom({ plugin: 'hud', key: 'effort' } as const, null)
const memA = atom({ plugin: 'hud', key: 'mem' } as const, null)
const trendA = atom({ plugin: 'hud', key: 'trend' } as const, { prev: null, level: null, since: 0 })
const placementA = atom({ plugin: 'hud', key: 'placement' } as const, 'footer')
// Frames of the running animations: effort fill % and RAM used %; null = draw the real value.
const animA = atom({ plugin: 'hud', key: 'anim' } as const, { epct: null, pct: null })
// Footer frame clock: the footer slot shows the SVG frozen, so it is redrawn ~7x a second.
const frameA = atom({ plugin: 'hud', key: 'frame' } as const, 0)
const FRAME_MS = 150

const ANIM_MS = 40
const ANIM_STEPS = 10
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

// Glide the effort fill / RAM fill to the new value. Each uses one timer, stopped on its last frame.
async function animate($: Ctx, oldE: EffortNow | null, e: EffortNow | null, oldM: MemNow | null, m: MemNow | null): Promise<void> {
  const set = (p: Partial<{ epct: number | null; pct: number | null }>) => void update($, animA, s => ({ ...s, ...p }))
  if (oldE && e && oldE.level !== e.level) {
    const from = (await read($, animA)).epct ?? effortPct(oldE.level)
    stopEffort?.()
    set({ epct: from })
    stopEffort = runAnim((ms, fn) => $.clock.every(ms, fn), ANIM_MS, tween(from, effortPct(e.level), ANIM_STEPS), v => set({ epct: v }), () => set({ epct: null }))
  }
  const a = oldM && m ? usedPct(oldM) : undefined
  const b = m ? usedPct(m) : undefined
  if (a !== undefined && b !== undefined && Math.abs(b - a) >= 1) {
    const from = (await read($, animA)).pct ?? a
    stopMem?.()
    set({ pct: from })
    stopMem = runAnim((ms, fn) => $.clock.every(ms, fn), ANIM_MS, tween(from, b, ANIM_STEPS), v => set({ pct: v }), () => set({ pct: null }))
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
  return { e, m, arr: e ? arrow(t.prev, t.level, t.since, now) : '', an, motion: (await savedMotion($)) === 'on' }
}

type D = NonNullable<Awaited<ReturnType<typeof data>>>

function strip(Box: any, Text: any, d: D) {
  const { e, m, an } = d
  const used = m ? (an.pct ?? usedPct(m)) : undefined
  const free = m ? freeGB(m) : null
  const sw = m ? swapPct(m) : null
  const sc = sw === null ? null : swapColor(sw)
  const segs = (k: string, l: ReturnType<typeof pill>) => l.map((g, i) => <Text key={`${k}${i}`} color={g.color} backgroundColor={g.backgroundColor} bold={g.bold}>{g.text}</Text>)
  return (
    <Box>
      {e ? (
        <Box>
          <Text dimColor>effort </Text>
          {segs('e', pill(an.epct ?? effortPct(e.level), 10, EFFORT_FILL, EFFORT_TRACK, e.level))}
          <Text> </Text>
          {d.arr ? <Text color={EFFORT_FILL}>{d.arr}</Text> : null}
          <Text dimColor>{sourceText(e.source)}</Text>
          {e.ultracode ? <Text color={EFFORT_FILL}> + team</Text> : null}
        </Box>
      ) : null}
      {e && m ? <Text>   </Text> : null}
      {m ? (
        <Box>
          <Text dimColor>ram </Text>
          {segs('m', pill(used ?? 0, 14, MEM_FILL[m.level], MEM_TRACK, used === undefined ? '?' : `${Math.round(used)}%`))}
          {free ? <Text dimColor> {free}G free</Text> : null}
          {sw !== null ? <Text dimColor>{free ? ' · ' : ' '}swap </Text> : null}
          {sw !== null ? (sc ? <Text color={sc}>{sw}%</Text> : <Text dimColor>{sw}%</Text>) : null}
        </Box>
      ) : null}
    </Box>
  )
}

// Desktop: one rounded SVG strip; null on terminals (caller draws text pills).
function svgEl($: Ctx, e: { surface: string }, d: D, frame?: number) {
  const ui = $.ui.resolve(e as never) as any
  if (e.surface === 'terminal' || !('Svg' in ui)) return null
  const { Svg } = ui
  const phase = frame === undefined ? undefined : (frame * FRAME_MS) / 1000
  const s = svgStrip({ e: d.e, epct: d.an.epct, arr: d.arr, m: d.m, pct: d.an.pct, motion: d.motion, phase })
  return <Svg source={s.svg} alt={s.alt} width={s.w} height={22} />
}

const HELP = 'Pick where the strip sits: /hud place <footer|band|hint|pane|off>; animations: /hud motion <on|off>. Dragging is not possible: Claude only draws mods in fixed slots.'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'hud', description: 'Effort + RAM pills: /hud place footer|band|hint|pane|off' })
      sessionId = String(await $.session.id()).trim() || sessionId
      await apply($, await savedPlacement($))
      if (!started) {
        started = true
        $.clock.every(5000, () => void refresh($))
        // Only ticks while the strip sits in the footer with motion on.
        $.clock.every(FRAME_MS, () => void (async () => {
          if ((await read($, placementA)) !== 'footer' || (await savedMotion($)) !== 'on') return
          await update($, frameA, n => (n + 1) % 100_000)
        })().catch(() => undefined))
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
          await update($, animA, () => ({ epct: null, pct: null }))
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
          {svgEl($, e, d, await read($, frameA)) ?? strip(Box, Text, d)}
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
      return svgEl($, e, d) ?? strip(Box, Text, d)
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
          {svgEl($, e, d) ?? strip(Box, Text, d)}
        </Box>
      )
    } catch {
      return next(e)
    }
  })
}
