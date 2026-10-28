import type { EngineInterface, Hook, Register } from 'claude-code'

import { denyText, isResultFor, preregOf, type Prereg } from './lib'
import { targetsOf } from './shell'

let cwd = '/'
let home = ''

type Input = Parameters<Hook<'tool.call'>>[1]

// Every path this call would write, absolute (Bash: against the shell's cwd now).
function targets(e: Input, cwd: string): string[] {
  const t = String(e.tool)
  const rec = e as unknown as Record<string, unknown>
  if (t === 'Write' || t === 'Edit' || t === 'MultiEdit') return [String(rec.file_path ?? '')]
  if (t === 'NotebookEdit') return [String(rec.notebook_path ?? '')]
  if (t === 'Bash') {
    return targetsOf(String(rec.command ?? ''), cwd, home)
  }
  return []
}

function touchesPrereg(e: Input): boolean {
  try {
    return targets(e, cwd).some(p => preregOf(p) !== null)
  } catch {
    return false
  }
}

async function lockMarker($: EngineInterface, p: Prereg): Promise<string | null> {
  for (const m of p.markers) if (await $.fs.exists(m)) return m
  if (p.listDir && p.listPrefix) {
    try {
      for (const ent of await $.fs.list(p.listDir)) {
        if (isResultFor(ent.name, p.listPrefix)) return `${p.listDir}/${ent.name}`
      }
    } catch {
      // no results/ folder
    }
  }
  return null
}

const PROMPT = (root: string, slug: string, rest: string, dir: string) =>
  [
    `[prereg] Pre-register test "${slug}" BEFORE any result is seen. The user's description: ${rest || '(none given)'}`,
    '1. From the description, settle: the hypothesis (one sentence, falsifiable), the data and period, and EVERY pass/fail gate as metric, operator, threshold (e.g. PF >= 1.3, t >= 2.0, spa_p <= 0.05, n_trades >= 100). Ask the user for anything missing; never invent a threshold.',
    `2. Run: python3 "${root}/scripts/prereg.py" create --dir "${dir}" --slug "${slug}" --hypothesis "..." --data "..." --period "..." --gate "name|metric|op|threshold" (one --gate per gate)`,
    '3. Show the user the file path, the sha256 and the gates. Do not run the test in this turn.',
    `When results exist later: python3 "${root}/scripts/prereg.py" judge ${slug} <metrics.json> --dir "${dir}", then prereg.py result ${slug} <results file> --dir "${dir}" — that locks the pre-registration against edits.`,
  ].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    cwd = e.cwd || cwd
    home = (await $.env.get('HOME')) ?? home
    await $.command.register({
      name: 'prereg',
      description: 'Pre-register a test: /prereg <slug> <hypothesis, data, gates>. Writes prereg/<slug>.json with a SHA256; locked once results exist.',
    })
    return r
  }).catch(($, e, next) => next(e))

  // Guard: refuse writes to a pre-registration whose results exist.
  on('tool.call', async ($, e, next) => {
    const t = String(e.tool)
    if (t !== 'Bash' && t !== 'Write' && t !== 'Edit' && t !== 'MultiEdit' && t !== 'NotebookEdit') return next(e)
    if (t === 'Bash') cwd = (await $.session.cwd()) || cwd
    for (const path of targets(e, cwd)) {
      const p = preregOf(path)
      if (!p) continue
      const marker = await lockMarker($, p)
      if (marker) return { deny: denyText(path, p, marker) }
    }
    return next(e)
  }).catch(($, e, next) =>
    next.called || !touchesPrereg(e) ? next(e) : { deny: 'prereg: the lock check failed on a pre-registration file; not editing it blind.' },
  )

  on('command.run', { command: 'prereg' }, async ($, e) => {
    const [slug = '', ...rest] = e.args.trim().split(/\s+/)
    if (!slug || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(slug)) {
      return { text: 'Usage: /prereg <slug> <hypothesis, data/period, gates e.g. PF>=1.3 t>=2 spa_p<=0.05>' }
    }
    const dir = `${cwd.replace(/\/+$/, '')}/prereg`
    await $.prompt.submit({ text: PROMPT($.plugin.root, slug, rest.join(' '), dir) })
    return { text: `Pre-registration "${slug}" queued: Claude will write ${dir}/${slug}.json with its SHA256.` }
  })
}
