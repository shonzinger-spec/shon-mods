import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CqCommitResult, CqGroup, CqRepo, CqScan } from '../types'

const report = atom({ plugin: 'commit-queue', key: 'report' } as const, null)
const FIRST_SCAN_MS = 50
const FALLBACK_INTERVAL_MIN = 10

let isTicking = false

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const short = (err: unknown) => String(err instanceof Error ? err.message : err).slice(0, 120)

/** Runs scripts/commit_queue.py; every subcommand prints one JSON object, even when it refuses. */
async function py<T>($: EngineInterface, args: string[], timeoutMs: number): Promise<T> {
  const run = await $.process.run(['python3', `${$.plugin.root}/scripts/commit_queue.py`, ...args], { timeoutMs })
  try {
    return JSON.parse(run.stdout) as T
  } catch {
    throw new Error(run.stderr.trim().split('\n').pop() || `exit ${run.exitCode}`)
  }
}

/** Read-only scan; the band shows a failure as amber instead of throwing. */
async function scan($: EngineInterface): Promise<CqScan> {
  try {
    const out = await py<CqScan | { ok: false; error: string }>($, ['scan'], 90000)
    if (!out.ok) throw new Error(out.error)
    await update($, report, () => ({ scan: out, error: null }))
    return out
  } catch (err) {
    await update($, report, () => ({ scan: null, error: short(err) }))
    throw err
  }
}

// The first scan runs just after start; later ones follow config.json's interval_min.
async function start($: EngineInterface): Promise<void> {
  if (isTicking) return
  isTicking = true
  const first = async () => {
    const s = await scan($).catch(() => null)
    await $.clock.every(Math.max(1, s?.interval_min ?? FALLBACK_INTERVAL_MIN) * 60000, () => void scan($).catch(() => {}))
  }
  await $.clock.after(FIRST_SCAN_MS, () => void first())
}

function table(s: CqScan): string {
  const t = s.totals
  const lines = [`${plural(t.files, 'change')} in ${plural(t.repos, 'repo')}, ${plural(t.groups, 'group')}`]
  for (const r of s.repos) {
    if (!r.readable) lines.push(`${r.name}: unreadable (${r.error ?? 'unknown'})`)
    else if (r.groups.length) {
      lines.push(`${r.name} [${r.branch ?? '?'}]${r.truncated ? ' (too many changes: first 5000 only, commit by hand)' : ''}`)
      const w = Math.max(...r.groups.map(g => g.group.length))
      for (const g of r.groups) {
        lines.push(`  ${g.group.padEnd(w)}  ${plural(g.file_count, 'file')}  +${g.added}/-${g.deleted}${g.withheld.length ? `  withheld ${g.withheld.length}` : ''}`)
      }
    }
  }
  return lines.join('\n')
}

function findGroup(s: CqScan, ref: string): { repo: CqRepo; group: CqGroup } | string {
  const hits = s.repos.flatMap(repo => repo.groups.filter(g => g.id === ref || g.group === ref).map(group => ({ repo, group })))
  if (hits.length === 1) return hits[0]!
  return hits.length ? `${ref} is in several repos; use one of: ${hits.map(h => h.group.id).join(', ')}` : `no changes waiting in ${ref}`
}

async function ask($: EngineInterface, question: string, options: string[]): Promise<string> {
  try {
    return await $.ui.ask(question, options)
  } catch {
    return '' // dismissed: same as Skip
  }
}

/** Asks about one group; resolves to the commit message ('' = the script's default) or null to skip. */
async function consent($: EngineInterface, repo: CqRepo, g: CqGroup): Promise<string | null> {
  const ident = repo.identity!
  const held = g.withheld.length ? ` Withheld: ${g.withheld.slice(0, 5).map(w => w.path).join(', ')}${g.withheld.length > 5 ? ', ...' : ''}` : ''
  const answer = await ask($, `Commit ${g.id} on ${g.branch ?? '?'}: ${plural(g.allowed_count, 'file')} +${g.added}/-${g.deleted} as ${ident.name}?${held}`, ['Commit', 'Skip', 'Edit message'])
  if (answer === 'Commit') return ''
  if (answer !== 'Edit message') return null
  const msg = (await ask($, `Commit message for ${g.id}? (type your own under Other)`, ['Use the default', 'Skip'])).trim()
  if (!msg || msg === 'Skip') return null
  return msg === 'Use the default' ? '' : msg
}

