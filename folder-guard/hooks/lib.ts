// folder-guard: is a path a NEW item loose in ~, ~/Desktop or ~/Documents?

export const bannedDirs = (home: string) => [home, `${home}/Desktop`, `${home}/Documents`]

// The item directly under a banned folder that this path would create or use,
// or null when the path is under no banned folder or under a dot-folder.
export function topItem(path: string, home: string): { item: string; banned: string } | null {
  const banned = bannedDirs(home).map(b => b.toLowerCase()) // macOS is case-insensitive
  let cur = path.replace(/\/+$/, '')
  while (true) {
    const i = cur.lastIndexOf('/')
    if (i <= 0) return null
    const parent = cur.slice(0, i)
    const name = cur.slice(i + 1)
    const at = banned.indexOf(parent.toLowerCase())
    if (at >= 0) {
      if (!name || name.startsWith('.')) return null
      return { item: cur, banned: bannedDirs(home)[at] ?? parent }
    }
    cur = parent
  }
}

const CATS: { dir: string; words: RegExp }[] = [
  {
    dir: 'Trading',
    words: /\b(?:nq|mnq|es|mes|mgc|gc|cl|zn|futures?|backtest\w*|strateg\w*|trad(?:e|es|ing)|prop|topstep|apex|pine|ohlcv?|parquet|sharpe|edge|orb|vwap|scalp\w*|ledger|tick|market|signal|bars?)\b/gi,
  },
  { dir: 'YouTube', words: /\b(?:youtube|yt|video|thumbnail|shorts|upload\w*|channel|voiceover|ffmpeg)\b/gi },
  { dir: 'AutoRank-Business', words: /\b(?:autorank|seo|outreach|prospects?|leads?|clients?|agency|send.?pack|hvac|cold.?email|website)\b/gi },
  { dir: 'Career', words: /\b(?:resume|cv|cover.?letter|jobs?|interview\w*|career|linkedin|recruit\w*|application)\b/gi },
  { dir: 'Engineering', words: /\b(?:engineering|ee|electrical|pcb|schematic\w*|autocad|cad|dxf|qcad|kicad|circuit\w*|firmware|embedded|buck|ladder|plc|bim|revit)\b/gi },
]

// Creating exactly ~/<hub> is allowed: the hubs have to exist before work can go in them.
export const isHub = (item: string, home: string) =>
  CATS.some(c => item.toLowerCase() === `${home}/${c.dir}`.toLowerCase())

// The category folder the words point to, or null when nothing fits.
export function suggest(path: string, text: string, home: string, banned: string): { dir: string; path: string } | null {
  const hay = `${path.replace(/[_\-./]/g, ' ')} ${text.slice(0, 4000)}`
  let best: { dir: string; n: number } | null = null
  for (const c of CATS) {
    const n = (hay.match(c.words) ?? []).length
    if (n > 0 && (!best || n > best.n)) best = { dir: c.dir, n }
  }
  if (!best) return null
  const rel = path.slice(banned.length + 1) // what would have sat in the banned folder
  const into = rel.includes('/') ? rel : `_scratch/${rel}`
  return { dir: best.dir, path: `${home}/${best.dir}/${into}` }
}

export function denyText(path: string, banned: string, s: { dir: string; path: string } | null, home: string): string {
  const where = banned === home ? '~' : `~${banned.slice(home.length)}`
  const tail = s
    ? `Suggested: ${s.path.replace(home, '~')} (it reads as ${s.dir} work).`
    : 'It fits none of ~/Trading, ~/YouTube, ~/AutoRank-Business, ~/Career, ~/Engineering by its words: ask the user where it goes.'
  return `folder-guard: ${path.replace(home, '~')} would be a new item loose in ${where}. New work goes in its category folder (~/.claude/CLAUDE.md). ${tail}`
}
