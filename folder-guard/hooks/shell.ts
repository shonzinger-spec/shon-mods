// A small shell reader: which files a Bash command may write.
// Quote-aware, skips heredoc bodies, and treats `2>/dev/null`, `>&2` as no target,
// so text inside quotes or a heredoc (code with `=>` in it) is never a redirect.

export type Seg = { words: string[]; redirects: string[] }

export function segments(cmd: string): Seg[] {
  const segs: Seg[] = []
  let words: string[] = []
  let redirects: string[] = []
  let buf = ''
  let has = false // buf holds a word (possibly empty quotes)
  let quote: '"' | "'" | null = null
  let pendingRedirect = false
  let pendingInput = false
  const heredocs: string[] = []

  const endWord = () => {
    if (!has) return
    if (pendingRedirect) {
      if (!buf.startsWith('&')) redirects.push(buf)
      pendingRedirect = false
    } else if (pendingInput) pendingInput = false
    else words.push(buf)
    buf = ''
    has = false
  }
  const endSeg = () => {
    endWord()
    if (words.length || redirects.length) segs.push({ words, redirects })
    words = []
    redirects = []
    pendingRedirect = false
  }

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i] ?? ''
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < cmd.length) buf += cmd[++i]
      else buf += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      has = true
      continue
    }
    if (c === '\\' && i + 1 < cmd.length) {
      buf += cmd[++i]
      has = true
      continue
    }
    if (c === '#' && !has) {
      while (i + 1 < cmd.length && cmd[i + 1] !== '\n') i++
      continue
    }
    if (c === '\n') {
      endSeg()
      // skip the bodies of heredocs opened on the line just ended
      while (heredocs.length) {
        const delim = heredocs.shift() ?? ''
        while (i < cmd.length) {
          const nl = cmd.indexOf('\n', i + 1)
          const lineEnd = nl === -1 ? cmd.length : nl
          const lineText = cmd.slice(i + 1, lineEnd).replace(/^\t+/, '')
          i = lineEnd
          if (lineText === delim) break
        }
      }
      continue
    }
    if (c === ' ' || c === '\t') {
      endWord()
      continue
    }
    if (c === ';' || c === '|' || (c === '&' && cmd[i + 1] === '&')) {
      if ((c === '|' || c === '&') && cmd[i + 1] === c) i++
      endSeg()
      continue
    }
    if (c === '&' && !has && pendingRedirect) {
      buf += c
      has = true
      continue
    }
    if (c === '<' && cmd[i + 1] === '<') {
      endWord()
      i++
      if (cmd[i + 1] === '<') {
        i++ // here-string: its word is input
        pendingInput = true
        continue
      }
      if (cmd[i + 1] === '-') i++
      while (cmd[i + 1] === ' ') i++
      let d = ''
      while (i + 1 < cmd.length && !/[\s;|&<>]/.test(cmd[i + 1] ?? '')) d += cmd[++i]
      heredocs.push(d.replace(/['"\\]/g, ''))
      continue
    }
    if (c === '<') {
      endWord()
      pendingInput = true
      continue
    }
    if (c === '>') {
      // `2>` / `&>`: the digits or & before it name a stream, not a word
      if (has && /^(?:\d+|&)$/.test(buf)) {
        buf = ''
        has = false
      } else endWord()
      if (cmd[i + 1] === '>') i++
      if (cmd[i + 1] === '|') i++
      pendingRedirect = true
      continue
    }
    buf += c
    has = true
  }
  endSeg()
  return segs
}

// Files a segment's program writes or removes (beyond its redirects).
// mode 'modify': anything it changes or deletes. mode 'create': only what it may
// bring into being (redirects, tee, touch, mkdir, a copy/move destination, and
// for a destination folder each source's name inside it).
export function writtenFiles(seg: Seg, mode: 'modify' | 'create' = 'modify'): string[] {
  let w = seg.words
  while (w.length && /^[A-Za-z_]\w*=/.test(w[0] ?? '')) w = w.slice(1)
  if (w[0] === 'sudo' || w[0] === 'command' || w[0] === 'env') w = w.slice(1)
  const prog = (w[0] ?? '').split('/').pop() ?? ''
  const args = w.slice(1).filter(a => !a.startsWith('-'))
  const out = [...seg.redirects]
  if (mode === 'create') {
    if (['tee', 'touch', 'mkdir'].includes(prog)) out.push(...args)
    if (['cp', 'mv', 'ln', 'rsync', 'install'].includes(prog) && args.length >= 2) {
      const dest = args[args.length - 1] ?? ''
      out.push(dest)
      for (const src of args.slice(0, -1)) {
        const name = src.replace(/\/+$/, '').split('/').pop()
        if (name) out.push(`${dest.replace(/\/+$/, '')}/${name}`)
      }
    }
    return out.filter(Boolean)
  }
  switch (prog) {
    case 'tee':
    case 'touch':
    case 'mkdir':
    case 'rm':
    case 'rmdir':
    case 'unlink':
    case 'shred':
    case 'truncate':
      out.push(...args)
      break
    case 'mv':
      out.push(...args)
      break
    case 'cp':
    case 'ln':
    case 'rsync':
    case 'install':
      if (args.length >= 2) out.push(args[args.length - 1] ?? '')
      break
    case 'sed':
    case 'perl':
      if (w.slice(1).some(a => /^-[a-zA-Z]*i/.test(a) || a === '--in-place')) out.push(...args.slice(1))
      break
    case 'git':
      if (['checkout', 'restore', 'rm', 'mv'].includes(args[0] ?? '')) out.push(...args.slice(1))
      break
  }
  return out.filter(Boolean)
}

// Every path a command may write (mode as writtenFiles), absolute. Follows `cd`
// from segment to segment and expands simple `NAME=value` assignments made earlier
// in the same command; a path still holding `$`, a glob or a brace is skipped
// (unknowable here, and a guard must not guess), as is anything under /dev.
export function targetsOf(cmd: string, cwd: string, home: string, mode: 'modify' | 'create' = 'modify'): string[] {
  const vars = new Map<string, string>()
  const expand = (s: string) =>
    s.replace(/\$\{(\w+)\}|\$(\w+)/g, (m, a?: string, b?: string) => {
      const k = a ?? b ?? ''
      if (k === 'HOME') return home
      return vars.get(k) ?? m
    })
  let dir = cwd
  const out: string[] = []
  for (const seg of segments(cmd)) {
    // a subshell's parentheses cling to its first and last words
    const unparen = (x: string) => x.replace(/^\(+/, '').replace(/\)+$/, '')
    const w = seg.words.map((x, i) => (i === 0 || i === seg.words.length - 1 ? unparen(x) : x))
    const redirects = seg.redirects.map(unparen)
    if (w.length && w.every(x => /^[A-Za-z_]\w*=/.test(x)) && redirects.length === 0) {
      for (const a of w) {
        const i = a.indexOf('=')
        vars.set(a.slice(0, i), expand(a.slice(i + 1)))
      }
      continue
    }
    if (w[0] === 'cd' && w.length <= 2) {
      const to = expand(w[1] ?? home)
      if (!/[$`*?{}]/.test(to)) dir = resolvePath(to, dir, home)
      continue
    }
    for (const p of writtenFiles({ words: w, redirects }, mode)) {
      const x = expand(p)
      if (/[$`*?{}]/.test(x) || x.startsWith('/dev/')) continue
      out.push(resolvePath(x, dir, home))
    }
  }
  return out
}

// The directory a command runs in after a leading `cd X &&`.
export function leadingCd(cmd: string, cwd: string): string {
  const m = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)/.exec(cmd)
  if (!m) return cwd
  return (m[1] ?? '').replace(/^["']|["']$/g, '')
}

export function resolvePath(p: string, cwd: string, home: string): string {
  let q = p.replace(/^\$\{?HOME\}?(?=\/|$)/, home).replace(/^~(?=\/|$)/, home)
  if (!q.startsWith('/')) q = `${cwd.replace(/\/+$/, '')}/${q}`
  const parts: string[] = []
  for (const part of q.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return '/' + parts.join('/')
}
