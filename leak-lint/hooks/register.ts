import type { EngineInterface, Hook, Register } from 'claude-code'

import { EXTRA_ROOTS, isTradingPy, report, scan, toastText } from './lib'

let roots: string[] | null = null

// ~/Trading itself, every repo it links to (resolved), and the fixed extras.
async function tradingRoots($: EngineInterface): Promise<string[]> {
  if (roots) return roots
  const home = (await $.env.get('HOME')) ?? ''
  const found = new Set<string>([`${home}/Trading`, ...EXTRA_ROOTS.map(d => `${home}/${d}`)])
  try {
    for (const ent of await $.fs.list(`${home}/Trading`)) {
      if (!ent.isLink) continue
      try {
        const st = await $.fs.stat(`${home}/Trading/${ent.name}`, { resolve: true })
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
  const found = scan(add.text)
  if (found.length === 0) return r
  $.ui.toast(toastText(add.file, found))
  return { ...r, context: [...(r.context ?? []), report(add.file, found, add.isWholeFile)] }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await tradingRoots($)
    return r
  }).catch(($, e, next) => next(e))

  // Warn-only: a failure here must never touch the tool call itself.
  // One hook for every tool; `added` picks out Write, Edit and MultiEdit.
  on('tool.call', lint).catch(($, e, next) => next(e))
}
