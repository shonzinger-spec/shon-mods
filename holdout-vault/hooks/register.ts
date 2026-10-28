import type { EngineInterface, Hook, Register } from 'claude-code'

import { askText, burnLine, burnedSlugs, entryFor, expandHome, globDir, parseVault, readHits, readOnlyText, targetHits, textNames, type Entry, type Vault } from './lib'
import { resolvePath, segments, targetsOf, writtenFiles, type Seg } from './shell'

let home = ''
let cwd = '/'
let vault: Vault = { ledger: '~/Trading/_ledger/holdout_burns.jsonl', files: [] }
const realMatch = new Map<string, string>() // entry match -> its realpath (a glob: its folder's realpath)

type Input = Parameters<Hook<'tool.call'>>[1]
const WRITERS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const DC = 'mcp__plugin_desktop-commander_desktop-commander__'

// How a tool touches files: reads named paths, runs shell text, or writes a path.
type Kind = 'read' | 'shell' | 'write' | null
function kindOf(t: string): Kind {
  if (t === 'Read' || t === 'Grep' || t === `${DC}read_file` || t === `${DC}read_multiple_files`) return 'read'
  if (t === 'Bash' || t === `${DC}start_process` || t === `${DC}interact_with_process`) return 'shell'
  if (WRITERS.has(t) || t === `${DC}write_file` || t === `${DC}edit_block`) return 'write'
  return null
}
const shellText = (t: string, input: Record<string, unknown>) =>
  String((t === `${DC}interact_with_process` ? input.input : input.command) ?? '')

const ledgerPath = () => expandHome(vault.ledger, home)
const matchOf = (e: Entry) => {
  const m = expandHome(e.match, home)
  const r = realMatch.get(m)
  return r && r !== m ? [m, r] : [m]
}

async function realOf($: EngineInterface, p: string): Promise<string | null> {
  try {
    return (await $.fs.stat(p, { resolve: true })).realPath ?? null
  } catch {
    return null
  }
}

// A path as written and its realpath; for a glob, its folder's realpath plus the
// glob part (a glob through a symlinked hub folder still meets the real spelling).
async function spellingsOf($: EngineInterface, p: string): Promise<string[]> {
  const g = globDir(p)
  const dir = g ? await realOf($, g[0]) : null
  const real = g ? (dir ? `${dir}${g[1]}` : null) : await realOf($, p)
  return real && real !== p ? [p, real] : [p]
}

async function load($: EngineInterface): Promise<void> {
  home = (await $.env.get('HOME')) ?? home
  let text: string | null = null
  try {
    text = await $.fs.read(`${$.plugin.root}/vault.json`)
  } catch {
    // no vault: nothing sealed
  }
  let raw: unknown = null
  let invalid = false
  try {
    raw = text === null ? null : JSON.parse(text)
  } catch {
    invalid = true
  }
  const parsed = parseVault(raw, vault.ledger)
  vault = parsed.vault
  if (invalid) $.ui.toast('holdout-vault: vault.json is not valid JSON; nothing is sealed')
  else if (text !== null && parsed.problem) $.ui.toast(`holdout-vault: ${parsed.problem}`)
  realMatch.clear()
  for (const e of vault.files) {
    if (e.confirmed !== true) continue
    const m = expandHome(e.match, home)
    const sp = await spellingsOf($, m)
    if (sp[1]) realMatch.set(m, sp[1])
  }
}

async function burned($: EngineInterface): Promise<Set<string>> {
  let text = ''
  try {
    text = await $.fs.read(ledgerPath())
  } catch {
    // no ledger yet
  }
  return burnedSlugs(text, vault.files)
}

