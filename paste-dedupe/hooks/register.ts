import type { EngineInterface, Register } from 'claude-code'

import { dedupe, stillSaid, type Entry } from './lib.ts'

// Prompts a person typed or pasted: the terminal composer, a remote bridge, an SDK host (the desktop app).
const PERSON = new Set(['composer', 'bridge', 'sdk'])

// The text of each user message the transcript holds now; null when it cannot be read.
async function userTexts($: EngineInterface): Promise<string[] | null> {
  const msgs = await $.session.messages()
  return Array.isArray(msgs) ? msgs.filter(m => m.role === 'user' && m.text).map(m => m.text) : null
}

export const register: Register = on => {
  // Earlier prompts this session, and the number of the last one.
  let history: Entry[] = []
  let count = 0
  const reset = () => {
    history = []
    count = 0
  }

  // A new or compacted conversation no longer holds the earlier pastes.
  on('session.start', async ($, e, next) => {
    reset()
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (r.skip === undefined) reset()
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || !PERSON.has(e.origin?.kind ?? '')) return next(e)
    // Keep only the prompts the transcript still holds. No event says a rewind,
    // an edit or a /clear removed messages, so the transcript is asked each time;
    // numbering then follows the prompts Claude can still read.
    if (history.length > 0) {
      const said = await userTexts($)
      if (said) {
        history = stillSaid(history, said)
        count = history.at(-1)?.msg ?? 0
      }
    }
    const d = dedupe(e.text, history, ++count)
    const own = history.at(-1)
    if (d.replaced.length > 0) {
      const lines = d.replaced.reduce((s, r) => s + r.lines, 0)
      const msgs = [...new Set(d.replaced.map(r => r.msg))].join(', ')
      $.ui.toast(`paste-dedupe: ${lines} repeated lines sent as "same as message ${msgs}"`)
    }
    const r = await next(d.replaced.length > 0 ? { ...e, text: d.text } : e)
    // What entered is what the transcript will hold; a dropped prompt has none
    // and leaves the history at the next sync.
    if (own && typeof r.text === 'string') own.sent = r.text
    return r
  }).catch(($, e, next) => next(e))
}
