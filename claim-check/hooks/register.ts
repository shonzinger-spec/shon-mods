import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import { check, claimsReport, Corpus, extractClaims, toastText, type Checked } from './lib'

// Module memory holds what the transcript does not: context other hooks
// injected beside prompts and tool results. The transcript itself is re-read at
// every check, so a resume, a reload or a worker respawn loses no tool result.
const corpus = new Corpus()
let last: Checked[] | null = null

function resultText(r: { text?: string; result?: unknown }): string {
  if (typeof r.text === 'string') return r.text
  if (typeof r.result === 'string') return r.result
  try {
    return JSON.stringify(r.result) ?? ''
  } catch {
    return ''
  }
}

function finalReply(rows: SessionMessage[], answer: string): string {
  if (answer) return answer
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.role === 'assistant') return rows[i]!.text
  return ''
}

/** The main conversation's user prompts and tool results, as a capped corpus. */
function transcriptCorpus(rows: SessionMessage[]): Corpus {
  const c = new Corpus()
  for (const row of rows) {
    if (row.role !== 'user') continue
    c.add(row.text)
    for (const tr of row.toolResults ?? []) c.add(tr.text)
  }
  return c
}

async function mainRows($: EngineInterface): Promise<SessionMessage[]> {
  try {
    return await $.session.messages()
  } catch {
    return []
  }
}

function* allNumbers(...corpora: Corpus[]): Generator<string> {
  for (const c of corpora) yield* c.numbers()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    corpus.clear()
    last = null
    const r = await next(e)
    await $.command.register({ name: 'claims', description: 'claim-check: metrics in the last reply, backed or not, with the nearest corpus number' })
    return r
  }).catch(($, e, next) => next(e))

  // A /clear (or a resume) starts another conversation in this process with no
  // session.start: the old conversation's numbers must not back the new one.
  on('session.end', async ($, e, next) => {
    corpus.clear()
    last = null
    return next(e)
  }).catch(($, e, next) => next(e))

  // Context entered beside the prompt counts: hooks above this one put it in
  // e.context, core's answer echoes all that arrived (hooks below included).
  on('prompt.submit', async ($, e, next) => {
    corpus.add(e.text)
    for (const c of e.context ?? []) corpus.add(c)
    const r = await next(e)
    for (const c of r.context ?? []) corpus.add(c)
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    corpus.add(resultText(r))
    for (const c of r.context ?? []) corpus.add(c)
    return r
  }).catch(($, e, next) => next(e))

  // Main loop only: a subagent's report reaches the corpus as its Agent tool result.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return r
    const rows = await mainRows($)
    const fromTranscript = transcriptCorpus(rows)
    const checked = extractClaims(finalReply(rows, e.answer)).map(c => check(c, allNumbers(fromTranscript, corpus)))
    last = checked
    const t = toastText(checked)
    if (t) $.ui.toast(t)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'claims' }, async () => ({ text: claimsReport(last) }))
}