async function burn($: EngineInterface, slug: string, path: string): Promise<string | null> {
  let text = ''
  try {
    text = await $.fs.read(ledgerPath())
  } catch {
    // first burn
  }
  if (burnedSlugs(text, vault.files).has(slug)) return null
  const sep = text && !text.endsWith('\n') ? '\n' : ''
  try {
    await $.fs.write(ledgerPath(), `${text}${sep}${burnLine(slug, path, new Date(await $.clock.now()))}\n`)
    return `holdout-vault: BURNED "${slug}" (${path}) -> ${ledgerPath()}`
  } catch (err) {
    return `holdout-vault: could not write the BURNED line for "${slug}" to ${ledgerPath()}: ${String(err)}`
  }
}

async function entryAt($: EngineInterface, path: string): Promise<Entry | null> {
  if (!vault.files.some(e => e.confirmed === true)) return null
  const real = await realOf($, path)
  return entryFor(real && real !== path ? [path, real] : [path], vault.files, matchOf)
}

// Each segment of a command with the folder it runs in, following `cd` as
// shell.ts targetsOf does (a `cd` to something unknowable keeps the old folder).
function walk(cmd: string, at: string): { seg: Seg; dir: string }[] {
  let dir = at
  const out: { seg: Seg; dir: string }[] = []
  for (const s of segments(cmd)) {
    const unparen = (x: string) => x.replace(/^\(+/, '').replace(/\)+$/, '')
    const words = s.words.map((x, i) => (i === 0 || i === s.words.length - 1 ? unparen(x) : x))
    const seg = { words, redirects: s.redirects.map(unparen) }
    if (words[0] === 'cd' && words.length <= 2) {
      const to = words[1] ?? home
      if (!/[$`*?{}]/.test(to.replace(/^\$\{?HOME\}?(?=\/|$)/, ''))) dir = resolvePath(to, dir, home)
      continue
    }
    out.push({ seg, dir })
  }
  return out
}

// Programs that read a folder's files when given the folder: '' always, else the
// short flags (any one of them) that make them recurse.
const RECURSE = new Map([['tar', ''], ['7z', ''], ['rg', ''], ['ag', ''], ['ack', ''], ['zip', 'r'], ['rsync', 'ra'], ['cp', 'rRa'], ['scp', 'r'], ['grep', 'rR'], ['egrep', 'rR'], ['fgrep', 'rR']])
function recursive(words: string[]): boolean {
  let w = words
  while (w.length && /^[A-Za-z_]\w*=/.test(w[0] ?? '')) w = w.slice(1)
  if (w[0] === 'sudo' || w[0] === 'command' || w[0] === 'env') w = w.slice(1)
  const flags = RECURSE.get((w[0] ?? '').split('/').pop() ?? '')
  if (flags === undefined) return false
  return !flags || w.slice(1).some(a => a === '--recursive' || a === '--archive' || (/^-[A-Za-z]+$/.test(a) && [...flags].some(f => a.includes(f))))
}

// Files a read tool or a shell command names: every word and redirect, and the
// path-like pieces inside a word (`--data=PATH`, inline `-c` code), resolved.
// `loose`: globs, and every piece a recursive reader is given (a folder may hold
// a holdout); these are checked by readHits, not as exact paths.
type Named = { exact: string[]; loose: { path: string; recursive: boolean }[] }
function namedPaths(tool: string, input: Record<string, unknown>, at: string): Named {
  if (tool === 'Read') return { exact: [String(input.file_path ?? '')], loose: [] }
  if (tool === 'Grep') {
    const p = input.path ? resolvePath(String(input.path), at, home) : null
    return p ? { exact: [p], loose: [{ path: p, recursive: true }] } : { exact: [], loose: [] }
  }
  if (tool === `${DC}read_file`) return { exact: input.path ? [resolvePath(String(input.path), at, home)] : [], loose: [] }
  if (tool === `${DC}read_multiple_files`) return { exact: (Array.isArray(input.paths) ? input.paths : []).map(p => resolvePath(String(p), at, home)), loose: [] }
  const out: Named = { exact: [], loose: [] }
  if (kindOf(tool) !== 'shell') return out
  for (const { seg, dir } of walk(shellText(tool, input), at)) {
    const rec = recursive(seg.words)
    for (const w of [...seg.words, ...seg.redirects]) {
      for (const piece of w.replace(/^[0-9]*[<>]+&?/, '').split(/[\s'"(),;=]+/)) {
        const q = piece.replace(/^\$\{?HOME\}?(?=\/|$)/, '~')
        if (!q || q.startsWith('-') || /[$`]/.test(q) || (!rec && !/[/.~]/.test(q))) continue
        const p = resolvePath(q, dir, home)
        out.exact.push(p)
        if (rec || /[*?[]/.test(p)) out.loose.push({ path: p, recursive: rec })
      }
    }
  }
  return out
}

