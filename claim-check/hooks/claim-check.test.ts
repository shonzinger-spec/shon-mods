import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { check, extractClaims, numbersIn } from './lib'

const show = (text: string) => extractClaims(text).map(c => `${c.kind} ${c.raw}${c.isPercent ? '%' : ''}`)
const backed = (reply: string, corpus: string) => extractClaims(reply).map(c => check(c, numbersIn(corpus)).isBacked)

// ---- extraction ----
test('extracts each metric spelling', () => {
  expect(show('PF 1.31, profit factor of 1.29, PF=1.4 and Sharpe 0.85')).toEqual(['PF 1.31', 'PF 1.29', 'PF 1.4', 'Sharpe 0.85'])
  expect(show('win rate 54% and WR 54.2%, Sharpe ratio: 1.1')).toEqual(['WR 54%', 'WR 54.2%', 'Sharpe 1.1'])
  expect(show('t=2.1, t 2.1, t-stat 2.1, t -2.17, T-stat of 3')).toEqual(['t 2.1', 't 2.1', 't 2.1', 't -2.17', 't 3'])
})

test('markdown tables and emphasis are extracted', () => {
  expect(show('| PF | Sharpe | WR |\n|---|---|---|\n| 1.42 | 0.85 | 54% |')).toEqual(['PF 1.42', 'Sharpe 0.85', 'WR 54%'])
  expect(show('PF: **1.42**, Sharpe **0.85**')).toEqual(['PF 1.42', 'Sharpe 0.85'])
  expect(show('**PF** 1.42 and **PF:** 1.3 and __WR__ _54%_')).toEqual(['PF 1.42', 'PF 1.3', 'WR 54%'])
  expect(show('| PF | 1.42 |')).toEqual(['PF 1.42'])
  expect(show('| Strategy | PF | t | n |\n|:---|---:|---|---|\n| A | **1.42** | -2.1 | 212 |\n| B | 0.97 | 1.3 | 90 |\n\n| 5 | 6 |'))
    .toEqual(['PF 1.42', 't -2.1', 'PF 0.97', 't 1.3'])
  // a row naming its metric under a metric column counts once
  expect(show('| Metric | PF |\n|---|---|\n| PF | 1.42 |')).toEqual(['PF 1.42'])
})

test('tables without metric columns, and identifiers, give nothing', () => {
  expect(show('| Files | Lines |\n|---|---|\n| 12 | 400 |')).toEqual([])
  expect(show('| T | x |\n|---|---|\n| 3 | 4 |')).toEqual([])
  expect(show('sharpe_ratio=1.1, x_PF 2, PF_x 3')).toEqual([])
})

test('words and lookalikes are not mis-extracted', () => {
  expect(show('sized at 1.5x, a Sharpe-like 1.2 score, I don\'t 3 times, part 3, PFX 2.0, wrap 4')).toEqual([])
  expect(show('the fix and test pass; 12 files changed')).toEqual([])
})

// ---- matching ----
test('rounded match: corpus 1.3127 backs PF 1.31 but not PF 1.32', () => {
  expect(backed('PF 1.31', 'profit_factor=1.3127')).toEqual([true])
  expect(backed('PF 1.32', 'profit_factor=1.3127')).toEqual([false])
  expect(backed('PF 1.310', 'pf 1.3')).toEqual([false])
})

test('percent equivalence both ways for win rate', () => {
  expect(backed('WR 54%', 'win_rate 0.5412')).toEqual([true])
  expect(backed('win rate 54.2%', 'wr=54.18')).toEqual([true])
  expect(backed('win rate 0.54', 'hit 54.0%')).toEqual([true])
  expect(backed('WR 61%', 'win_rate 0.5412')).toEqual([false])
})

test('sign is kept: t -2.17 needs a negative corpus number', () => {
  expect(backed('t -2.17', 'tstat=-2.1693')).toEqual([true])
  expect(backed('t -2.17', 'tstat=2.17')).toEqual([false])
  expect(backed('t 1.5', 'range 1.2-1.5')).toEqual([true])
})

test('integers round at zero decimals', () => {
  expect(backed('t 3', 't=3.4')).toEqual([true])
  expect(backed('t 3', 't=3.6')).toEqual([false])
})