async function commit($: EngineInterface, ref: string): Promise<string> {
  const s = await scan($)
  const targets: { repo: CqRepo; group: CqGroup }[] = []
  if (ref) {
    const hit = findGroup(s, ref)
    if (typeof hit === 'string') return hit
    targets.push(hit)
  } else {
    for (const repo of s.repos) for (const group of repo.groups) targets.push({ repo, group })
  }
  if (!targets.length) return 'nothing waiting.'
  const lines: string[] = []
  for (const { repo, group: g } of targets) {
    if (repo.truncated) lines.push(`- ${g.id}: too many changes to scan safely; commit this repo by hand`)
    else if (!repo.identity) lines.push(`- ${g.id}: no real git identity (set identity in config.json); not asked`)
    else if (!g.allowed_count) lines.push(`- ${g.id}: every file is withheld (${g.withheld.map(w => w.path).join(', ')}); commit by hand`)
    else {
      const msg = await consent($, repo, g)
      if (msg === null) lines.push(`- ${g.id}: skipped`)
      else {
        try {
          const r = await py<CqCommitResult>($, ['commit', g.repo, g.group, ...(msg ? ['-m', msg] : []), '--expect-hash', g.hash], 240000)
          lines.push(r.ok ? `- ${g.id}: committed ${r.sha} (${plural(r.files ?? 0, 'file')}) as ${r.author} <${r.email}>${r.has_trailer ? ' [a hook added a trailer]' : ''}` : `- ${g.id}: NOT committed: ${r.error ?? 'unknown error'}`)
        } catch (err) {
          lines.push(`- ${g.id}: NOT committed: ${short(err)}`)
        }
      }
    }
  }
  await scan($).catch(() => {})
  return lines.join('\n')
}

async function stat($: EngineInterface, ref: string): Promise<string> {
  const hit = findGroup(await scan($), ref)
  if (typeof hit === 'string') return hit
  const r = await py<{ ok: boolean; error?: string; files: { path: string; xy: string; added: number; deleted: number; withheld: string | null }[] }>($, ['stat', hit.repo.repo, hit.group.group], 90000)
  if (!r.ok) return `${r.error ?? 'stat failed'}`
  return [`${hit.group.id} [${hit.group.branch ?? '?'}]`, ...r.files.map(f => `  ${f.xy}  ${f.path}  +${f.added}/-${f.deleted}${f.withheld ? `  WITHHELD (${f.withheld})` : ''}`)].join('\n')
}

export const register: Register = (on, options) => {
  void options
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'review-commits', description: 'commit-queue: list waiting changes by repo and folder; "stat <id>" shows a diffstat; "commit [id]" commits a group only after you answer Commit' })
    await start($)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'review-commits' }, async ($, e) => {
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    const ref = rest.join(' ')
    try {
      if (sub === 'commit') return { text: await commit($, ref) }
      if (sub === 'stat') return { text: ref ? await stat($, ref) : 'usage: /review-commits stat <repo:group>' }
      return { text: table(await scan($)) }
    } catch (err) {
      return { text: `scan failed: ${short(err)}` }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, report)
    if (e.props.hasSurvey || !r) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    let line: string
    if (r.error !== null) line = `commit-queue: scan failed (${r.error}) - /review-commits`
    else if (r.scan.totals.files === 0) return next(e)
    else {
      const t = r.scan.totals
      line = `${plural(t.files, 'change')} waiting for review in ${plural(t.repos, 'repo')} (${plural(t.groups, 'group')})${t.unreadable ? `, ${t.unreadable} unreadable` : ''} - /review-commits`
    }
    const below = await next(e)
    return (
      <Box flexDirection="column">
        <Text color="yellow" dimColor>
          {line}
        </Text>
        {below}
      </Box>
    )
  })
}
