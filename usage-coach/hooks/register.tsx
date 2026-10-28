import { atom, read, update, type Hook, type Register } from 'claude-code'

import type { SectionState, UsageSnap } from '../types'
import {
  allowancePerDay, bandLine, budgetText, calibrate, checkTask, daysLeft, deriveTool, groupNameOf,
  keywordSection, mergeCfg, nextText, nextToast, normalizeSection, p1, parallelSessions, parseJsonl,
  parseTasks, recommend, spentToday, statusText, toSamples,
  type Cfg, type HistoryRow, type Sample,
} from './lib'

const snapA = atom({ plugin: 'usage-coach', key: 'snap' } as const, null)
const sectionA = atom(
  { plugin: 'usage-coach', key: 'section' } as const,
  { name: null, source: null, prompt: null, checkedAt: 0 },
)

const COMMANDS = [
  { name: 'section', description: 'Show or set this session\'s usage-coach section' },
  { name: 'task', description: 'task start <n>: mark the start of a tasks.md task' },
  { name: 'done', description: 'Finish a task and record what it cost' },
  { name: 'next', description: 'Recommend the next task that fits the weekly limit' },
  { name: 'budget', description: 'Weekly limit, daily allowance and task fit' },
]

let sessionId = ''
let cwd = ''
let started = false

// The shape of the `$` the hooks receive.
type Ctx = Parameters<Hook<'turn.complete'>>[0]

const dir = async ($: Ctx) => `${(await $.env.get('HOME')) ?? ''}/.claude/mods-src/usage-coach`

async function readText($: Ctx, path: string): Promise<string> {
  try {
    return String(await $.fs.read(path))
  } catch (err) {
    if (!(await $.fs.exists(path).catch(() => true))) return ''
    const r = await $.process.run(['tail', '-c', '3000000', path], { timeoutMs: 5000 }).catch(() => null)
    void err
    return r ? r.stdout : ''
  }
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

async function detectSection($: Ctx): Promise<void> {
  const cfg = await loadCfg($)
  const r = await $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: 'self' })
  const text = (r.content as { type?: string; text?: string }[]).map(c => c.text ?? '').join('')
  const g = groupNameOf(text)
  if (!g) return
  await update($, sectionA, (s: SectionState) =>
    s.source === 'command' ? s : { ...s, name: normalizeSection(g, cfg.aliases), source: 'sidebar' as const, checkedAt: Date.now() },
  )
}

async function sectionName($: Ctx, cfg: Cfg): Promise<string> {
  const s = await read($, sectionA)
  return s.name ?? keywordSection(cwd, s.prompt ?? '', cfg.keywords) ?? 'unknown'
}

async function loadSamples($: Ctx): Promise<Sample[]> {
  return toSamples(parseJsonl(await readText($, `${await dir($)}/state/samples.jsonl`)))
}

async function loadHistory($: Ctx): Promise<HistoryRow[]> {
  return parseJsonl(await readText($, `${await dir($)}/state/task-history.jsonl`)).map(r => ({
    section: String(r.section ?? ''),
    size: String(r.size ?? ''),
    pct: typeof r.pct === 'number' ? r.pct : null,
    deltaUSD: typeof r.deltaUSD === 'number' ? r.deltaUSD : null,
  }))
}

const weeklyOf = (u: { rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[] }) =>
  u.rateLimits.find(r => r.kind === 'seven_day')

