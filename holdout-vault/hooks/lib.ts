// Pure logic for holdout-vault: vault entries, path matching, ledger lines.

export type Entry = { match: string; slug: string; note?: string; confirmed?: boolean; burned_per_memory?: boolean }
export type Vault = { ledger: string; files: Entry[] }

// vault.json is edited by hand: keep only a well-formed shape so a typo can never
// throw inside a hook (which would turn every tool call into a deny or an ask).
export function parseVault(raw: unknown, fallbackLedger: string): { vault: Vault; problem: string | null } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  const ledger = o && typeof o.ledger === 'string' && o.ledger ? o.ledger : fallbackLedger
  if (!o || !Array.isArray(o.files)) return { vault: { ledger, files: [] }, problem: 'vault.json has no "files" list; nothing is sealed' }
  const files: Entry[] = []
  const bad: string[] = []
  for (const [i, x] of o.files.entries()) {
    const e = x && typeof x === 'object' ? (x as Record<string, unknown>) : {}
    if (typeof e.match !== 'string' || !e.match || typeof e.slug !== 'string' || !e.slug) {
      bad.push(typeof e.slug === 'string' && e.slug ? e.slug : `#${i + 1}`)
      continue
    }
    files.push({
      match: e.match,
      slug: e.slug,
      ...(typeof e.note === 'string' ? { note: e.note } : {}),
      confirmed: e.confirmed === true,
      burned_per_memory: e.burned_per_memory === true,
    })
  }
  return { vault: { ledger, files }, problem: bad.length ? `vault.json entries skipped (need a "match" and a "slug"): ${bad.join(', ')}` : null }
}

export function expandHome(p: string, home: string): string {
  return p === '~' ? home : p.startsWith('~/') ? `${home}/${p.slice(2)}` : p
}

const isGlob = (m: string) => /[*?[]/.test(m)

// A glob path split at the folder its first glob character sits in: [folder, rest].
export function globDir(p: string): [string, string] | null {
  const i = p.search(/[*?[]/)
  if (i < 0) return null
  const j = p.lastIndexOf('/', i)
  return j > 0 ? [p.slice(0, j), p.slice(j)] : null
}

// `**` crosses folders, `*` and `?` do not.
export function globToRegex(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i)
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++ }
    else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|\\[\]]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

// An exact path, a folder prefix (everything under it), or a glob.
export function matches(path: string, match: string): boolean {
  if (!path || !match) return false
  if (isGlob(match)) return globToRegex(match).test(path)
  const m = match.replace(/\/+$/, '')
  return path === m || path.startsWith(`${m}/`)
}

// A path and every folder above it, up to '/'.
export function ancestors(p: string): string[] {
  const out = [p]
  let x = p
  while (x.lastIndexOf('/') > 0) {
    x = x.slice(0, x.lastIndexOf('/'))
    out.push(x)
  }
  if (p !== '/') out.push('/')
  return out
}

// Whether a write target the exact check misses hits an entry spelling: a glob
// target that covers it, or (contains: a remove/move) a folder that holds it.
export function targetHits(target: string, contains: boolean, spelling: string): boolean {
  const cands = contains ? ancestors(spelling) : [spelling]
  if (isGlob(target)) return cands.some(c => globToRegex(target).test(c)) || matches(target, spelling)
  return contains && cands.includes(target)
}

// Whether a read target the exact check misses opens an entry spelling: a glob
// that covers it, or (recursive: tar, rsync, grep -r, the Grep tool) a folder that
// holds it, from the entry's own folder down (a grep of a whole repo is not an open).
export function readHits(target: string, recursive: boolean, spelling: string): boolean {
  const floor = globDir(spelling)?.[0] ?? (spelling.slice(0, spelling.lastIndexOf('/')) || '/')
  const cands = recursive ? ancestors(spelling).filter(c => c === floor || c.startsWith(`${floor}/`)) : [spelling]
  if (isGlob(target)) return cands.some(c => globToRegex(target).test(c)) || matches(target, spelling)
  return recursive && cands.includes(target)
}

// Whether free text (inline code, a heredoc, `--opt=path`) names an entry
// spelling: as a whole path or a path under it, not inside a longer name.
export function textNames(text: string, spelling: string): string | null {
  const stop = `[^\\s'"\`]`
  let body = ''
  for (let i = 0; i < spelling.length; i++) {
    const c = spelling.charAt(i)
    if (c === '*' && spelling[i + 1] === '*') { body += `${stop}*`; i++ }
    else if (c === '*') body += `[^/\\s'"\`]*`
    else if (c === '?') body += `[^/\\s'"\`]`
    else body += c.replace(/[.+^${}()|\\[\]]/g, '\\$&')
  }
  const m = new RegExp(`(?<![\\w./~-])${body}(?:/${stop}*)?(?![\\w.-])`).exec(text)
  return m ? m[0] : null
}

// Only confirmed entries are enforced. `paths` holds each spelling of one file
// (as written and its realpath); `matchOf` gives each entry's spellings likewise.
export function entryFor(paths: string[], entries: Entry[], matchOf: (e: Entry) => string[]): Entry | null {
  for (const e of entries) {
    if (e.confirmed !== true) continue
    if (matchOf(e).some(m => paths.some(p => matches(p, m)))) return e
  }
  return null
}

export function burnedSlugs(ledgerText: string, entries: Entry[]): Set<string> {
  const out = new Set(entries.filter(e => e.burned_per_memory === true).map(e => e.slug))
  for (const line of ledgerText.split('\n')) {
    try {
      const r = JSON.parse(line) as { event?: string; slug?: string }
      if (r.event === 'BURNED' && r.slug) out.add(r.slug)
    } catch {
      // blank or foreign line
    }
  }
  return out
}

export function burnLine(slug: string, path: string, date: Date): string {
  return JSON.stringify({ event: 'BURNED', date: date.toISOString(), slug, path })
}

export const readOnlyText = (path: string, e: Entry) =>
  `holdout-vault: ${path} is sealed holdout "${e.slug}" and is read-only. Write results elsewhere; never modify holdout data.`

export const askText = (path: string, e: Entry) =>
  `holdout-vault: opening ${path} BURNS holdout "${e.slug}"${e.note ? ` (${e.note})` : ''}. Allow only if the user means to spend it now.`
