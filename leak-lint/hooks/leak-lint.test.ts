import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { FIT, isTradingPy, scan } from './lib'

const rules = (code: string) => scan(code).map(f => f.rule)

// ---- positive cases: each rule fires on the pattern it names ----
const POSITIVE: [string, string][] = [
  ['shift(-N)', "df['fwd'] = df.close.shift(-1)"],
  ['shift(-N)', 'y = s.shift(periods=-5)'],
  ['forward index [i+k]', 'if df.close.iloc[i+1] > lvl: trades.append(i)'],
  ['forward index [i+k]', 'signal = bars[i + k] > 0'],
  ['future-window aggregate', 'hi = df.high.iloc[i:i+30].max()'],
  ['future-window aggregate', "lo = df['low'][entry_idx:].min()"],
  ['future-named helper', 'if intraday_stop_after(df, t): continue'],
  ['fill at signal close', 'entry_price = df.close.iloc[i]'],
  ['bfill', 'df = df.bfill()'],
  ['bfill', "x = x.fillna(method='bfill')"],
  ['centered window', 'm = s.rolling(20, center=True).mean()'],
  ['full-sample z-score', 'z = (ret - ret.mean()) / ret.std()'],
  ['scaler fit on full data', `Xs = scaler.${FIT}_transform(X)`],
  ['full-sample quantiles', 'df["bin"] = pd.qcut(df.vol, 5)'],
]

for (const [rule, code] of POSITIVE) {
  test(`flags ${rule}: ${code}`, () => {
    expect(rules(code)).toContain(rule)
  })
}

// ---- negative cases: honest code stays quiet ----
const CLEAN = [
  "df['prev'] = df.close.shift(1)",
  'm = s.rolling(20).mean()',
  'p = df.close.iloc[i-1]',
  'hi = df.high.iloc[i-20:i].max()',
  'entry_price = df.open.iloc[i+1]',
  'entry = float(o5[i + 1]) + slip',
  'nxt = day.iloc[i+1]',
  'if signal[t] != 0 and sess[t + 1] == sess[t]:',
  'if want != 0: ent, et = o[j + 1], int(mi[j + 1])',
  'stop = float(l[b:mi + 1].min()) - PAD',
  'ext = s.h[a:j + 1].max()',
  `Xs = scaler.${FIT}_transform(X_train)`,
  'df = df.ffill()',
  '# y = df.close.shift(-1)  (commented out)',
  'y = df.close.shift(-1)  # leak-ok: label only',
  's = "price # not a comment"',
  'z = (ret - mu_train) / sd_train',
]

test('clean code yields no findings', () => {
  for (const code of CLEAN) expect(scan(code)).toEqual([])
})

test('docstrings are skipped', () => {
  expect(scan('"""\nexample: df.shift(-1)\n"""\nx = 1')).toEqual([])
})

test('line numbers are 1-based within the text', () => {
  expect(scan('a = 1\nb = df.bfill()\n')[0]?.line).toBe(2)
})

test('path filter: .py under a trading root only', () => {
  const roots = ['/h/Trading', '/h/nq_bot']
  expect(isTradingPy('/h/Trading/x/a.py', roots)).toBe(true)
  expect(isTradingPy('/h/NQ_BOT/sub/b.py', roots)).toBe(true)
  expect(isTradingPy('/h/Trading/x/a.md', roots)).toBe(false)
  expect(isTradingPy('/h/YouTube/a.py', roots)).toBe(false)
  expect(isTradingPy('/h/nq_bot_v2/a.py', roots)).toBe(false)
})

// ---- the hook end to end, through a real tool.call ----
function engine(on: On, toasts: string[]) {
  mock.env(on, { HOME: '/h' })
  on('fs.list', () => ({ value: [{ name: 'nq_bot', kind: 'other', size: 0, mtimeMs: 0, isLink: true }] }))
  on('fs.stat', () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: true, realPath: '/h/nq_bot' } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {} }))
}

test('a leaky Write in a trading repo toasts and adds context', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts)
  const r = await $.tool.call({ tool: 'Write', file_path: '/h/nq_bot/sig.py', content: 'y = df.close.shift(-1)\n' })
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('shift(-N)')
  expect(String(r.context ?? '')).toContain('leak-lint')
})

test('clean code, or a file outside trading repos, stays quiet', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts)
  await $.tool.call({ tool: 'Write', file_path: '/h/nq_bot/ok.py', content: 'y = df.close.shift(1)\n' })
  await $.tool.call({ tool: 'Write', file_path: '/h/YouTube/x.py', content: 'y = df.close.shift(-1)\n' })
  await $.tool.call({ tool: 'Edit', file_path: '/h/Trading/a.md', old_string: 'a', new_string: 'df.bfill()' })
  expect(toasts).toEqual([])
})

test('an Edit is judged on its new text', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts)
  await $.tool.call({ tool: 'Edit', file_path: '/h/Trading/p/a.py', old_string: 'x', new_string: 'df = df.bfill()' })
  expect(toasts[0]).toContain('bfill')
})
