import { resolvePath, segments } from './shell'

// Runs at or above this long are "long": stored, nudged, notified, and a
// foreground re-run of the same signature is refused.
export const LONG_MS = 120_000

// Command signature: what makes two runs "the same command" for timing.
//   - split the command into shell segments (quote-aware, via shell.ts), so a
//     leading `cd X &&` and anything after `;`/`&&`/`|` is its own segment;
//   - take the first segment that invokes python (python, python3, python3.11,
//     any path ending in /python or /python3), uv or poetry;
//   - drop leading `VAR=value` assignments and the wrappers env/time/nohup;
//   - keep the interpreter words (`uv run`, `poetry run`, `python`, with the
//     version and directory dropped: `.venv/bin/python3.11` -> `python`), the
//     module (`-m pkg.mod`) or the script path (a leading `./` dropped), and one
//     subcommand: the next bare word (letters, digits, `-`, `_`, not starting
//     with a digit, no `.` or `/`);
//   - drop every other argument: flags and their values, numbers, seeds, output
//     paths. So `python run_sweep.py grid --seed 7 --out a.csv` and
//     `cd ~/x && SEED=3 python ./run_sweep.py grid --seed 9 --out b.csv` share
//     the signature `python run_sweep.py grid`.
//   - `python -c ...` and an interpreter with no script return null.
const WRAPPERS = new Set(['env', 'time', 'nohup', 'caffeinate', 'exec'])
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/

function pythonWord(w: string): boolean {
  return /^python(\d+(\.\d+)?)?$/.test(w.split('/').pop() ?? '')
}

function interpreterStart(words: string[]): number {
  let i = 0
  while (i < words.length && (ASSIGN.test(words[i]!) || WRAPPERS.has(words[i]!) || (words[i]!.startsWith('-') && i > 0)))
    i++
  const w = words[i]
  if (w === undefined) return -1
  return pythonWord(w) || w === 'uv' || w === 'poetry' ? i : -1
}

