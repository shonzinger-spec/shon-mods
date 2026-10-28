import type { EngineInterface, Register } from 'claude-code'

import { contextFor, findDefects, subject, toastFor, type Defect } from './lib'

let defects: Defect[] | null = null
// Each defect is toasted once a session, and told to Claude once for reads and
// shell calls; code that loads the file is told every time.
const toasted = new Set<string>()
const told = new Set<string>()

async function load($: EngineInterface): Promise<Defect[]> {
  try {
    const raw = JSON.parse(await $.fs.read(`${$.plugin.root}/bad-data.json`)) as { files?: Defect[] }
    defects = (raw.files ?? []).filter(d => d.id && d.match && d.defect)
  } catch {
    defects = []
  }
  return defects
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'bad-data', description: 'bad-data: reload bad-data.json and list the known-defective data files' })
    await load($)
    return r
  }).catch(($, e, next) => next(e))

  // Warn-only: never blocks, and a failure here never touches the call.
  on('tool.call', async ($, e, next) => {
    const subj = subject(String(e.tool), e as unknown as Record<string, unknown>)
    const found = subj ? findDefects(subj.text, defects ?? (await load($))) : []
    if (found.length === 0) return next(e)
    const fresh = found.filter(d => !toasted.has(d.id))
    if (fresh.length) {
      $.ui.toast(toastFor(fresh))
      for (const d of fresh) toasted.add(d.id)
    }
    const r = await next(e)
    if (r.deny !== undefined || r.isError) return r
    const tell = subj?.isCode ? found : found.filter(d => !told.has(d.id))
    if (tell.length === 0) return r
    for (const d of tell) told.add(d.id)
    return { ...r, context: [...(r.context ?? []), contextFor(tell)] }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'bad-data' }, async $ => {
    const list = await load($)
    return {
      text: list.length
        ? list.map(d => `• ${d.match.replace(/^regex:/, '')} — ${d.defect}${d.instead ? ` → ${d.instead}` : ''}`).join('\n')
        : `bad-data: no entries (check ${$.plugin.root}/bad-data.json)`,
    }
  })
}
