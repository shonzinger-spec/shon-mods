import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { ideaText, ledgerRuleOn, missingText, newestFirst, parseLedger, READ_CAP, summaryText, type ReadInfo } from './lib'
import {
  bandLine,
  classify,
  collect,
  createdMs,
  listText,
  parseScan,
  resolveKey,
  topLevelLegacy,
  verdictJson,
  type BandLine,
  type Entry,
  type Item,
} from './preregs'

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

async function ledgerLocation($: EngineInterface): Promise<{ home: string; path: string; shown: string }> {
  const home = (await $.env.get('HOME')) ?? ''
  const path = (await $.env.get('VERDICT_LEDGER')) ?? `${home}/Trading/_ledger/experiments.jsonl`
  return { home, path, shown: path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path }
}

async function answer($: EngineInterface, args: string): Promise<string> {
  const { home, path, shown } = await ledgerLocation($)
  const got = await readLedger($, path, shown)
  if (!got) {
    const policy = await readOr($, (await $.env.get('VERDICT_POLICY')) ?? `${home}/.claude/verdict/policy.json`)
    return missingText(shown, ledgerRuleOn(policy))
  }
  const led = parseLedger(got.text, got.isTail)
  const idea = args.trim()
  return idea ? ideaText(led, got.info, idea) : summaryText(led, got.info)
}

// ---- `/experiments open`: preregistrations still waiting on a verdict ----

const snap = atom({ plugin: 'experiment-ledger', key: 'snap' } as const, null)
const EVERY_MS = 30 * 60 * 1000
const ROOTS = ['Trading', 'propfarm-2026'] // under $HOME
const SCAN_TIMEOUT_MS = 20000

// Latest verdict per ledger slug (newest row wins). No ledger file means no verdicts, not an error.
async function ledgerVerdicts($: EngineInterface): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const { path, shown } = await ledgerLocation($)
  const got = await readLedger($, path, shown)
  if (!got) return out
  for (const r of newestFirst(parseLedger(got.text, got.isTail).rows)) {
    if (typeof r.slug === 'string' && r.slug && typeof r.verdict === 'string' && r.verdict && !out.has(r.slug)) out.set(r.slug, r.verdict.toUpperCase())
  }
  return out
}

// find the prereg files under the roots (BSD stat: macOS only). A root that does not exist is skipped; a
// find that exits non-zero with no output is a failed scan, with output a partial one that is still used.
async function scanFiles($: EngineInterface, home: string): Promise<{ entries: Entry[] } | { error: string }> {
  const entries: Entry[] = []
  let scanned = 0
  for (const name of ROOTS) {
    const root = `${home}/${name}`
    try {
      if ((await $.fs.stat(root)).kind !== 'directory') continue
    } catch {
      continue
    }
    scanned++
    try {
      const r = await $.process.run(
        ['find', root, '-maxdepth', '7', '(', '-path', '*/prereg/*.json', '-o', '-name', 'PREREGISTRATION_*.md', '-o', '-name', 'PREREG_*.sha256', ')',
          '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*', '-exec', 'stat', '-f', '%m %N', '{}', '+'],
        { timeoutMs: SCAN_TIMEOUT_MS },
      )
      if (r.exitCode !== 0 && !r.stdout.trim()) return { error: `find exited ${r.exitCode} under ${root}` }
      entries.push(...topLevelLegacy(parseScan(r.stdout), root))
    } catch (err) {
      return { error: `find failed under ${root} (${String(err)})` }
    }
  }
  return scanned === 0 ? { error: `none of ${ROOTS.map(r => `~/${r}`).join(', ')} exists` } : { entries }
}

async function ackedKeys($: EngineInterface): Promise<Set<string>> {
  const v = await $.store.get('acked')
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
}