// ---- end to end through the hooks ----
function engine(on: On, toasts: string[], toolText: string, rows: unknown[] = [], toolContext?: string[]) {
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {}, text: toolText, context: toolContext }) as never)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('session.messages', () => ({ value: rows }) as never)
}

const turn = (answer: string) => ({ answer, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const })
const RUN = { command: 'claims', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } } as never

test('an unbacked PF in the reply toasts once and /claims lists it', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts, 'n=212 profit_factor=1.3127 sharpe=0.8512')
  await $.tool.call({ tool: 'Bash', command: 'python bt.py' })
  await $.turn.complete(turn('Result: PF 1.42, Sharpe 0.85, t 2.9.'))
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('2 unbacked metric(s): PF 1.42, t 2.9')
  const r = await $.command.run(RUN)
  expect(r.text ?? '').toContain('UNBACKED  PF 1.42  (nearest corpus number: 1.3127)')
  expect(r.text ?? '').toContain('backed    Sharpe 0.85')
})

test('a rounded match stays quiet', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts, 'profit_factor=1.3127')
  await $.tool.call({ tool: 'Bash', command: 'python bt.py' })
  await $.turn.complete(turn('The honest PF 1.31 fails the gate.'))
  expect(toasts).toEqual([])
})

test('a number from the user prompt backs the reply', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts, '')
  await $.prompt.submit({ text: 'last run gave WR 0.538, is that ok?', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete(turn('A win rate of 54% is fine.'))
  expect(toasts).toEqual([])
})

test('a reply with no metrics stays quiet', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts, 'ok')
  await $.turn.complete(turn('Renamed the file and the tests pass at 1.5x speed.'))
  expect(toasts).toEqual([])
  const r = await $.command.run(RUN)
  expect(r.text ?? '').toContain('quoted no PF')
})


test('an invented PF in a markdown results table toasts', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts, 'profit_factor=1.3127 sharpe=0.8512')
  await $.tool.call({ tool: 'Bash', command: 'python bt.py' })
  await $.turn.complete(turn('| PF | Sharpe |\n|---|---|\n| 1.42 | 0.85 |'))
  expect(toasts).toEqual(['claim-check: 1 unbacked metric(s): PF 1.42. /claims for detail'])
})

test('after /clear the old conversation no longer backs claims', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts, 'profit_factor=1.3127')
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.tool.call({ tool: 'Bash', command: 'python bt.py' })
  await $.turn.complete(turn('PF 1.31'))
  expect(toasts).toEqual([])
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: 's1' } as never)
  expect((await $.command.run(RUN)).text ?? '').toContain('no reply checked yet')
  await $.turn.complete(turn('PF 1.31'))
  expect(toasts).toEqual(['claim-check: 1 unbacked metric(s): PF 1.31. /claims for detail'])
})

test('a tool result already in the transcript backs the reply after a resume or reload', async ($, on) => {
  const toasts: string[] = []
  const rows = [
    { role: 'user', text: 'run the backtest', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'u1', text: 'n=212 profit_factor=1.3127', isError: false }] },
    { role: 'assistant', text: 'PF 1.31', toolUses: [] },
  ]
  engine(on, toasts, '', rows)
  await $.turn.complete(turn('PF 1.31'))
  expect(toasts).toEqual([])
})

test('the transcript does not back a number it does not hold', async ($, on) => {
  const toasts: string[] = []
  const rows = [{ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'u1', text: 'profit_factor=1.3127', isError: false }] }]
  engine(on, toasts, '', rows)
  await $.turn.complete(turn('PF 1.42'))
  expect(toasts.length).toBe(1)
})

test('context another hook put beside the prompt backs the reply', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts, '')
  await $.prompt.submit({
    text: 'what about Socrates?',
    context: ['kill-ledger: honest PF 0.90 IS, forward post-freeze PF 0.76 -$7k t -2.07'],
    wait: false,
    origin: { kind: 'composer' },
  } as never)
  await $.turn.complete(turn('Already killed: PF 0.76, t -2.07.'))
  expect(toasts).toEqual([])
})

test('context added after a tool result backs the reply', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts, 'ok', [], ['kill-ledger: honest PF 0.90 IS'])
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.turn.complete(turn('That was PF 0.90.'))
  expect(toasts).toEqual([])
})
