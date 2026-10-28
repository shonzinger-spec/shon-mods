import type { EngineInterface, Hook, Register } from 'claude-code'

import { costsOf, costsText, EXTRA_ROOTS, floorFor, isTradingPy, report, scan, toastText, type Costs } from './lib'

let roots: string[] | null = null
let costs: Costs | null | undefined

async function home($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? ''
}

// The same files verdict.py reads ($VERDICT_COSTS / $VERDICT_POLICY override).
async function costsPath($: EngineInterface): Promise<string> {
  return (await $.env.get('VERDICT_COSTS')) ?? `${await home($)}/.claude/mods-src/bad-data/bad-data.json`
}

async function policyPath($: EngineInterface): Promise<string> {
  return (await $.env.get('VERDICT_POLICY')) ?? `${await home($)}/.claude/verdict/policy.json`
}

// Parsed JSON, or null when the file is missing or unreadable.
async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    return JSON.parse(await $.fs.read(path)) as unknown
  } catch {
    return null
  }
}

async function loadCosts($: EngineInterface): Promise<Costs | null> {
  if (costs === undefined) costs = costsOf(await readJson($, await costsPath($)))
  return costs
}

// ~/Trading itself, every repo it links to (resolved), and the fixed extras (as in leak-lint).
async function tradingRoots($: EngineInterface): Promise<string[]> {
  if (roots) return roots
  const h = await home($)
  const found = new Set<string>([`${h}/Trading`, ...EXTRA_ROOTS.map(d => `${h}/${d}`)])
  try {
    for (const ent of await $.fs.list(`${h}/Trading`)) {
      if (!ent.isLink) continue
      try {
        const st = await $.fs.stat(`${h}/Trading/${ent.name}`, { resolve: true })
        if (st.realPath) found.add(st.realPath)
      } catch {
        // a dangling link: skip it
      }
    }
  } catch {
    // no ~/Trading: the extras still apply
  }
  roots = [...found]
  return roots
}

type Added = { file: string; text: string; isWholeFile: boolean }

// Only the text a call adds: a Write's whole content, an Edit's new_string.
function added(e: Parameters<Hook<'tool.call'>>[1]): Added | null {
  if (e.tool === 'Write') return { file: e.file_path, text: e.content, isWholeFile: true }
  if (e.tool === 'Edit') return { file: e.file_path, text: e.new_string, isWholeFile: false }
  if (String(e.tool) === 'MultiEdit') {
    const m = e as unknown as { file_path: string; edits?: { new_string: string }[] }
    return { file: m.file_path, text: (m.edits ?? []).map(x => x.new_string).join('\n'), isWholeFile: false }
  }
  return null
}

const lint: Hook<'tool.call'> = async ($, e, next) => {
  const r = await next(e)
  if (r.deny !== undefined || r.isError) return r
  const add = added(e)
  if (!add || !isTradingPy(add.file, await tradingRoots($))) return r
  // Whether the file is an NQ/MNQ file is a whole-file question: after an Edit
  // read the file as it now is.
  let whole = add.text
  if (!add.isWholeFile) {
    try {
      whole = await $.fs.read(add.file)
    } catch {
      // unreadable: judge on the new text alone
    }
  }
  const floor = floorFor(whole, await loadCosts($))
  const found = scan(add.text, floor, whole)
  if (found.length === 0) return r
  $.ui.toast(toastText(add.file, found))
  return { ...r, context: [...(r.context ?? []), report(add.file, found, floor, add.isWholeFile)] }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'costs', description: 'cost-gate: the measured round-trip cost table and whether the cost_gate policy is on' })
    await tradingRoots($)
    await loadCosts($)
    return r
  }).catch(($, e, next) => next(e))

  // Warn-only: a failure here must never touch the tool call itself.
  on('tool.call', lint).catch(($, e, next) => next(e))

  on('command.run', { command: 'costs' }, async $ => {
    const cp = await costsPath($)
    const pp = await policyPath($)
    const raw = await readJson($, cp)
    costs = costsOf(raw)
    return { text: costsText(raw, cp, await readJson($, pp), pp) }
  })
}
