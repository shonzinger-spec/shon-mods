import type { EngineInterface, Register } from 'claude-code'

import { lookupText, parseIndex, summaryText, unreadableText } from './lib'

let running = false

// The build writes index.lookup.json (only the fields /data shows, about 40% of
// index.json) beside index.json; /data reads it first so it stays under the
// 4 MiB read limit for longer, and falls back to index.json from older builds.
async function loadIndexText($: EngineInterface): Promise<{ text: string | null; problem?: string }> {
  const dir = `${(await $.env.get('HOME')) ?? ''}/Trading/_data`
  for (const name of ['index.lookup.json', 'index.json']) {
    const path = `${dir}/${name}`
    try {
      return { text: await $.fs.read(path) }
    } catch (err) {
      if (String(err).includes('ENOENT')) continue
      const size = await $.fs.stat(path).then(s => s.size, () => null)
      return { text: null, problem: unreadableText(path, size, String(err)) }
    }
  }
  return { text: null }
}

// Runs detached from the command: the build can take minutes, so the command
// answers "started" at once and this toasts when the script exits.
async function refresh($: EngineInterface): Promise<void> {
  try {
    const r = await $.process.run(['python3', `${$.plugin.root}/scripts/build_data_index.py`, '--max-seconds', '540'], { timeoutMs: 600_000 })
    $.ui.toast(summaryText(r.stdout))
  } catch (err) {
    $.ui.toast(`data-index failed: ${String(err).slice(0, 200)}`)
  } finally {
    running = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'dataindex', description: 'data-index: rebuild ~/Trading/_data/index.json in the background (cached, fast on refresh)' })
    await $.command.register({ name: 'data', description: 'data-index: look up bar files by symbol, timeframe or path text, e.g. /data NQ 1m' })
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'dataindex' }, async $ => {
    if (running) return { text: 'data-index: a build is already running; a toast says when it is done' }
    running = true
    void refresh($)
    return { text: 'data-index: started; a toast says when ~/Trading/_data/index.json is ready' }
  })

  on('command.run', { command: 'data' }, async ($, e) => {
    const { text, problem } = await loadIndexText($)
    if (problem) return { text: problem }
    return { text: lookupText(text == null ? null : parseIndex(text), e.args) }
  })
}
