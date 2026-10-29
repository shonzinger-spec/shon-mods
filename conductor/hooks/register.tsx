import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band } from '../types'
import { classify, loadRoutes } from './classify.ts'
import type { Routes } from './routes.ts'
import { addUsage, bandText, ledgerPath, parseLedger, routeRow, whyLine, type RouteRow, type SpawnEvent, type UsageRow } from './ledger.ts'
import { planSpawn, stepEffort, tier, type Plan } from './enforce.ts'
import { calAfterSpawn, calComplete, calShadowStarted, calLoad, calStatus, calUsage, calibrator, isShadow, promoted } from './calibrate.ts'
import type { BusState } from './bus.ts'
import { sessionKey, CCD_SEND, CCD_SEND_DENY, CCD_SET_MODE, CCD_START, PEER_NOTE, armAsk, clip, countsAsPeer, envelopeFor, freshBus, isInternal, isPeerKind, isSelf, load as busLoad, log as busLog, noteWakeup, resultText, startMode, takeAsk, targetMode } from './bus.ts' // step 5
import { formatEnv, parseEnv } from './envelope.ts' // step 5
import { checkReceive, checkSend, costUsd, recordSend } from './guards.ts' // step 5
import { PANE_ID, PANE_TITLE, busLines, contentText, heldCount, localIds, openThreads, routeLines, sessionPlan, type Tab } from './pane.ts' // step 6
import { escalatedEffort, escalation, isCheckCommand, prune, taskKey, type TaskEntry } from './escalate.ts'

// Step 3a: ENFORCE mode. agent.spawn applies model raises (and allowed lowerings, see enforce.ts);
// turn.step applies the route's effort per agentId and caps every subagent step at xhigh.
// Forks, caller-set models and caller-set efforts are kept. Any hook error passes the event on unchanged.
// Step 3b: a checked route's run whose last test/build Bash call failed is re-spawned one tier up (escalate.ts).
const MODE = 'enforce'
const FLUSH_MS = 1000
const band = atom({ plugin: 'conductor', key: 'band' } as const, null)
/** step 6: the pane's tab, and a revision bus.ts bumps on each bus row (same atom there). */
const paneAtom = atom({ plugin: 'conductor', key: 'pane' } as const, { tab: 'routes' as Tab, rev: 0 })

type S = {
  home: string
  routes: Routes | null
  routesError: string | null
  routesSource: string
  ledger: string | null
  routeRows: RouteRow[]
  usage: Map<string, UsageRow> // `${agentId}\u0000${model}`
  agents: Map<string, { subagentType: string; description: string }>
  /** Per routed agentId: the route effort and plan turn.step applies, and the ledger row it fills. */
  routed: Map<string, { effort?: string; plan: Plan; row: RouteRow | null; stepped: boolean; key?: string }>
  /** Checked tasks' last runs by task key (in memory, pruned past WINDOW_MS). */
  tasks: Map<string, TaskEntry>
  /** Agent tool call's explicit effort by tool_use_id, consumed by the matching agent.spawn. */
  callerEffort: Map<string, unknown>
  errors: number
  lastError: string | null
  flushPending: boolean
}

function fresh(): S {
  return {
    home: '',
    routes: null,
    routesError: null,
    routesSource: '',
    ledger: null,
    routeRows: [],
    usage: new Map(),
    agents: new Map(),
    routed: new Map(),
    tasks: new Map(),
    callerEffort: new Map(),
    errors: 0,
    lastError: null,
    flushPending: false,
  }
}

async function isOn($: EngineInterface): Promise<boolean> {
  return (await $.store.get('enabled')) !== false
}

async function iso($: EngineInterface): Promise<string> {
  return new Date(await $.clock.now()).toISOString()
}