async function scanItems($: EngineInterface): Promise<{ items: Item[] } | { error: string }> {
  const home = (await $.env.get('HOME')) ?? ''
  const files = await scanFiles($, home)
  if ('error' in files) return files
  const rows = collect(files.entries)
  // an open json prereg is as old as its created_at (the file mtime is only the fallback)
  for (const r of rows) {
    if (r.kind !== 'json' || r.resultMs !== null) continue
    const text = await readOr($, r.file)
    const ms = text === null ? null : createdMs(text)
    if (ms !== null) r.frozenMs = ms
  }
  const verdicts = await ledgerVerdicts($)
  const sibling = new Map<string, { slug: string; verdict: string } | null>()
  for (const r of rows) {
    if (r.kind !== 'json' || verdicts.has(r.slug)) continue
    if (!sibling.has(r.dir)) {
      const text = await readOr($, `${r.dir}/verdict.json`)
      sibling.set(r.dir, text === null ? null : verdictJson(text))
    }
    const v = sibling.get(r.dir)
    if (v && v.slug === r.slug) verdicts.set(r.slug, v.verdict.toUpperCase())
  }
  return { items: classify(rows, verdicts, await ackedKeys($), await $.clock.now()) }
}

// Rescan and set the band (or hide it when the scan fails or nothing is old enough).
async function refreshBand($: EngineInterface): Promise<void> {
  try {
    const s = await scanItems($)
    const line: BandLine | null = 'items' in s ? bandLine(s.items) : null
    await update($, snap, () => ({ line }))
  } catch {
    // never let a scan break the session
    await update($, snap, () => ({ line: null })).catch(() => undefined)
  }
}

const OPEN_USAGE = 'usage: /experiments open | open all | open ack <slug|tag> | open unack <slug|tag>'

async function openCommand($: EngineInterface, rest: string): Promise<string> {
  const [sub = '', ...more] = rest.split(/\s+/).filter(Boolean)
  const arg = more.join(' ')
  const verb = sub.toLowerCase()
  if (verb && verb !== 'all' && verb !== 'ack' && verb !== 'unack') return OPEN_USAGE
  if ((verb === 'ack' || verb === 'unack') && !arg) return `${OPEN_USAGE}\n${verb} needs a slug or tag`
  const s = await scanItems($)
  if ('error' in s) {
    await update($, snap, () => ({ line: null })).catch(() => undefined)
    return `prereg: could not scan (${s.error})`
  }
  let note = ''
  if (verb === 'ack' || verb === 'unack') {
    const r = resolveKey(s.items, arg)
    if (!('key' in r)) {
      return r.matches.length ? `"${arg}" is ambiguous: ${r.matches.join(', ')}` : `no prereg matches "${arg}" (/experiments open all lists every one)`
    }
    const acked = await ackedKeys($)
    if (verb === 'ack') acked.add(r.key)
    else acked.delete(r.key)
    await $.store.set('acked', [...acked].sort())
    for (const i of s.items) i.acked = acked.has(i.key)
    note = `${verb === 'ack' ? 'acked' : 'unacked'} ${r.key}\n`
  }
  await update($, snap, () => ({ line: bandLine(s.items) }))
  return note + listText(s.items, verb === 'all')
}

export const register: Register = on => {
  let isTicking = false

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'experiments',
      description:
        'experiment-ledger: rows write_verdict() logged; /experiments for a summary, /experiments <idea> for one idea and its kill status, /experiments open for preregistrations with no verdict yet',
    })
    if (!isTicking) {
      isTicking = true
      await $.clock.after(50, () => void refreshBand($))
      await $.clock.every(EVERY_MS, () => void refreshBand($))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'experiments' }, async ($, e) => {
    const m = /^\s*open(?:\s+([\s\S]*))?$/i.exec(e.args)
    if (m) {
      try {
        return { text: await openCommand($, m[1] ?? '') }
      } catch (err) {
        return { text: `prereg: could not scan (${String(err)})` }
      }
    }
    try {
      return { text: await answer($, e.args) }
    } catch (err) {
      return { text: `could not read the ledger (${String(err)})` }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (e.props.hasSurvey || !s?.line) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // draw above whatever the rest of the chain draws, so the other bands still show
    const below = await next(e)
    return (
      <Box flexDirection="column">
        <Text color={s.line.color}>{s.line.text}</Text>
        {below}
      </Box>
    )
  })
}
