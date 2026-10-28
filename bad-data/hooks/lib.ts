// bad-data: which known-defective data files a tool call touches.

export type Defect = {
  id: string
  match: string
  defect: string
  safe_use?: string
  unsafe?: string
  instead?: string
  source?: string
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function pattern(d: Defect): RegExp {
  return d.match.startsWith('regex:') ? new RegExp(d.match.slice(6), 'i') : new RegExp(esc(d.match), 'i')
}

export function findDefects(text: string, defects: readonly Defect[]): Defect[] {
  return defects.filter(d => pattern(d).test(text))
}

// Shell commands that only search or list (a grep for the name is not a load).
const SEARCH_ONLY = /^\s*(?:grep|rg|ag|find|ls|stat|du|mdfind|locate|wc|cat\s+\S+\.md)\b/
// Prose and config files: writing about a defect is not using the file.
const DOC_FILE = /\.(?:md|txt|json|ya?ml|toml|rst)$/i

export type Subject = { text: string; isCode: boolean }

// The part of a tool call that can name a data file.
export function subject(tool: string, input: Record<string, unknown>): Subject | null {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (tool) {
    case 'Read':
      return { text: s('file_path'), isCode: false }
    case 'Bash':
      return SEARCH_ONLY.test(s('command')) ? null : { text: s('command'), isCode: false }
    case 'Write':
      return DOC_FILE.test(s('file_path')) ? null : { text: `${s('file_path')}\n${s('content')}`, isCode: true }
    case 'Edit':
      return DOC_FILE.test(s('file_path')) ? null : { text: `${s('file_path')}\n${s('new_string')}`, isCode: true }
    case 'NotebookEdit':
      return { text: s('new_source'), isCode: true }
    default:
      return null
  }
}

export function contextFor(found: readonly Defect[]): string {
  const lines = ['bad-data: this call touches data files the memory marks as defective. Account for it before trusting any result, and say so to the user:']
  for (const d of found) {
    lines.push(`- ${d.match.replace(/^regex:/, '')}: ${d.defect}.`)
    if (d.safe_use) lines.push(`    safe: ${d.safe_use}`)
    if (d.unsafe) lines.push(`    UNSAFE: ${d.unsafe}`)
    if (d.instead) lines.push(`    instead: ${d.instead}`)
    if (d.source) lines.push(`    source: memory/${d.source}`)
  }
  return lines.join('\n')
}

export function toastFor(found: readonly Defect[]): string {
  const d = found[0]
  if (!d) return ''
  const name = d.match.startsWith('regex:') ? d.id : d.match
  const more = found.length > 1 ? ` (+${found.length - 1} more)` : ''
  return `bad-data: ${name} — ${d.defect.slice(0, 90)}${d.instead ? `; use ${d.instead.split(' (')[0]}` : ''}${more}`
}