async function paint($: EngineInterface, s: S, last?: Band['last']): Promise<void> {
  const on_ = await isOn($)
  await update($, band, prev => ({
    on: on_,
    mode: MODE,
    routesError: s.routesError,
    errors: s.errors,
    last: last === undefined ? (prev?.last ?? null) : last,
    main: prev?.main,
  }))
}

// step 7: the band's main-session line (every switch, not just the first)
async function paintMain($: EngineInterface, s: S, main: string): Promise<void> {
  const on_ = await isOn($)
  await update($, band, prev => ({
    on: on_, mode: MODE, routesError: s.routesError, errors: s.errors, last: prev?.last ?? null, main,
  }))
}

async function fail($: EngineInterface, s: S, err: unknown): Promise<void> {
  s.errors += 1
  s.lastError = String((err as Error)?.message ?? err)
  try {
    // not paint(): the store read it makes may be what failed
    await update($, band, prev => ({ on: prev?.on ?? true, mode: MODE, routesError: s.routesError, errors: s.errors, last: prev?.last ?? null, main: prev?.main }))
  } catch {
    // the band is best effort
  }
}

async function loadAll($: EngineInterface, s: S): Promise<void> {
  s.home = (await $.env.get('HOME')) ?? ''
  const user = `${s.home}/.claude/conductor/routes.json`
  const path = (await $.fs.exists(user)) ? user : `${$.plugin.root}/routes.default.json`
  s.routesSource = path
  let res: ReturnType<typeof loadRoutes>
  try {
    res = loadRoutes(await $.fs.read(path))
  } catch (err) {
    res = { ok: false, error: `cannot read ${path}: ${String((err as Error)?.message ?? err)}` }
  }
  s.routes = res.ok ? res.routes : null
  s.routesError = res.ok ? null : res.error
  const sid = await $.session.id().catch(() => 'unknown')
  s.ledger = ledgerPath(s.home, await $.clock.now(), sid)
  // A reload (new module, empty memory) must not overwrite rows an earlier load wrote.
  if (s.routeRows.length === 0 && s.usage.size === 0 && (await $.fs.exists(s.ledger))) {
    const prior = parseLedger(await $.fs.read(s.ledger))
    s.routeRows.push(...prior.routes)
    for (const u of prior.usage) s.usage.set(`${u.agentId}\u0000${u.model}`, u)
  }
}

