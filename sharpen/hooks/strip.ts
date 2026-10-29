/**
 * Remove invented deliverables from a markdown brief.
 * In the `## Deliverables` section drop each bullet line naming a file token
 * (/(?:[\w.~\/-]+\/)?[\w.-]+\.(?:md|py|ts|tsx|js|json|csv|html|txt|pdf|xlsx|yaml|yml|sh|ipynb|png|parquet)\b/gi)
 * whose lowercase basename is not a substring of (idea+profile).toLowerCase(); count removed bullets.
 * If the section then has no bullets, insert `- Exactly what the request asks for; no extra files.`
 * Also delete any `## Stretch` section whole (up to the next `## ` heading or end).
 * No `## Deliverables` heading: return the brief unchanged with removed 0.
 */
const FILE = /(?:[\w.~/-]+\/)?[\w.-]+\.(?:md|py|ts|tsx|js|json|csv|html|txt|pdf|xlsx|yaml|yml|sh|ipynb|png|parquet)\b/gi
const isBullet = (line: string) => /^[-*] /.test(line)

function section(lines: string[], heading: string): { start: number; end: number } | null {
  const start = lines.findIndex(line => line.trim() === heading)
  if (start === -1) return null
  let end = start + 1
  while (end < lines.length && !lines[end].startsWith('## ')) end++
  return { start, end }
}

export function stripInvented(brief: string, idea: string, profile: string): { brief: string; removed: number } {
  const lines = brief.split('\n')
  const deliv = section(lines, '## Deliverables')
  if (!deliv) return { brief, removed: 0 }

  const haystack = (idea + profile).toLowerCase()
  const body = lines.slice(deliv.start + 1, deliv.end)
  let removed = 0
  const kept = body.filter(line => {
    if (!isBullet(line)) return true
    const tokens = line.match(FILE)
    if (!tokens) return true
    const invented = tokens.some(token => {
      const base = token.split('/').pop()!.toLowerCase()
      return !haystack.includes(base)
    })
    if (invented) removed++
    return !invented
  })

  if (!kept.some(isBullet)) kept.unshift('- Exactly what the request asks for; no extra files.')

  let out = [...lines.slice(0, deliv.start + 1), ...kept, ...lines.slice(deliv.end)]

  const stretch = section(out, '## Stretch')
  if (stretch) out = [...out.slice(0, stretch.start), ...out.slice(stretch.end)]

  return { brief: out.join('\n'), removed }
}
