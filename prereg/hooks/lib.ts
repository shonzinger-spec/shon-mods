// prereg: which files are pre-registrations, and what locks each one.

export type Prereg = {
  kind: 'json' | 'legacy'
  slug: string
  dir: string // the folder holding it
  // files whose existence locks it
  markers: string[]
  // folder whose entries starting with `listPrefix` also lock it (json kind: results/)
  listDir?: string
  listPrefix?: string
}

// New convention: <root>/prereg/<slug>.json (+ .sha256, + .result.json, the lock).
const JSON_RE = /^(.*)\/prereg\/([^/]+?)(?:\.result)?\.(?:json|sha256)$/
// Legacy (propfarm-2026): PREREGISTRATION_<tag>.md + PREREG_<tag>.sha256,
// locked by PREREG_<tag>_RESULT.sha256.
const LEGACY_MD = /^(.*)\/PREREGISTRATION_([^/]+)\.md$/
const LEGACY_SHA = /^(.*)\/PREREG_([^/]+?)(?:_RESULT)?\.sha256$/

export function preregOf(path: string): Prereg | null {
  let m = JSON_RE.exec(path)
  if (m) {
    const root = m[1] ?? ''
    const slug = m[2] ?? ''
    const dir = `${root}/prereg`
    return { kind: 'json', slug, dir, markers: [`${dir}/${slug}.result.json`], listDir: `${root}/results`, listPrefix: slug }
  }
  m = LEGACY_MD.exec(path) ?? LEGACY_SHA.exec(path)
  if (m) {
    const dir = m[1] ?? ''
    const tag = m[2] ?? ''
    return { kind: 'legacy', slug: tag, dir, markers: [`${dir}/PREREG_${tag}_RESULT.sha256`] }
  }
  return null
}

// A results entry counts when it is the slug itself or the slug followed by a separator.
export function isResultFor(entry: string, slug: string): boolean {
  if (!entry.startsWith(slug)) return false
  const rest = entry.slice(slug.length)
  return rest === '' || /^[._-]/.test(rest)
}

export function denyText(file: string, p: Prereg, marker: string): string {
  const amend =
    p.kind === 'json'
      ? `a new pre-registration with its own slug (e.g. prereg/${p.slug}-A1.json via prereg.py create)`
      : `an amendment file (PREREGISTRATION_${p.slug}_A1.md + its own sha256)`
  return [
    `prereg: ${file} is LOCKED — results for "${p.slug}" already exist (${marker}).`,
    'Changing hypothesis, gates or thresholds after seeing results is goalpost moving.',
    `If something must change, write ${amend}, and report the original verdict alongside it.`,
  ].join(' ')
}
