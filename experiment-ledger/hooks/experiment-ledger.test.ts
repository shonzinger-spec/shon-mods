import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { IDEA_CAP, READ_CAP } from './lib'

const LEDGER = '/h/Trading/_ledger/experiments.jsonl'
const POLICY = '/h/.claude/verdict/policy.json'

type R = Record<string, unknown>
const row = (o: R): R => ({
  slug: 's', variant: 'v1', data_file: 'NQ_1m.parquet', n_trades: 120, pf: 1.1, t_stat: 1.2, p_value: 0.2, p_kind: 'RC',
  basis: 'NET', null_kind: 'flip', null_pf: 0.95, verdict: 'FAIL', blocked_by: [], script: 'x.py', ...o,
})
const jsonl = (rows: R[]): string => rows.map(r => JSON.stringify(r)).join('\n') + '\n'

const BASE = jsonl([
  row({ date: '2026-10-01T10:00:00+00:00', idea: 'orb-nq', variant: 'v1', verdict: 'PASS', pf: 1.31 }),
  row({ date: '2026-10-05T10:00:00+00:00', idea: 'orb-nq', variant: 'v2', verdict: 'FAIL', pf: 0.91, t_stat: -1.5 }),
  row({ date: '2026-10-03T10:00:00+00:00', idea: 'gold-tom', variant: 'a', verdict: 'PASS', pf: 1.4, p_value: 0.031,
    basis: 'GROSS', null_kind: 'random_entry', null_pf: 1.02 }),
  row({ date: '2026-10-04T10:00:00+00:00', idea: 'gold-tom', variant: 'b', verdict: 'INCONCLUSIVE', blocked_by: ['cost_gate', 'null_first'] }),
])

type Files = Record<string, string>
type Seen = { argv: string[][] }