async function refresh($: Ctx): Promise<void> {
  const cfg = await loadCfg($)
  const u = await $.session.usage()
  const wk = weeklyOf(u)
  if (!wk) return
  const now = await $.clock.now()
  const five = u.rateLimits.find(r => r.kind === 'five_hour')
  const D = await dir($)
  await append($, `${D}/state/samples.jsonl`, {
    ts: new Date(now).toISOString(), session: sessionId, section: await sectionName($, cfg),
    weeklyPct: wk.percentUsed, fiveHourPct: five ? five.percentUsed : null, costUSD: u.cost?.usd ?? 0,
  })
  const samples = await loadSamples($)
  const cal = calibrate(samples, now, cfg)
  const left = daysLeft(wk.resetsAt, now)
  const allowance = allowancePerDay(wk.percentUsed, left)
  const mid = new Date(now)
  mid.setHours(0, 0, 0, 0)
  const snap: UsageSnap = {
    weekly: wk.percentUsed, daysLeft: left, allowance,
    spentToday: spentToday(samples, mid.getTime(), wk.percentUsed),
    parallel: parallelSessions(samples, now, cfg.parallelWindowMin),
    pctPerUSD: cal.pctPerUSD, next: null,
  }
  await update($, snapA, () => snap)
  $.ui.status(statusText(wk.percentUsed, left, allowance))
}

