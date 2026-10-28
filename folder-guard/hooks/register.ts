import type { EngineInterface, Hook, Register } from 'claude-code'

import { denyText, isHub, suggest, topItem } from './lib'
import { targetsOf } from './shell'

type Input = Parameters<Hook<'tool.call'>>[1]
let home = ''

// Paths this call may create, absolute, with the text that says what it is.
async function created($: EngineInterface, e: Input): Promise<{ paths: string[]; text: string }> {
  const t = String(e.tool)
  const rec = e as unknown as Record<string, unknown>
  if (t === 'Write') return { paths: [String(rec.file_path ?? '')], text: String(rec.content ?? '') }
  if (t === 'NotebookEdit') return { paths: [String(rec.notebook_path ?? '')], text: String(rec.new_source ?? '') }
  if (t === 'Bash') {
    const cmd = String(rec.command ?? '')
    const cwd = (await $.session.cwd()) || home
    return { paths: targetsOf(cmd, cwd, home, 'create'), text: cmd }
  }
  return { paths: [], text: '' }
}

async function verdict($: EngineInterface, e: Input): Promise<string | null> {
  const { paths, text } = await created($, e)
  for (const p of paths) {
    const top = topItem(p, home)
    if (!top) continue
    if (isHub(top.item, home)) continue // category hub folder itself
    if (await $.fs.exists(top.item)) continue // existing file or project folder: allowed
    return denyText(p, top.banned, suggest(p, text, home, top.banned), home)
  }
  return null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    home = (await $.env.get('HOME')) ?? home
    return r
  }).catch(($, e, next) => next(e))

  // A guard that fails lets the call through: a broken check must never block normal work.
  on('tool.call', async ($, e, next) => {
    const t = String(e.tool)
    if (t !== 'Write' && t !== 'Bash' && t !== 'NotebookEdit') return next(e)
    const why = await verdict($, e)
    return why ? { deny: why } : next(e)
  }).catch(($, e, next) => next(e))
}