export function signature(cmd: string): string | null {
  for (const seg of segments(cmd)) {
    const words = seg.words
    let i = interpreterStart(words)
    if (i < 0) continue
    const out: string[] = []
    // uv run / poetry run [flags] [python] script
    if (words[i] === 'uv' || words[i] === 'poetry') {
      if (words[i + 1] !== 'run') return null
      out.push(words[i]!, 'run')
      i += 2
      while (i < words.length && words[i]!.startsWith('-')) i += words[i]!.includes('=') ? 1 : 2
      if (i < words.length && pythonWord(words[i]!)) {
        out.push('python')
        i++
      }
    } else {
      out.push('python')
      i++
    }
    // interpreter flags before the script
    while (i < words.length && words[i]!.startsWith('-')) {
      const f = words[i]!
      if (f === '-c') return null
      if (f === '-m') {
        const mod = words[i + 1]
        if (!mod) return null
        out.push('-m', mod)
        i += 2
        break
      }
      i++
    }
    if (out[out.length - 2] !== '-m') {
      const script = words[i]
      if (!script || script.startsWith('-')) return null
      out.push(script.replace(/^\.\//, ''))
      i++
    }
    const sub = words[i]
    if (sub !== undefined && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(sub)) out.push(sub)
    return out.join(' ')
  }
  return null
}

// The directory a command runs in: the session cwd, moved by every `cd X`
// segment before the interpreter segment (`~` and relative paths resolved).
// It is part of the store key, not of the signature shown, so a same-named
// script in two repos (`cd ~/a && python backtest.py`, `cd ~/b && python
// backtest.py`) keeps two histories, while two spellings of one directory
// (`cd ~/a`, `cd /Users/me/a`) share one.
export function runDir(cmd: string, cwd: string, home: string): string {
  let dir = cwd
  for (const seg of segments(cmd)) {
    const w = seg.words
    if (w[0] === 'cd' && w.length <= 2) {
      dir = resolvePath(w[1] ?? home, dir, home)
      continue
    }
    if (interpreterStart(w) >= 0) break
  }
  return dir
}

// A help or dry-run invocation (`--help`, `-h`, `--dry-run`) of a backtest is
// quick whatever the full run takes: it is never refused and never timed, so
// it neither trips over nor overwrites the full run's history.
export function quickRun(cmd: string): boolean {
  for (const seg of segments(cmd)) {
    if (interpreterStart(seg.words) < 0) continue
    return seg.words.some(w => /^(--help|-h|--dry[-_]?run)(=.*)?$/.test(w))
  }
  return false
}

// A task notification that reports a failed run ("failed", "killed", a
// non-zero exit code). A quick failure must not replace the history.
export function reportsFailure(text: string): boolean {
  return /\b(failed|killed)\b|exit code [1-9]/i.test(text)
}

export const durKey = (dir: string, sig: string): string => `dur:${dir}|${sig}`

// Backtest-like: the script/module/subcommand part of the signature (never the
// interpreter, never other arguments) names one of the research words, on a
// word boundary: a non-letter before it and, for grid and spa, a non-letter
// after it (gridlines, space never match; grid_search.py, spa_test.py do).
// The longer words may run on (backtester, sweeps, optimizer, walkforward_v2).
// Or the script's file name starts with run_.
const WORDS = new RegExp(
  '(^|[^A-Za-z])(' +
    'backtest[A-Za-z]*|sweep[A-Za-z]*|walk[-_]?forward[A-Za-z]*|optimi[sz][A-Za-z]*|' +
    'monte[-_]?carlo[A-Za-z]*|bootstrap[A-Za-z]*|reality[-_]?check[A-Za-z]*|replay[A-Za-z]*|' +
    'grid(?![A-Za-z])|spa(?![A-Za-z])' +
    ')',
  'i',
)

export function isBacktest(sig: string | null): sig is string {
  if (!sig) return false
  const words = sig.split(' ')
  let k = 0
  while (k < words.length && ['uv', 'poetry', 'run', 'python', '-m'].includes(words[k]!)) k++
  const rest = words.slice(k)
  const script = rest[0]
  if (script === undefined) return false
  if (/^run_/.test(script.split('/').pop() ?? '')) return true
  return WORDS.test(rest.join(' '))
}

export const minutes = (ms: number): string => (ms / 60_000).toFixed(1)

export function denyText(sig: string, ms: number): string {
  return `long-run: \`${sig}\` is a long run; re-run with run_in_background: true (last run took ${minutes(ms)}m). You will be notified when it ends.`
}

export function nudgeText(sig: string, ms: number): string {
  return `long-run: \`${sig}\` took ${minutes(ms)}m in the foreground. Run it with run_in_background: true next time; a foreground re-run will be refused, and you get a notification when a background run ends.`
}

export function notifyText(sig: string, ms?: number): string {
  return ms === undefined ? `finished ${sig}` : `finished ${sig} (${minutes(ms)}m)`
}

// Background task ID from a Bash result: the structured field first, then only
// the engine's own wording "... was moved to the background (ID: abc123) ...".
// Never a bare "ID: x": a backtest prints "Trade ID: 42" or "Run ID: r1", and
// taking that as a move to the background would leave the run untimed.
export function backgroundId(result: unknown, text?: string): string | null {
  const r = (result ?? {}) as { backgroundTaskId?: unknown; stdout?: unknown }
  if (typeof r.backgroundTaskId === 'string' && r.backgroundTaskId) return r.backgroundTaskId
  for (const s of [text, typeof r.stdout === 'string' ? r.stdout : undefined]) {
    const m = s?.match(/moved to the background \(ID: ?([A-Za-z0-9_-]+)\)/)
    if (m?.[1]) return m[1]
  }
  return null
}

// key is absent on entries written before runs were keyed by directory.
export type Pending = Record<string, { sig: string; key?: string; startedAt: number }>

// IDs of pending background runs that a notification's text names, whole-token.
export function namedIds(text: string, pending: Pending): string[] {
  return Object.keys(pending).filter(id => new RegExp(`(^|[^A-Za-z0-9_-])${id.replace(/[-]/g, '\\-')}($|[^A-Za-z0-9_-])`).test(text))
}
