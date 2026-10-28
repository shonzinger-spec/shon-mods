import type { EngineInterface, Register } from 'claude-code'

import { ideaText, ledgerRuleOn, missingText, parseLedger, READ_CAP, summaryText, type ReadInfo } from './lib'

async function readOr($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

// The ledger's text, or null when there is no file. Past READ_CAP bytes only the tail is read
// (`tail -c`, since $.fs.read has no offset); if that fails, the whole file is read and cut.
async function readLedger($: EngineInterface, path: string, shown: string): Promise<{ text: string; isTail: boolean; info: ReadInfo } | null> {
  let size: number
  try {
    const st = await $.fs.stat(path)
    if (st.kind !== 'file') return null
    size = st.size
  } catch {
    return null
  }
  if (size <= READ_CAP) {
    const text = await readOr($, path)
    return text === null ? null : { text, isTail: false, info: { path: shown, size, tailBytes: null } }
  }
  const info: ReadInfo = { path: shown, size, tailBytes: READ_CAP }
  try {
    const r = await $.process.run(['tail', '-c', String(READ_CAP), path], { timeoutMs: 15000 })
    if (r.exitCode === 0 && !r.isStdoutTruncated) return { text: r.stdout, isTail: true, info }
  } catch {
    // fall through to the whole-file read
  }
  const text = await readOr($, path)
  return text === null ? null : { text: text.slice(-READ_CAP), isTail: true, info }
}

async function answer($: EngineInterface, args: string): Promise<string> {
  const home = (await $.env.get('HOME')) ?? ''
  const path = (await $.env.get('VERDICT_LEDGER')) ?? `${home}/Trading/_ledger/experiments.jsonl`
  const shown = path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
  const got = await readLedger($, path, shown)
  if (!got) {
    const policy = await readOr($, (await $.env.get('VERDICT_POLICY')) ?? `${home}/.claude/verdict/policy.json`)
    return missingText(shown, ledgerRuleOn(policy))
  }
  const led = parseLedger(got.text, got.isTail)
  const idea = args.trim()
  return idea ? ideaText(led, got.info, idea) : summaryText(led, got.info)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'experiments',
      description: 'experiment-ledger: rows write_verdict() logged; /experiments for a summary, /experiments <idea> for one idea and its kill status',
    })
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'experiments' }, async ($, e) => {
    try {
      return { text: await answer($, e.args) }
    } catch (err) {
      return { text: `could not read the ledger (${String(err)})` }
    }
  })
}
