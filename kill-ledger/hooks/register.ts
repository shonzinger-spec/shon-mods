import type { EngineInterface, Register } from 'claude-code'

import { contextText, line, match, ownWords, SKIP_ORIGIN, toastText, type Index } from './lib'

let index: Index | null = null
// Files already raised this session: each verdict is shown once.
const seen = new Set<string>()

// Rebuild the index from memory (cheap: ~80 small files), then read it.
async function load($: EngineInterface): Promise<Index | null> {
  const root = $.plugin.root
  try {
    await $.process.run(['python3', `${root}/scripts/build_index.py`], { timeoutMs: 20000 })
  } catch {
    // keep whatever index is on disk
  }
  try {
    index = JSON.parse(await $.fs.read(`${root}/data/kill_index.json`)) as Index
  } catch {
    index = null
  }
  return index
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'kills', description: 'kill-ledger: list memory verdicts for a strategy name, e.g. /kills ORB' })
    await load($)
    return r
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || SKIP_ORIGIN.has(e.origin?.kind ?? '')) return next(e)
    const idx = index ?? (await load($))
    if (!idx) return next(e)
    const said = ownWords(e.text)
    if (!said) return next(e)
    const hits = match(said, idx, seen)
    if (hits.length === 0) return next(e)
    for (const h of hits) seen.add(h.entry.file)
    $.ui.toast(toastText(hits))
    return next({ ...e, context: [...(e.context ?? []), contextText(hits, idx.memory_dir)] })
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'kills' }, async ($, e) => {
    const idx = await load($)
    if (!idx) return { text: 'kill-ledger: no index (scripts/build_index.py failed?)' }
    const q = e.args.trim()
    if (!q) return { text: 'Usage: /kills <strategy name>, e.g. /kills ORB' }
    const hits = match(q, idx, new Set(), 20)
    return { text: hits.length ? hits.map(line).join('\n') : `kill-ledger: no killed/caution/live entry mentions "${q}".` }
  })
}