async function opened($: EngineInterface, tool: string, input: Record<string, unknown>): Promise<{ path: string; entry: Entry }[]> {
  const shell = kindOf(tool) === 'shell'
  if (shell || tool !== 'Read') cwd = (await $.session.cwd()) || cwd
  const out: { path: string; entry: Entry }[] = []
  const add = (path: string, entry: Entry) => {
    if (!out.some(o => o.entry.slug === entry.slug)) out.push({ path, entry })
  }
  const named = namedPaths(tool, input, cwd)
  for (const p of named.exact) {
    const entry = await entryAt($, p)
    if (entry) add(p, entry)
  }
  for (const { path, recursive: rec } of named.loose) {
    if (!vault.files.some(e => e.confirmed === true)) break
    const sp = await spellingsOf($, path)
    for (const e of vault.files) {
      if (e.confirmed === true && matchOf(e).some(m => sp.some(t => readHits(t, rec, m)))) add(path, e)
    }
  }
  if (!shell) return out
  // Heredoc bodies and code the word split cannot see: search the raw text.
  const text = shellText(tool, input)
  for (const e of vault.files) {
    if (e.confirmed !== true) continue
    for (const sp of [...matchOf(e), ...(e.match.startsWith('~/') ? [e.match] : [])]) {
      const hit = textNames(text, sp)
      if (hit) { add(expandHome(hit, home), e); break }
    }
  }
  return out
}

function writeTargets(e: Input): string[] {
  const t = String(e.tool)
  const rec = e as unknown as Record<string, unknown>
  if (t === 'Write' || t === 'Edit' || t === 'MultiEdit' || t === `${DC}edit_block`) return [resolvePath(String(rec.file_path ?? ''), cwd, home)]
  if (t === 'NotebookEdit') return [String(rec.notebook_path ?? '')]
  if (t === `${DC}write_file`) return [resolvePath(String(rec.path ?? ''), cwd, home)]
  if (kindOf(t) === 'shell') return targetsOf(shellText(t, rec), cwd, home, 'modify')
  return []
}

// What a segment removes or moves away (a folder takes everything under it).
function removed(seg: Seg): string[] {
  let w = seg.words
  while (w.length && /^[A-Za-z_]\w*=/.test(w[0] ?? '')) w = w.slice(1)
  if (w[0] === 'sudo' || w[0] === 'command' || w[0] === 'env') w = w.slice(1)
  const prog = (w[0] ?? '').split('/').pop() ?? ''
  const args = w.slice(1).filter(a => !a.startsWith('-'))
  if (['rm', 'rmdir', 'unlink', 'shred'].includes(prog)) return args
  if (prog === 'mv') return args.slice(0, -1)
  // git checkout/restore only touch tracked files and `git rm --cached` only the
  // index, so they get the exact-path check alone (writeTargets), not this one.
  if (prog === 'git' && args[0] === 'rm' && !w.includes('--cached')) return args.slice(1)
  if (prog === 'git' && args[0] === 'mv') return args.slice(1, -1)
  return []
}