function engine(on: On, files: Files, seen: Seen = { argv: [] }, tail?: string): void {
  mock.env(on, { HOME: '/h' })
  on('fs.stat', (_, e) => {
    const t = files[e.path]
    return t === undefined ? { deny: 'ENOENT' } : { value: { kind: 'file', size: t.length, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', (_, e) => {
    const t = files[e.path]
    return t === undefined ? { deny: 'ENOENT' } : { value: t }
  })
  on('process.run', (_, e) => {
    seen.argv.push([...e.argv])
    return { value: { exitCode: 0, stdout: tail ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

const cmd = (args = '') => ({ command: 'experiments', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false } }) as never
const text = (r: unknown): string => String((r as { text?: string }).text ?? '')

test('no argument: totals, verdict counts, newest rows first, per-idea counts', async ($, on) => {
  engine(on, { [LEDGER]: BASE })
  const t = text(await $.command.run(cmd()))
  expect(t).toContain('4 rows (~/Trading/_ledger/experiments.jsonl)')
  expect(t).toContain('FAIL 1')
  expect(t).toContain('PASS 2')
  expect(t).toContain('INCONCLUSIVE 1')
  const lines = t.split('\n')
  const first = lines.findIndex(l => l.includes('most recent'))
  expect(lines[first + 1]).toContain('2026-10-05  orb-nq  v2  pf 0.91  t -1.50  p 0.2 RC  NET  flip 0.95  FAIL')
  expect(t).toContain('2026-10-03  gold-tom  a  pf 1.40  t 1.20  p 0.031 RC  GROSS  random_entry 1.02  PASS')
  expect(t).toContain('INCONCLUSIVE  blocked cost_gate,null_first')
  expect(t).toContain('orb-nq  2  latest FAIL 2026-10-05')
  expect(t).toContain('gold-tom  2  latest INCONCLUSIVE 2026-10-04')
  expect(t).not.toContain('malformed')
})

test('/experiments <idea>: only that idea, latest FAIL is flagged as killed', async ($, on) => {
  engine(on, { [LEDGER]: BASE })
  const t = text(await $.command.run(cmd('orb-nq')))
  expect(t).toContain('2 rows for idea "orb-nq"')
  expect(t).toContain('latest: 2026-10-05  v2')
  expect(t).toContain('kill-ledger: KILLED (latest is FAIL; entry ledger:orb-nq')
  expect(t).not.toContain('gold-tom')
})

test('an idea whose latest row is not FAIL is not killed, though an older row failed', async ($, on) => {
  const later = BASE + jsonl([row({ date: '2026-10-09T10:00:00+00:00', idea: 'orb-nq', variant: 'v3', verdict: 'PASS' })])
  engine(on, { [LEDGER]: later })
  const t = text(await $.command.run(cmd('ORB-NQ')))
  expect(t).toContain('3 rows for idea "orb-nq"')
  expect(t).toContain('kill-ledger: not killed (latest is PASS')
})

test('missing ledger: says why, with the policy rule state', async ($, on) => {
  engine(on, {})
  expect(text(await $.command.run(cmd()))).toContain(
    'no ledger yet: write_verdict() appends once policy rule experiment_ledger is on (now: off)',
  )
})

test('missing ledger with the rule on says on', async ($, on) => {
  engine(on, { [POLICY]: JSON.stringify({ schema: 'policy/1', rules: { experiment_ledger: true } }) })
  expect(text(await $.command.run(cmd('orb-nq')))).toContain('(now: on)')
})

test('malformed lines are skipped and counted', async ($, on) => {
  engine(on, { [LEDGER]: `${BASE}{"idea": "orb-nq", broken\n[1,2]\n\nnot json\n` })
  const t = text(await $.command.run(cmd()))
  expect(t).toContain('4 rows; 3 malformed lines skipped')
})

// write_verdict() uses Python json.dumps, which writes a bare Infinity / NaN token for pf inf (a variant
// with no losing trade); build_index.py's json.loads reads it, so these rows count here too.
const pyRow = (date: string, verdict: string, pf: string, extra = ''): string =>
  `{"date": "${date}", "slug": "s", "idea": "orb-nq", "variant": "NaN \\"Infinity\\"", "pf": ${pf}, "t_stat": NaN, ` +
  `"p_value": 0.2, "null_kind": "flip", "null_pf": -Infinity, "verdict": "${verdict}"${extra}}`

test('a newest FAIL row with a bare Infinity pf is read, not malformed, and kills the idea', async ($, on) => {
  engine(on, { [LEDGER]: `${BASE}${pyRow('2026-10-09T10:00:00+00:00', 'FAIL', 'Infinity')}\n` })
  const t = text(await $.command.run(cmd('orb-nq')))
  expect(t).toContain('3 rows for idea "orb-nq"')
  expect(t).toContain('kill-ledger: KILLED (latest is FAIL')
  expect(t).toContain('latest: 2026-10-09  NaN "Infinity"  pf inf  t nan  p 0.2  -  flip -inf  FAIL')
  expect(t).not.toContain('malformed')
})

test('a newest PASS row with a bare Infinity pf is read, so an older FAIL does not kill the idea', async ($, on) => {
  const failed = jsonl([row({ date: '2026-10-01T10:00:00+00:00', idea: 'orb-nq', verdict: 'FAIL' })])
  engine(on, { [LEDGER]: `${failed}${pyRow('2026-10-09T10:00:00+00:00', 'PASS', 'Infinity')}\n` })
  const t = text(await $.command.run(cmd('orb-nq')))
  expect(t).toContain('kill-ledger: not killed (latest is PASS')
  expect(t).not.toContain('malformed')
  const s = text(await $.command.run(cmd()))
  expect(s).toContain('2 rows (')
  expect(s).toContain('orb-nq  2  latest PASS 2026-10-09')
})

test('a bare token in a broken line still counts as malformed', async ($, on) => {
  engine(on, { [LEDGER]: `${BASE}{"idea": "orb-nq", "pf": Infinity, broken\n{"pf": Infinityx}\n` })
  expect(text(await $.command.run(cmd()))).toContain('4 rows; 2 malformed lines skipped')
})

test('an unknown idea says there are no rows', async ($, on) => {
  engine(on, { [LEDGER]: BASE })
  const t = text(await $.command.run(cmd('vwap-drift')))
  expect(t).toContain('no rows for idea "vwap-drift"')
  expect(t).toContain('2 ideas in the ledger')
  expect(t).not.toContain('KILLED')
})

test('output stays under 60 lines for a big ledger, and says what it left out', async ($, on) => {
  const many: R[] = []
  for (let i = 0; i < 80; i++) many.push(row({ date: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00`, idea: 'orb-nq', variant: `v${i}` }))
  for (let i = 0; i < 30; i++) many.push(row({ date: '2026-08-01', idea: `idea-${i}` }))
  engine(on, { [LEDGER]: jsonl(many) })
  const all = text(await $.command.run(cmd()))
  expect(all.split('\n').length).toBeLessThan(60)
  expect(all).toContain('ideas (top 10 of 31')
  const one = text(await $.command.run(cmd('orb-nq')))
  expect(one.split('\n').length).toBeLessThan(60)
  expect(one).toContain(`${80 - IDEA_CAP} older rows omitted`)
})

test('a ledger past the read cap is read by its tail, cut first line dropped, and says so', async ($, on) => {
  const seen: Seen = { argv: [] }
  const big = 'x'.repeat(READ_CAP + 10)
  const tail = `ate": "2026-01-01", "idea": "cut"}\n${jsonl([row({ date: '2026-10-10', idea: 'tail-idea' })])}`
  engine(on, { [LEDGER]: big }, seen, tail)
  const t = text(await $.command.run(cmd()))
  expect(seen.argv[0]).toEqual(['tail', '-c', String(READ_CAP), LEDGER])
  expect(t).toContain('1 row (')
  expect(t).not.toContain('malformed')
  expect(t).toContain('read only the last 4.0 MB of 4.0 MB')
  expect(t).toContain('tail-idea')
})

test('session start registers /experiments', async ($, on) => {
  const names: string[] = []
  engine(on, {})
  on('session.start', () => ({ cwd: '/h' }))
  on('command.register', (_, e) => {
    names.push(e.name)
    return { value: { command: e.name } }
  })
  await $.session.start({ cwd: '/h', surface: 'desktop', isInteractive: true })
  expect(names).toEqual(['experiments'])
})