async function ctxNext($: Ctx) {
  const cfg = await loadCfg($)
  const snap = await read($, snapA)
  const remaining = snap ? 100 - snap.weekly : null
  const cal = { pctPerUSD: snap?.pctPerUSD ?? null, intervals: 0 }
  const tasks = parseTasks(await readText($, `${await dir($)}/tasks.md`), cfg.aliases)
  const history = await loadHistory($)
  return { cfg, snap, remaining, cal, tasks, history }
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      cwd = e.cwd ?? ''
      sessionId = `s${await $.clock.now()}`
      try {
        sessionId = String(await $.session.id())
      } catch {
        // keep the start-time id
      }
      for (const c of COMMANDS) await $.command.register(c)
      if (!started) {
        started = true
        $.clock.every(5 * 60_000, () => void refresh($).catch(() => undefined))
      }
      void detectSection($).catch(() => undefined)
    } catch {
      // never throw out of a hook
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      const text = typeof (e as { text?: unknown }).text === 'string' ? (e as { text: string }).text : ''
      if (text) await update($, sectionA, (s: SectionState) => (s.prompt ? s : { ...s, prompt: text.slice(0, 2000) }))
    } catch {
      // ignore
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    try {
      const row = deriveTool(e.tool, e as { skill?: unknown; subagent_type?: unknown })
      if (row) {
        const cfg = await loadCfg($)
        await append($, `${await dir($)}/state/tool-log.jsonl`, {
          ts: new Date(await $.clock.now()).toISOString(), session: sessionId, section: await sectionName($, cfg), ...row,
        })
      }
    } catch {
      // ignore
    }
    return r
  })

  on('tool.call', { tool: 'mcp__ccd_turn__wrap_up' }, async ($, e, next) => {
    const r = await next(e)
    try {
      const cfg = await loadCfg($)
      const snap = await read($, snapA)
      const res = recommend(parseTasks(await readText($, `${await dir($)}/tasks.md`), cfg.aliases), {
        remaining: snap ? 100 - snap.weekly : null, section: await sectionName($, cfg),
        history: await loadHistory($), cal: { pctPerUSD: snap?.pctPerUSD ?? null, intervals: 0 }, cfg,
      })
      const t = nextToast(res.picks)
      if (t) $.ui.toast(t)
    } catch {
      // ignore
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await refresh($).catch(() => undefined)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (e.props.hasSurvey) return next(e)
      const snap = await read($, snapA)
      if (!snap) return next(e)
      const line = bandLine({ spentToday: snap.spentToday, allowance: snap.allowance, parallel: snap.parallel }, await loadCfg($))
      if (!line) return next(e)
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box>
          <Text color="yellow">{line}</Text>
        </Box>
      )
    } catch {
      return next(e)
    }
  })

  on('command.run', { command: 'section' }, async ($, e) => {
    try {
      const cfg = await loadCfg($)
      const arg = (e.args ?? '').trim()
      if (arg) {
        const name = normalizeSection(arg, cfg.aliases)
        await update($, sectionA, (s: SectionState) => ({ ...s, name, source: 'command' as const, checkedAt: Date.now() }))
        return { text: `usage-coach section: ${name}` }
      }
      const s = await read($, sectionA)
      const name = s.name ?? keywordSection(cwd, s.prompt ?? '', cfg.keywords)
      return { text: `usage-coach section: ${name ?? 'unknown'} (${s.name ? s.source : name ? 'keyword' : 'none'})` }
    } catch (err) {
      return { text: `usage-coach: ${String(err)}` }
    }
  })

  on('command.run', { command: 'task' }, async ($, e) => {
    try {
      const m = /^start\s+(\d+)$/.exec((e.args ?? '').trim())
      if (!m) return { text: 'usage: /task start <n>' }
      const u = await $.session.usage()
      await append($, `${await dir($)}/state/task-starts.jsonl`, {
        ts: new Date(await $.clock.now()).toISOString(), session: sessionId, n: Number(m[1]), costUSD: u.cost?.usd ?? 0,
      })
      return { text: `usage-coach: task ${m[1]} started` }
    } catch (err) {
      return { text: `usage-coach: ${String(err)}` }
    }
  })

  on('command.run', { command: 'done' }, async ($, e) => {
    try {
      const D = await dir($)
      const cfg = await loadCfg($)
      const starts = parseJsonl(await readText($, `${D}/state/task-starts.jsonl`)).filter(r => r.session === sessionId)
      const arg = (e.args ?? '').trim()
      const n = arg ? Number(arg) : Number(starts[starts.length - 1]?.n)
      if (!Number.isFinite(n) || n < 1) return { text: 'usage-coach: no started task; use /done <n>' }
      const md = await readText($, `${D}/tasks.md`)
      const task = parseTasks(md, cfg.aliases).find(t => t.n === n)
      const updated = checkTask(md, n, cfg.aliases)
      if (!task || updated === null) return { text: `usage-coach: task ${n} not found or already done` }
      await $.fs.write(`${D}/tasks.md`, updated)
      const start = [...starts].reverse().find(r => Number(r.n) === n)
      const u = await $.session.usage()
      const deltaUSD = start && typeof start.costUSD === 'number' ? Math.max(0, (u.cost?.usd ?? 0) - start.costUSD) : null
      const snap = await read($, snapA)
      const pct = deltaUSD !== null && snap?.pctPerUSD != null ? deltaUSD * snap.pctPerUSD : null
      await append($, `${D}/state/task-history.jsonl`, {
        ts: new Date(await $.clock.now()).toISOString(), session: sessionId, section: task.section, size: task.size,
        task: task.text, deltaUSD, pctPerUSD: snap?.pctPerUSD ?? null, pct,
      })
      const c = await ctxNext($)
      const t = nextToast(recommend(c.tasks.map(x => (x.n === n ? { ...x, done: true } : x)), { remaining: c.remaining, section: task.section, history: c.history, cal: c.cal, cfg }).picks)
      if (t) $.ui.toast(t)
      return { text: `usage-coach: task ${n} done${deltaUSD !== null ? ` ($${p1(deltaUSD)}${pct !== null ? `, ~${p1(pct)}% of the week` : ''})` : ''}` }
    } catch (err) {
      return { text: `usage-coach: ${String(err)}` }
    }
  })

  on('command.run', { command: 'next' }, async ($, e) => {
    try {
      const c = await ctxNext($)
      const res = recommend(c.tasks, { remaining: c.remaining, section: await sectionName($, c.cfg), history: c.history, cal: c.cal, cfg: c.cfg })
      return { text: nextText(res, c.remaining, c.cal, c.cfg) }
    } catch (err) {
      return { text: `usage-coach: ${String(err)}` }
    }
  })

  on('command.run', { command: 'budget' }, async ($, e) => {
    try {
      const c = await ctxNext($)
      const samples = await loadSamples($)
      const snap = c.snap
      return {
        text: budgetText({
          weekly: snap ? snap.weekly : null, left: snap?.daysLeft ?? null, allowance: snap?.allowance ?? null,
          spent: snap?.spentToday ?? null, parallel: snap?.parallel ?? 0, cal: c.cal, tasks: c.tasks,
          history: c.history, cfg: c.cfg, sampleCount: samples.length,
        }),
      }
    } catch (err) {
      return { text: `usage-coach: ${String(err)}` }
    }
  })
}