// The whole session's rows are held in memory and the per-session file is rewritten from them at
// most once per FLUSH_MS: usage is one cumulative row per (agent, model), so the file stays ~2 rows
// per agent and a rewrite is small; no file ever grows across sessions.
async function flush($: EngineInterface, s: S): Promise<void> {
  s.flushPending = false
  if (!s.ledger) return
  const rows = [...s.routeRows, ...s.usage.values()]
  try {
    await $.fs.write(s.ledger, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  } catch (err) {
    await fail($, s, err)
  }
}

async function schedule($: EngineInterface, s: S): Promise<void> {
  if (s.flushPending) return
  s.flushPending = true
  await $.clock.after(FLUSH_MS, () => void flush($, s))
}

// Learn an agent type's pinned model from a spawn conductor did not rewrite. A resolved model equal
// to the parent's is indistinguishable from "inherits", so it clears the pin instead of recording one.
async function learnPin($: EngineInterface, type: string, parentModel: string | undefined, resolved: string): Promise<void> {
  const pins = { ...(((await $.store.get('pins')) ?? {}) as Record<string, string>) }
  if (resolved === parentModel) {
    if (!(type in pins)) return
    delete pins[type]
  } else {
    if (pins[type] === resolved) return
    pins[type] = resolved
  }
  await $.store.set('pins', pins)
}

/** Origins of a person's own message: the terminal prompt (composer), the Desktop app / Agent SDK host
 * (sdk; how a typed Desktop prompt arrives), Remote Control (bridge). Same set sharpen and effort-router use.
 * Peers, relays, channels, plugins, notifications and scheduled triggers never qualify. */
const TYPED = new Set(['composer', 'sdk', 'bridge'])

/** Only what Shon typed may arm a send or start a session (SPEC: user_asked). */
function typedByShon(e: { origin?: { kind?: string } }): boolean {
  return TYPED.has(e.origin?.kind ?? '')
}

/** A peer delivery that counts toward the receive caps: not one into a subagent's loop, and not a verified
 * in-process teammate's (this session's own team). */
function receiveCounts(e: { agentId?: string; origin: unknown }): boolean {
  const o = e.origin as { teammate?: string; isVerified?: boolean }
  return e.agentId === undefined && !(o.teammate !== undefined && o.isVerified === true)
}

async function setTab($: EngineInterface, tab: Tab): Promise<void> {
  await update($, paneAtom, p => ({ ...p, tab }))
}

// step 6: `/conductor session <class> <text…>`; every start_session argument is the typed text or the route
async function startSession($: EngineInterface, s: S, bus: BusState, rest: string): Promise<string> {
  const m = /^(\S*)\s*([\s\S]*)$/.exec(rest) as RegExpExecArray
  const plan = sessionPlan(s.routes, m[1], m[2].trim())
  if (!plan.ok) return plan.text
  const r = await $.mcp.call('ccd_session', 'start_session', plan.args)
  const text = contentText(r.content)
  if (r.isError) return `conductor session: start_session failed: ${clip(text)}`
  const ids = localIds(text)
  const mode = startMode(bus, 'inherit')
  for (const id of ids) bus.started.set(sessionKey(id), mode)
  bus.started.set(sessionKey(plan.title), mode)
  await busLog($, bus, { type: 'start', cls: m[1], to: ids[0] ?? plan.title, text: clip(plan.title) })
  return `conductor session: started ${ids.join(', ') || '(no session id in the result)'} · ${m[1]} · "${plan.title}"`
}

export const register: Register = on => {
  const s = fresh()
  const cal = calibrator() // step 8 (calibrate.ts)
  const bus = freshBus() // step 5 (bus.ts); step 6's /conductor ask arms it (armAsk)

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'conductor', description: 'conductor: status | why | on | off | ask | session <class> <text> | pane [routes|bus] | calibrate on|off | main auto|off' })
    await loadAll($, s)
    try {
      await calLoad($, cal, s.home) // step 8
    } catch (err) {
      await fail($, s, err)
    }
    try {
      await busLoad($, bus) // step 5
    } catch {
      bus.errors += 1
    }
    await paint($, s)
    return r
  }).catch(async ($, e, next) => {
    await fail($, s, next.error)
    return next(e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const effort = (e as { effort?: unknown }).effort
    if (effort !== undefined) s.callerEffort.set(e.tool_use_id, effort)
    return next(e)
  })

  // A routed checked agent's own Bash checks: the LAST one's result sets checkFailed on its row and task.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    try {
      const a = e.agentId ? s.routed.get(e.agentId) : undefined
      if (a?.key && a.row && isCheckCommand((e as { command?: unknown }).command)) {
        const failed = (r as { isError?: boolean } | undefined)?.isError === true
        a.row.checkFailed = failed
        const t = s.tasks.get(a.key)
        if (t) {
          t.checkFailed = failed
          t.ts = await $.clock.now()
        }
        await schedule($, s)
      }
    } catch (err) {
      await fail($, s, err)
    }
    return r
  })

  on('agent.spawn', async ($, e, next) => {
    // step 5: this session's own permission mode, as the engine states it on each spawn
    if (!e.parentAgentId && e.permissionMode) bus.selfMode = e.permissionMode
    if (isShadow(e.description)) {
      // step 8: a calibration shadow is never routed or sampled; its agentId binds it to its pair
      const r = await next(e)
      calShadowStarted(cal, e.description, r?.agentId)
      return r
    }
    if (!(await isOn($))) return next(e)
    const callerEffort = s.callerEffort.get(e.tool_use_id)
    s.callerEffort.delete(e.tool_use_id)
    let decision: ReturnType<typeof classify> | null = null
    let plan: Plan | null = null
    let out = e
    let key: string | undefined
    let esc = { escalated: false, model: null as string | null }
    let effort: string | undefined
    if (s.routes) {
      try {
        decision = classify(
          { description: e.description, subagentType: e.subagentType, model: e.model, fork: e.fork, workflow: e.workflow },
          s.routes,
        )
        const pins = ((await $.store.get('pins')) ?? {}) as Record<string, string>
        const calibrated = promoted(cal.st) // step 8: classes promoted by calibration
        plan = planSpawn(e, decision, { pins, calibrated, agentMap: s.routes.agent_map }, callerEffort)
        if (decision.mode === 'checked' && !e.fork) {
          const now = await $.clock.now()
          prune(s.tasks, now)
          key = taskKey(e.description, e.subagentType)
          esc = escalation(s.tasks.get(key), e.model)
          // an escalation never lowers below what the plan would already send
          if (esc.model && (plan.lowerAllowed || tier(esc.model) > tier(plan.model ?? plan.baseline))) {
            plan.model = esc.model
            plan.escalate = true
            effort = escalatedEffort(decision.effort, esc.model)
          }
        }
        if (plan.model) out = { ...e, model: plan.model }
      } catch (err) {
        await fail($, s, err)
        decision = null
        plan = null
        out = e
        key = undefined
      }
    }
    const r = await next(out)
    try {
      if (r?.agentId) s.agents.set(r.agentId, { subagentType: e.subagentType, description: e.description })
      if (plan && !plan.model && plan.kind === 'suggested' && r?.model) await learnPin($, e.subagentType, e.parentModel, r.model)
      if (decision && plan) {
        const row = routeRow(await iso($), MODE, e as SpawnEvent, decision, r, plan)
        row.escalated = esc.escalated
        s.routeRows.push(row)
        if (r?.agentId) s.routed.set(r.agentId, { effort: plan.escalate ? effort : decision.effort, plan, row, stepped: false, key })
        if (key) s.tasks.set(key, { ts: await $.clock.now(), model: r?.model ?? out.model ?? null, checkFailed: false, escalated: esc.escalated })
        await paint($, s, { desc: e.description, cls: decision.cls, model: decision.model, effort: decision.effort, applied: plan.model ? `model ${plan.model}` : '' })
        await schedule($, s)
      }
    } catch (err) {
      await fail($, s, err)
    }
    // step 5: an escalation retry counts as a wakeup toward the receive caps; a bus failure never costs the route row
    try {
      if (esc.escalated) await noteWakeup($, bus, 'escalation retry')
    } catch {
      bus.errors += 1
    }
    // step 8: maybe repeat a read-only run as a shadow
    try {
      if (decision && r && !r.deny) await calAfterSpawn($, cal, e, decision.cls, decision.model, r)
    } catch (err) {
      await fail($, s, err)
    }
    return r
  }).catch(async ($, e, next) => {
    await fail($, s, next.error)
    return next(e)
  })

  // step 7: the last main-session model/effort seen while main auto was on
  let lastMain = ''

  on('turn.step', async function* ($, e, next) {
    let out = e
    let on_ = false
    try {
      on_ = await isOn($)
      // step 7: main session only (no agentId); subagent steps never reach this
      if (!e.agentId && on_ && (await $.store.get('mainAuto')) === true) {
        const cut = e.effort === 'max'
        if (cut) out = { ...e, effort: 'xhigh' as typeof e.effort }
        const seen = `${e.model}/${String(e.effort)}`
        if (cut || seen !== lastMain) await paintMain($, s, cut ? `main: max→xhigh` : `main: ${e.model}/${e.effort === undefined ? '-' : String(e.effort)}`)
        lastMain = seen
      }
      if (e.agentId && on_) {
        const a = s.routed.get(e.agentId)
        const { effort, note } = stepEffort(e.effort, a?.effort, a?.plan ?? null)
        if (effort !== e.effort) out = { ...e, effort: effort as typeof e.effort }
        if (a && !a.stepped) {
          a.stepped = true
          if (a.row) {
            a.row.before.effort = e.effort === undefined ? null : String(e.effort)
            a.row.after.effort = out.effort === undefined ? null : String(out.effort)
            if (out.effort !== e.effort) a.row.applied = true
            if (note) a.row.notApplied.push(note)
            await schedule($, s)
          }
          if (out.effort !== e.effort && a.row && s.routeRows.at(-1) === a.row) {
            const model = a.plan.model ? `model ${a.plan.model} · ` : ''
            await paint($, s, { desc: a.row.description, cls: a.row.cls, model: a.row.suggestedModel, effort: a.row.suggestedEffort ?? undefined, applied: `${model}effort ${String(out.effort)}` })
          }
        }
      }
    } catch (err) {
      await fail($, s, err)
      out = e
    }
    const r = yield* next(out)
    // step 8: a shadow's usage counts toward the daily shadow cap
    try {
      if (e.agentId && r?.usage) await calUsage($, cal, e.agentId, r.usage.model ?? e.model, r.usage)
    } catch (err) {
      await fail($, s, err)
    }
    try {
      if (e.agentId && r?.usage && on_) {
        const model = r.usage.model ?? e.model
        const key = `${e.agentId}\u0000${model}`
        const ts = await iso($)
        let row = s.usage.get(key)
        if (!row) {
          const a = s.agents.get(e.agentId)
          row = {
            type: 'usage', agentId: e.agentId, subagentType: a?.subagentType ?? null, description: a?.description ?? null,
            model, steps: 0, firstTs: ts, lastTs: ts,
            input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
          }
          s.usage.set(key, row)
        }
        addUsage(row, r.usage, ts)
        await schedule($, s)
      }
    } catch (err) {
      await fail($, s, err)
    }
    try {
      // step 5: spend of main-loop turns a peer message or a wakeup started (the $/day receive cap)
      if ((e.agentId === undefined ? bus.peerTurns.has(e.turnId) : bus.peerAgents.has(e.agentId)) && r?.usage) {
        const usd = costUsd(r.usage.model ?? e.model, r.usage)
        if (usd > 0) {
          bus.guards.spend.push({ ts: await $.clock.now(), usd })
          await busLog($, bus, { type: 'spend', usd, id: e.turnId })
        }
      }
    } catch {
      bus.errors += 1
    }
    return r
  })

  on('command.run', { command: 'conductor' }, async ($, e) => {
    const arg = e.args.trim().split(/\s+/)[0] || 'status'
    if (arg === 'on' || arg === 'off') {
      await $.store.set('enabled', arg === 'on')
      await paint($, s)
      return { text: `conductor ${arg} (mode ${MODE})` }
    }
    if (arg === 'main') {
      const v = e.args.trim().split(/\s+/)[1]
      if (v !== 'auto' && v !== 'off') return { text: 'Usage: /conductor main auto|off' }
      await $.store.set('mainAuto', v === 'auto')
      return { text: `conductor main ${v} (max → xhigh on main-session steps; subagents unchanged)` }
    }
    if (arg === 'calibrate') {
      const v = e.args.trim().split(/\s+/)[1]
      if (v === 'on' || v === 'off') await $.store.set('calibrate', v === 'on')
      return { text: (await calStatus($, cal)).join('\n') }
    }
    // step 6
    if (arg === 'ask') {
      if (!typedByShon(e as { origin?: { kind?: string } })) return { text: 'conductor ask: only a command Shon typed can arm a send' }
      armAsk(bus, await $.clock.now())
      await busLog($, bus, { type: 'ask', reason: 'armed by /conductor ask' })
      return { text: 'conductor ask: the next send may go to an auto/bypassPermissions session (one send attempt, within 10 minutes)' }
    }
    if (arg === 'session') {
      if (!typedByShon(e as { origin?: { kind?: string } })) return { text: 'conductor session: only a command Shon typed can start a session' }
      return { text: await startSession($, s, bus, e.args.trim().replace(/^session\s*/, '')) }
    }
    if (arg === 'pane') {
      const v = e.args.trim().split(/\s+/)[1]
      if (v === 'routes' || v === 'bus') await setTab($, v)
      await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
      return { text: `conductor pane (${(await read($, paneAtom)).tab})` }
    }
    if (arg === 'why') {
      const last = s.routeRows.slice(-5)
      return { text: last.length ? last.map(whyLine).join('\n') : 'conductor: no routed spawns this session' }
    }
    if (arg !== 'status') return { text: 'Usage: /conductor status | why | on | off | ask | session <class> <text> | pane [routes|bus] | calibrate on|off | main auto|off' }
    const tokens = [...s.usage.values()].reduce((n, u) => n + u.steps, 0)
    return {
      text: [
        `conductor ${(await isOn($)) ? 'on' : 'off'} · mode ${MODE}`,
        `routes: ${s.routesSource || '(not loaded)'} · ${s.routesError ? `INVALID: ${s.routesError}` : 'valid'}`,
        `route rows ${s.routeRows.length} · agents with usage ${new Set([...s.usage.values()].map(u => u.agentId)).size} · usage steps ${tokens}`,
        `main auto ${(await $.store.get('mainAuto')) === true ? 'on' : 'off'}`,
        `errors ${s.errors}${s.lastError ? ` (last: ${s.lastError})` : ''}`,
        `ledger: ${s.ledger ?? '(none)'}`,
        ...(await calStatus($, cal)), // step 8
      ].join('\n'),
    }
  })

  // step 8: calibration pairs are judged when both runs have answered
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) bus.mainTurn = null // step 5
    try {
      if (e.agentId) await calComplete($, cal, e.agentId, e.reason, e.answer)
    } catch (err) {
      await fail($, s, err)
    }
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, band)
    if (e.props.hasSurvey || !b) return next(e)
    await read($, paneAtom) // step 6: repaint on each bus row
    const counts = { threads: openThreads(bus.recent, await $.clock.now()), held: heldCount(bus.recent) }
    const { Box, Text } = $.ui.resolve(e)
    const below = await next(e)
    return (
      <Box flexDirection="column">
        <Text dimColor color={b.routesError || b.errors ? 'yellow' : undefined}>{bandText(b, counts)}</Text>
        {below}
      </Box>
    )
  })

  // step 6: the pane (Routes | Bus)
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { tab } = await read($, paneAtom)
    const lines = tab === 'routes' ? routeLines(s.routeRows) : busLines(bus.recent)
    return (
      <Box flexDirection="column">
        <Box>
          <Button key="routes" label={tab === 'routes' ? '[Routes]' : 'Routes'} onPress={() => setTab($, 'routes')} />
          <Button key="bus" label={tab === 'bus' ? '[Bus]' : 'Bus'} onPress={() => setTab($, 'bus')} />
        </Box>
        {lines.map(l => (
          <Text>{l}</Text>
        ))}
      </Box>
    )
  })

  // ---- step 5: message bus (SPEC §5); helpers in bus.ts ----


  // Transport: ccd send_message is never used (fails closed: a broken hook still denies).
  // A direct ccd send_message is denied; the same tool carrying a SendMessage that already passed the send guards
  // (the Desktop app forwards SendMessage through it) goes on. Fails closed: a broken hook still denies.
  on('tool.call', { tool: CCD_SEND }, async ($, e, next) => {
    const to = (e as unknown as { session_id?: string }).session_id
    if (to && (bus.forwarding.get(sessionKey(to)) ?? 0) > 0) return next(e)
    return { deny: CCD_SEND_DENY }
  }).catch(async () => ({ deny: CCD_SEND_DENY }))

  // Sessions this one starts: their permission mode, and whether their completion will wake us.
  on('tool.call', { tool: CCD_START }, async ($, e, next) => {
    const r = await next(e)
    try {
      const a = e as unknown as { permission_mode?: string; name?: string; wake_when_done?: boolean; proposal_id?: string }
      const text = resultText((r as { result?: unknown }).result) + ' ' + ((r as { text?: string }).text ?? '')
      if ((r as { deny?: string }).deny === undefined && (r as { isError?: boolean }).isError !== true) {
        const mode = startMode(bus, a.permission_mode)
        const ids = [...new Set(text.match(/local_[A-Za-z0-9_-]+/g) ?? [])]
        for (const id of ids) bus.started.set(sessionKey(id), mode)
        if (a.name) bus.started.set(sessionKey(a.name), mode)
        if (a.wake_when_done && (ids.length || a.name)) {
          bus.wakePending.push({ ids: ids.map(sessionKey) })
        }
      }
    } catch {
      bus.errors += 1
    }
    return r
  })

  on('tool.call', { tool: CCD_SET_MODE }, async ($, e, next) => {
    const r = await next(e)
    try {
      const a = e as unknown as { session_id?: string; mode?: string }
      if (a.mode && (r as { deny?: string }).deny === undefined && (r as { isError?: boolean }).isError !== true) {
        if (a.session_id === 'self') bus.selfMode = a.mode
        else if (a.session_id && bus.started.has(sessionKey(a.session_id))) bus.started.set(sessionKey(a.session_id), a.mode)
      }
    } catch {
      bus.errors += 1
    }
    return r
  })


  on('session.send', async ($, e, next) => {
    if (await isInternal($, e.to)) return next(e)
    const now = await $.clock.now()
    bus.seq += 1
    const env = envelopeFor(bus, e.to, now, `${now.toString(36)}.${bus.seq}`)
    const mode = targetMode(bus, e.to)
    // the ask is spent by this attempt whatever its target or outcome (and lapses after 10 minutes)
    const ask = takeAsk(bus, now)
    const reason = checkSend(bus.guards, { to: e.to, text: e.text, hop: env.hop, now, isSelf: isSelf(bus, e.to), mode, ask })
    if (reason) {
      await busLog($, bus, { type: 'refused', to: e.to, hop: env.hop, re: env.re, reason, text: clip(e.text) })
      return { isDelivered: false as const, reason: `conductor: ${reason}` }
    }
    if (mode === undefined && !bus.flagged.has(e.to)) {
      bus.flagged.add(e.to)
      await busLog($, bus, { type: 'flag', to: e.to, reason: 'target permission mode unknown (not started by this session)' })
    }
    const fk = sessionKey(e.to)
    bus.forwarding.set(fk, (bus.forwarding.get(fk) ?? 0) + 1)
    let r: Awaited<ReturnType<typeof next>>
    try {
      r = await next({ ...e, text: `${formatEnv(env)}\n${e.text}` })
    } finally {
      const left = (bus.forwarding.get(fk) ?? 1) - 1
      if (left > 0) bus.forwarding.set(fk, left)
      else bus.forwarding.delete(fk)
    }
    if (r.isDelivered) {
      recordSend(bus.guards, e.to, e.text, now)
      bus.sentTo.set(env.id, e.to)
      // a reply consumes the envelope it answered: the next unprompted send starts a new thread
      if (env.re) for (const [k, v] of bus.lastFrom) if (v.env.id === env.re) bus.lastFrom.delete(k)
      await busLog($, bus, { type: 'send', to: e.to, id: env.id, re: env.re, hop: env.hop, from: env.from, text: clip(e.text) })
    }
    return r
  }).catch(async ($, e, next) => {
    bus.errors += 1
    return next.called ? next(e) : { isDelivered: false as const, reason: 'conductor: its send guard failed' }
  })

  on('session.receive', async ($, e, next) => {
    const origin = e.origin as { kind: string; plugin?: string; teammate?: string; isVerified?: boolean }
    if (!countsAsPeer(origin.kind)) return next(e)
    const now = await $.clock.now()
    const counts = receiveCounts(e)
    const env = parseEnv(e.text)
    if (counts) {
      // decide first; the log row is best effort and never turns a hold into a delivery
      const held = checkReceive(bus.guards, now)
      if (held) {
        try {
          await busLog($, bus, { type: 'held', reason: held, id: env?.id ?? null, from: env?.from ?? null, text: clip(e.text) })
        } catch {
          bus.errors += 1
        }
        return { consumed: `conductor: held (${held})` }
      }
      bus.guards.peer.push(now)
    }
    if (env) {
      bus.lastFrom.set(env.from, { env, at: now })
      const to = env.re ? bus.sentTo.get(env.re) : undefined
      if (to && to !== env.from) bus.alias.set(to, env.from)
    }
    try {
      await busLog($, bus, { type: 'receive', counted: counts, id: env?.id ?? null, re: env?.re ?? null, hop: env?.hop ?? null, from: env?.from ?? null, text: clip(e.text) })
    } catch {
      bus.errors += 1
    }
    return next({ ...e, text: `${PEER_NOTE}\n${e.text}` })
  }).catch(async ($, e, next) => {
    bus.errors += 1
    if (next.called) return next(e)
    // fail closed: hold unless the caps can be read and are not reached; a delivery still gets the note
    try {
      if (receiveCounts(e)) {
        const now = await $.clock.now()
        const held = checkReceive(bus.guards, now)
        if (held) return { consumed: `conductor: held (${held})` }
        bus.guards.peer.push(now)
      }
    } catch {
      return { consumed: 'conductor: held (its receive guard failed)' }
    }
    return next({ ...e, text: `${PEER_NOTE}\n${e.text}` })
  })

  // Which main-loop turns a peer message or a wakeup started (for the $/day cap).
  on('prompt.submit', async ($, e, next) => {
    try {
      const kind = (e as { origin?: { kind?: string } }).origin?.kind ?? ''
      if (e.turnId === undefined) {
        // a turn not typed by Shon and not his own background/scheduled work: priced toward the peer cap
        let peerTurn = countsAsPeer(kind) && !TYPED.has(kind)
        // match the wake to the started session: named pending id, else oldest id-less entry (the note names
        // some other session), else oldest entry when the note names no session id at all
        const named = kind === 'task-notification' ? [...new Set(String(e.text ?? '').match(/local_[A-Za-z0-9_-]+/g) ?? [])].map(sessionKey) : []
        let at = -1
        if (kind === 'task-notification') {
          if (named.length) {
            for (const id of named) if (at < 0) at = bus.wakePending.findIndex(p => p.ids.includes(id))
            if (at < 0) at = bus.wakePending.findIndex(p => p.ids.length === 0)
          } else if (bus.wakePending.length) at = 0
        }
        if (at >= 0) {
          bus.wakePending.splice(at, 1)
          bus.guards.peer.push(await $.clock.now())
          await busLog($, bus, { type: 'wake', reason: 'wake_when_done completion' })
          peerTurn = true
        }
        bus.peerTurnPending = peerTurn
      }
    } catch {
      bus.errors += 1
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      bus.mainTurn = r.turnId ?? e.turnId
      if (bus.peerTurnPending) bus.peerTurns.add(bus.mainTurn)
      bus.peerTurnPending = false
    } else if (bus.mainTurn !== null && bus.peerTurns.has(bus.mainTurn)) {
      // spawn events carry no turn id: an agent first running while a peer-started main turn runs is that turn's work
      bus.peerAgents.add(e.agentId)
    }
    return r
  })


}