// Shell writes shell.ts leaves to us: glob targets (it skips them) and folders
// removed or moved that hold a holdout. `contains`: the folder case applies.
function shellWrites(cmd: string, at: string): { path: string; contains: boolean }[] {
  const out: { path: string; contains: boolean }[] = []
  for (const { seg, dir } of walk(cmd, at)) {
    const gone = removed(seg)
    for (const p of writtenFiles(seg, 'modify')) {
      if (/[*?[]/.test(p) && !/[$`{}]/.test(p) && !gone.includes(p)) out.push({ path: resolvePath(p, dir, home), contains: false })
    }
    for (const p of gone) if (!/[$`{}]/.test(p)) out.push({ path: resolvePath(p, dir, home), contains: true })
  }
  return out
}

async function shellWriteHit($: EngineInterface, cmd: string): Promise<{ path: string; entry: Entry } | null> {
  if (!vault.files.some(e => e.confirmed === true)) return null
  for (const { path, contains } of shellWrites(cmd, cwd)) {
    const spellings = await spellingsOf($, path)
    for (const e of vault.files) {
      if (e.confirmed !== true) continue
      if (matchOf(e).some(m => spellings.some(t => targetHits(t, contains, m)))) return { path, entry: e }
    }
  }
  return null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    cwd = e.cwd || cwd
    await load($)
    await $.command.register({ name: 'burn', description: 'Burn a sealed holdout: /burn <slug>. Appends BURNED to the ledger; the file then opens freely.' })
    return r
  }).catch(($, e, next) => next(e))

  // Opening a sealed, unburned holdout is put to the user.
  on('tool.check', async ($, e, next) => {
    const t = String(e.tool)
    const k = kindOf(t)
    if (k !== 'read' && k !== 'shell') return next(e)
    const hits = await opened($, t, (e.input ?? {}) as Record<string, unknown>)
    if (!hits.length) return next(e)
    const done = await burned($)
    const fresh = hits.find(h => !done.has(h.entry.slug))
    if (!fresh) return next(e)
    return { decision: 'ask', decider: 'person', reason: askText(fresh.path, fresh.entry) }
  }).catch(() => ({ decision: 'ask', decider: 'person', reason: 'holdout-vault: the seal check failed; confirm before opening.' }))

  // Writes are refused; a read that ran burns its holdout once per slug.
  on('tool.call', async ($, e, next) => {
    const t = String(e.tool)
    const k = kindOf(t)
    if (!k) return next(e)
    if (k === 'shell' || t.startsWith(DC)) cwd = (await $.session.cwd()) || cwd
    for (const p of writeTargets(e)) {
      const entry = await entryAt($, p)
      if (entry) return { deny: readOnlyText(p, entry) }
    }
    if (k === 'shell') {
      const hit = await shellWriteHit($, shellText(t, e as unknown as Record<string, unknown>))
      if (hit) return { deny: readOnlyText(hit.path, hit.entry) }
    }
    if (k === 'write') return next(e)
    const hits = await opened($, t, e as unknown as Record<string, unknown>)
    const done = hits.length ? await burned($) : new Set<string>()
    const r = await next(e)
    if (r.deny !== undefined || r.isError || !hits.length) return r
    const notes: string[] = []
    for (const h of hits) {
      if (done.has(h.entry.slug)) { $.ui.toast(`holdout "${h.entry.slug}" is already burned`); continue }
      const msg = await burn($, h.entry.slug, h.path)
      if (msg) { notes.push(msg); $.ui.toast(msg) }
    }
    return notes.length ? { ...r, context: [...(r.context ?? []), ...notes] } : r
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'holdout-vault: the seal check failed; not touching a possible holdout blind.' }))

  on('command.run', { command: 'burn' }, async ($, e) => {
    const slug = e.args.trim()
    const entry = vault.files.find(f => f.slug === slug && f.confirmed === true)
    if (!entry) {
      const known = vault.files.filter(f => f.confirmed === true).map(f => f.slug).join(', ') || '(none confirmed)'
      return { text: `Usage: /burn <slug>. Confirmed holdouts: ${known}` }
    }
    const msg = await burn($, slug, expandHome(entry.match, home))
    return { text: msg ?? `holdout "${slug}" was already burned.` }
  })
}
