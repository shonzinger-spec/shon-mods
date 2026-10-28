import { atom, read, update, type Hook, type Register } from 'claude-code'

import type { MemSnap } from '../types'
import {
  alertText, cleanCandidates, groupUsage, levelOf, memReport, meterText, mergeCfg, parsePs, parseSysctl, parseTop, shouldAlert, statusText,
  type Cfg, type Level,
} from './lib'

// "RAM 64% · 5.9G free · swap 98%"; falls back to the long form when sizes are unknown.
const bandMeter = (s: MemSnap) =>
  s.memTotalMB && s.freePct !== undefined && s.swapTotalMB > 0
    ? `RAM ${Math.round(100 - s.freePct)}% · ${((s.memTotalMB * s.freePct) / 100000).toFixed(1)}G free · swap ${Math.round((s.swapUsedMB / s.swapTotalMB) * 100)}%`
    : meterText(s)

const snapA = atom({ plugin: 'memory-guard', key: 'snap' } as const, null)
const dismissedA = atom({ plugin: 'memory-guard', key: 'dismissed' } as const, null)

const RANK = { ok: 0, warn: 1, critical: 2 }
const COLOR = { ok: 'green', warn: 'yellow', critical: 'red' } as const
const SAFE_NAME = /^[A-Za-z0-9 .()&+_-]+$/
const SAFE_PATH = /^\/[^"\\]+\.app$/

let started = false

// The shape of the `$` the hooks receive.
type Ctx = Parameters<Hook<'turn.complete'>>[0]

const dir = async ($: Ctx) => `${(await $.env.get('HOME')) ?? ''}/.claude/mods-src/memory-guard`

async function readText($: Ctx, path: string): Promise<string> {
  try {
    return String(await $.fs.read(path))
  } catch {
    return ''
  }
}

async function mkdirp($: Ctx, path: string): Promise<void> {
  await $.process.run(['mkdir', '-p', path.replace(/\/[^/]*$/, '')], { timeoutMs: 5000 })
}

async function append($: Ctx, path: string, row: unknown): Promise<void> {
  await $.process.run(
    ['/bin/sh', '-c', 'mkdir -p "$(dirname "$1")" && cat >> "$1"', 'sh', path],
    { stdin: JSON.stringify(row) + '\n', timeoutMs: 5000 },
  )
}

async function loadCfg($: Ctx): Promise<Cfg> {
  try {
    return mergeCfg(JSON.parse(await readText($, `${await dir($)}/config.json`)))
  } catch {
    return mergeCfg({})
  }
}

// Expensive: top takes seconds under pressure. Only /mem and alerts call it.
async function scan($: Ctx) {
  const [t, p] = await Promise.all([
    $.process.run(['top', '-l', '1', '-o', 'mem', '-n', '1000', '-stats', 'pid,ppid,mem'], { timeoutMs: 40_000 }),
    $.process.run(['ps', '-axo', 'pid=,ppid=,command='], { timeoutMs: 10_000 }),
  ])
  const rows = parseTop(t.stdout)
  const ps = parsePs(p.stdout)
  return { ...groupUsage(rows, ps), rows, ps }
}

async function cleanFlow($: Ctx, dryRun: boolean): Promise<string> {
  const D = await dir($)
  const home = (await $.env.get('HOME')) ?? ''
  const log = async (action: string, app: string, mb: number, extra: object = {}) =>
    append($, `${D}/state/actions.jsonl`, { ts: new Date(await $.clock.now()).toISOString(), action, app, mb: Math.round(mb), ...extra })
  const s = await scan($)
  const { cands, excluded } = cleanCandidates(s.rows, s.ps, home)
  if (dryRun) {
    await log('dry-run', cands.map(c => c.name).join(' + '), cands.reduce((a, c) => a + c.mb, 0))
    return [
      'Dry run: nothing asked, nothing quit.',
      cands.length ? 'Would offer:' : 'Nothing safe to quit.',
      ...cands.map(c => `  ${c.label}`),
      `Never offered: ${excluded.slice(0, 8).map(x => `${x.name} ${(x.mb / 1000).toFixed(1)}G`).join(', ') || 'none'}`,
    ].join('\n')
  }
  if (!cands.length) {
    $.ui.toast('memory-guard: nothing safe to quit', { timeoutMs: 8000 })
    return 'Nothing safe to quit.'
  }
  for (const c of cands) await log('offered', c.name, c.mb)
  const picked = async (answer: string) => {
    const got = new Set(answer.split(',').map(x => x.trim()))
    return cands.filter(c => got.has(c.label))
  }
  let chosen: typeof cands = []
  try {
    const options = cands.length >= 2 ? cands.map(c => c.label) : [...cands.map(c => c.label), 'None']
    chosen = await picked(await $.ui.ask('Which apps should Claude quit to free memory?', { options, header: 'Clean up', multiSelect: true }))
  } catch {
    chosen = []
  }
  for (const c of chosen) await log('picked', c.name, c.mb)
  if (!chosen.length) {
    await log('cancelled', '-', 0)
    return 'Nothing picked; nothing quit.'
  }
  let yes = ''
  try {
    yes = await $.ui.ask(`Quit ${chosen.map(c => c.name).join(', ')}? Apps can ask to save first.`, ['Quit them', 'Cancel'])
  } catch {
    yes = ''
  }
  if (yes !== 'Quit them') {
    for (const c of chosen) await log('cancelled', c.name, c.mb)
    return 'Cancelled; nothing quit.'
  }
  const fresh = await scan($).catch(() => null)
  const still = new Map((fresh ? cleanCandidates(fresh.rows, fresh.ps, home).cands : []).map(c => [c.name, c.path] as const))
  const lines: string[] = []
  for (const c of chosen) {
    const path = still.get(c.name) ?? ''
    if (!SAFE_NAME.test(c.name) || !SAFE_PATH.test(path) || path !== c.path) {
      await log('cancelled', c.name, c.mb, { stderr: 'skipped: unsafe name or no longer a candidate' })
      lines.push(`${c.name}: skipped`)
      continue
    }
    try {
      const r = await $.process.run(['osascript', '-e', `tell application "${path}" to quit`], { timeoutMs: 20_000 })
      await log('quit', c.name, c.mb, { exitCode: r.exitCode, stderr: r.stderr.slice(0, 300) })
      lines.push(`${c.name}: ${r.exitCode === 0 ? 'quit asked' : 'failed'}`)
    } catch (err) {
      await log('quit', c.name, c.mb, { exitCode: null, stderr: `no answer: ${String(err).slice(0, 200)}` })
      lines.push(`${c.name}: no answer (it may be showing a save dialog)`)
    }
  }
  return lines.join('\n')
}

// A press hook must return within the app's 10 s budget, but a clean-up scans (~5 s)
// and waits on two questions. So the press only starts it: the work runs from a
// one-shot timer, outside the press, and reports back with a toast.
let cleaning = false
function startClean($: Ctx): void {
  if (cleaning) { $.ui.toast('memory-guard: a clean-up is already open.', { timeoutMs: 5000 }); return }
  cleaning = true
  $.ui.toast('memory-guard: checking what is safe to quit…', { timeoutMs: 5000 })
  $.clock.after(50, () => {
    void cleanFlow($, false)
      .then(t => $.ui.toast(t, { timeoutMs: 15_000 }), err => $.ui.toast(`memory-guard: ${String(err)}`, { timeoutMs: 15_000 }))
      .finally(() => { cleaning = false })
  })
}

async function tick($: Ctx): Promise<void> {
  const cfg = await loadCfg($)
  const r = await $.process.run(
    ['/bin/sh', '-c', 'sysctl -n kern.memorystatus_vm_pressure_level vm.swapusage hw.memsize; memory_pressure -Q'],
    { timeoutMs: 5000 },
  )
  if (!r.stdout.trim()) return
  const sys = parseSysctl(r.stdout)
  const level = levelOf(sys, cfg)
  const now = await $.clock.now()
  const prev = await read($, snapA)
  const D = await dir($)
  let snap: MemSnap = {
    level, pressure: sys.pressure, swapTotalMB: sys.swapTotalMB, swapUsedMB: sys.swapUsedMB,
    topName: prev?.topName ?? null, topMb: prev?.topMb ?? 0, at: now,
    freePct: sys.freePct, memTotalMB: sys.memTotalMB, top: prev?.top,
  }
  const logRow = (extra: object) => append($, `${D}/state/log.jsonl`, {
    ts: new Date(now).toISOString(), level, pressure: sys.pressure, swapUsedMB: Math.round(sys.swapUsedMB), ...extra,
  })

  let alerted = false
  let prevAlert: { level: Level; at: number } | null = null
  try {
    const a = JSON.parse(await readText($, `${D}/state/alert.json`))
    if (a && (a.level === 'ok' || a.level === 'warn' || a.level === 'critical') && typeof a.at === 'number') prevAlert = { level: a.level, at: a.at }
  } catch {
    // no prior alert
  }
  if (shouldAlert(prevAlert, level, now, cfg)) {
    alerted = true
    await mkdirp($, `${D}/state/alert.json`)
    await $.fs.write(`${D}/state/alert.json`, JSON.stringify({ level, at: now }))
    const top = await scan($).catch(() => null)
    const users = (top?.groups ?? []).filter(g => g.kind !== 'chat' || g.name === 'All Claude chats')
    const first = users[0]
    if (first) snap = { ...snap, topName: first.name, topMb: first.mb }
    snap = { ...snap, top: users.slice(0, 4).map(g => ({ name: g.name, mb: g.mb })) }
    await $.fs.write(`${D}/state/top.json`, JSON.stringify({ at: now, top: snap.top, topName: snap.topName, topMb: snap.topMb })).catch(() => undefined)
    const text = alertText(level, users)
    $.ui.toast(text, { timeoutMs: 15_000 })
    if (level === 'critical') await $.ui.notify(text, { title: 'memory-guard' }).catch(() => undefined)
  }
  if (!alerted && level !== 'ok' && !snap.top?.length) {
    try {
      const t = JSON.parse(await readText($, `${D}/state/top.json`))
      if (t && typeof t.at === 'number' && now - t.at < cfg.cooldownMin * 60_000 && Array.isArray(t.top)) {
        snap = { ...snap, top: t.top, topName: typeof t.topName === 'string' ? t.topName : snap.topName, topMb: typeof t.topMb === 'number' ? t.topMb : snap.topMb }
      }
    } catch {
      // no shared scan yet
    }
  }
  await update($, snapA, () => snap)
  try {
    await mkdirp($, `${D}/state/now.json`)
    const { level: lv, freePct, memTotalMB, swapUsedMB, swapTotalMB, at } = snap
    await $.fs.write(`${D}/state/now.json`, JSON.stringify({ level: lv, freePct, memTotalMB, swapUsedMB, swapTotalMB, at }))
  } catch {
    // the hud is optional
  }
  $.ui.status(statusText(level, snap, snap.topName ? { name: snap.topName, mb: snap.topMb } : null))
  if (alerted || prev?.level !== level) await logRow({ alerted, top: snap.topName, topMb: Math.round(snap.topMb) })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'mem', description: 'Top memory users: apps, Claude chats and their MCP servers (read-only)' })
      if (!started) {
        started = true
        const cfg = await loadCfg($)
        $.clock.every(cfg.intervalSec * 1000, () => void tick($).catch(() => undefined))
      }
      void tick($).catch(() => undefined)
    } catch {
      // never throw out of a hook
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (e.props.hasSurvey) return next(e)
      const snap = await read($, snapA)
      if (!snap || snap.level === 'ok') return next(e)
      const d = await read($, dismissedA)
      if (d && RANK[snap.level] <= RANK[d.level] && (await $.clock.now()) - d.at < (await loadCfg($)).cooldownMin * 60_000) return next(e)
      const { Box, Button, Text } = $.ui.resolve(e)
      const level = snap.level
      const color = COLOR[level]
      const top = (snap.top ?? []).slice(0, 4)
      return (
        <Box flexDirection="column">
          <Box>
            <Text color={color}>▍</Text>
            <Text bold color={color}> ● Memory {level}</Text>
            <Text dimColor>  {bandMeter(snap)}  </Text>
            <Button key="clean" label="Let Claude clean it" variant="primary" onPress={() => startClean($)} />
            <Text> </Text>
            <Button key="later" label="Not now" variant="secondary" onPress={async () => { const at = await $.clock.now(); await update($, dismissedA, () => ({ level, at })) }} />
          </Box>
          {top.length ? (
            <Box>
              <Text color={color}>▍</Text>
              <Text dimColor>  Top  </Text>
              {top.map((t, i) => (
                <Box key={t.name}>
                  {i ? <Text dimColor> · </Text> : null}
                  <Text bold>{t.name} {(t.mb / 1000).toFixed(1)}G</Text>
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      )
    } catch {
      return next(e)
    }
  })

  on('command.run', { command: 'mem' }, async ($, e) => {
    try {
      if (/^\s*clean\b/.test(e.args)) return { text: await cleanFlow($, /--dry-run/.test(e.args)) }
      const { groups, chats } = await scan($)
      return { text: memReport(groups, chats, await read($, snapA)) }
    } catch (err) {
      return { text: `memory-guard: ${String(err)}` }
    }
  })
}
