import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { costsOf, costsText, floorFor, isTradingPy, nameInfo, scan } from './lib'

const NQ = { symbol: 'NQ', rtPts: 0.9 }
const kinds = (code: string, floor: typeof NQ | null = null) => scan(code, floor).map(f => `${f.name}:${f.kind}`)

// ---- the matcher ----
test('zero and negative costs fire in every form', () => {
  expect(kinds('commission = 0')).toEqual(['commission:zero'])
  expect(kinds('self.slippage: float = 0.0')).toEqual(['slippage:zero'])
  expect(kinds('res = run(df, fee=0, slip_mult=0.0)')).toEqual(['fee:zero', 'slip_mult:zero'])
  expect(kinds('def bt(df, cost_per_trade=0.0):')).toEqual(['cost_per_trade:zero'])
  expect(kinds('cfg = {"commission": 0, "rt_cost": -1.5}')).toEqual(['commission:zero', 'rt_cost:negative'])
  expect(kinds('p.add_argument("--slippage-ticks", type=float, default=0)')).toEqual(['slippage_ticks:zero'])
})

test('a points cost below the floor fires only with a floor; per side counts twice', () => {
  expect(kinds('slippage_pts = 0.25', NQ)).toEqual(['slippage_pts:below-floor'])
  expect(kinds('SLIP_PT = 0.25  # 1 tick per side', NQ)).toEqual(['SLIP_PT:below-floor'])
  expect(kinds('slippage_pts = 0.25')).toEqual([])
  expect(kinds('slippage_pts = 1.0', NQ)).toEqual([])
  expect(kinds('SLIPPAGE_PTS = 0.5  # MNQ pts per side', NQ)).toEqual([])
  expect(kinds('COST_PT = 0.5  # MES round trip in ES points', NQ)).toEqual([])
})

test('CG-1: per fill / each way / per leg / doubled in code count as per side', () => {
  expect(kinds('SLIP_PT = 0.5  # per fill, applied entry + exit', NQ)).toEqual([])
  expect(kinds('SLIP_PTS = 0.5  # each way', NQ)).toEqual([])
  expect(kinds('SLIP_PTS = 0.5  # per leg', NQ)).toEqual([])
  expect(kinds('SLIP_PTS = 0.5  # charged on entry and exit', NQ)).toEqual([])
  expect(kinds('SLIP_PTS = 0.5\nCOST_RT = 2 * SLIP_PTS', NQ)).toEqual([])
  expect(kinds('SLIP_PTS = 0.5\nrt = SLIP_PTS * 2', NQ)).toEqual([])
  // still below the floor once doubled
  expect(kinds('SLIP_PT = 0.25  # per fill', NQ)).toEqual(['SLIP_PT:below-floor'])
  expect(kinds('SLIP_PTS = 0.25\nCOST_RT = 2 * SLIP_PTS', NQ)).toEqual(['SLIP_PTS:below-floor'])
  expect(kinds('SLIP_PTS = 0.5\nrt = SLIP_PTS * 2.5', NQ)).toEqual(['SLIP_PTS:below-floor'])
})

test('CG-2: slippage, commission and fee parts are summed against the round-trip floor', () => {
  expect(kinds('SLIP_PT = 0.39  # per side\nCOMM_PT = 0.062  # per side\nCOST_RT = 2*(SLIP_PT+COMM_PT)', NQ)).toEqual([])
  expect(kinds('SLIP_PTS = 0.78\nCOMM_PTS = 0.124\nCOST_PTS = SLIP_PTS + COMM_PTS', NQ)).toEqual([])
  // parts that still add up short of the floor warn on each part
  expect(kinds('SLIP_PT = 0.25  # per side\nCOMM_PT = 0.062  # per side', NQ)).toEqual(['SLIP_PT:below-floor', 'COMM_PT:below-floor'])
  // a total-cost name is judged on its own, not summed with the parts
  expect(kinds('SLIP_PTS = 0.78\nCOST_PTS = 0.5', NQ)).toEqual(['SLIP_PTS:below-floor', 'COST_PTS:below-floor'])
})

test('dollar and tick names get the zero check only', () => {
  expect(kinds('commission = 2.5', NQ)).toEqual([])
  expect(kinds('commission_usd_rt = 0.5', NQ)).toEqual([])
  expect(kinds('slippage_ticks = 0.5', NQ)).toEqual([])
})

test('quiet: silencer, comments, docstrings, strings, totals, records, state', () => {
  const quiet = [
    'commission = 0  # cost-ok: gross reference run',
    '# commission = 0',
    'label = "cost=0, slip=0"',
    'if fee == 0: pass',
    'total_cost = 0',
    'max_slip = 0',
    'funded_fee_mo = 0',
    'slip_extra = 0.0',
    'fees = 0\nfor t in trades:\n    fees += t.fee',
    't = Trade(gross_pnl=0.0, commission=0.0, slippage_cost=0.0, exit_reason="open")',
    'slip_in = 0.0\nif e:\n    fi = e; slip_in = tick',
    'spread = 0',
    'common = 0',
  ]
  for (const code of quiet) expect(kinds(code, NQ)).toEqual([])
  expect(kinds('"""\nexample: commission = 0\n"""\nx = 1')).toEqual([])
})

test('names: word parts, not substrings', () => {
  expect(nameInfo('comm').isCost).toBe(true)
  expect(nameInfo('commissionPerSide').isCost).toBe(true)
  expect(nameInfo('recommend').isCost).toBe(false)
  expect(nameInfo('slip_pts').isPoints).toBe(true)
  expect(nameInfo('slip_ticks').isPoints).toBe(false)
})

test('floor: lowest measured symbol the file names', () => {
  const c = costsOf({ costs: { _comment: 'x', NQ: { rt_pts: 0.9 }, MNQ: { rt_pts: 0.9 } } })
  expect(floorFor('df = load("MNQ_1m.parquet")', c)?.rtPts).toBe(0.9)
  expect(floorFor('df = load("nq_1m")', c)?.symbol).toBe('NQ')
  expect(floorFor('df = load("GC_1m")', c)).toBe(null)
  expect(floorFor('NQ', null)).toBe(null)
})

// ---- review round (CG-R1..R5) ----
test('CG-R1: a component built from an expression counts toward the sum', () => {
  // bt_noise_mom.py: 2 * (0.25 + 0.62 / 2) = 1.12 pt RT, above the floor
  const noiseMom = 'PTVAL_MNQ = 2\nSLIP_PT = 0.25          # 1 tick per side\nCOMM_PT = 0.62 / PTVAL_MNQ   # $0.62 per side in points\nCOST_RT = 2 * (SLIP_PT + COMM_PT)'
  expect(kinds(noiseMom, NQ)).toEqual([])
  // the real file imports PTVAL_MNQ: the sum is unknown, so no below-floor verdict
  const imported = 'from data_common import PTVAL_MNQ\nSLIP_PT = 0.25  # 1 tick per side\nCOMM_PT = 0.62 / PTVAL_MNQ\nCOST_RT = 2 * (SLIP_PT + COMM_PT)'
  expect(kinds(imported, NQ)).toEqual([])
  // an expression that still sums short of the floor warns; zero still warns
  expect(kinds('SLIP_PT = 0.25  # per side\nCOMM_PT = 0.1 / 2  # per side', NQ)).toEqual(['SLIP_PT:below-floor'])
  expect(kinds('SLIP_PT = 0\nCOMM_PT = 0.62 / PTVAL', NQ)).toEqual(['SLIP_PT:zero'])
  // an alias or a kwarg pass-through adds nothing and hides nothing
  expect(kinds('SLIP_PTS = 0.25\nslip_pts = SLIP_PTS\nrun(df,\n    slip_pts=SLIP_PTS,\n)', NQ)).toEqual(['SLIP_PTS:below-floor'])
})

test('CG-R2: zero fields of a trade/report record class are quiet, a config class still warns', () => {
  expect(kinds('@dataclass\nclass Trade:\n    pnl: float = 0.0\n    commission: float = 0.0\n    slippage: float = 0.0')).toEqual([])
  expect(kinds('@dataclass\nclass DriftReport:\n    n_trades: int = 0\n    backtest_assumed_slip_usd: float = 0.0')).toEqual([])
  expect(kinds('@dataclass\nclass Position:\n    entry_price: float = 0.0\n    exit_reason: str = ""\n    fees: float = 0.0')).toEqual([])
  expect(kinds('@dataclass\nclass BacktestConfig:\n    commission: float = 0.0\n    window: int = 20')).toEqual(['commission:zero'])
  expect(kinds('class TradeConfig:\n    slippage: float = 0.0')).toEqual(['slippage:zero'])
})

test('CG-R3: on an Edit, running totals and state are read from the whole file', () => {
  const whole = 'def f(trades):\n    fees = 0.0\n    for t in trades:\n        fees += t.fee\n    return fees\n'
  expect(scan('    fees = 0.0', null, whole)).toEqual([])
  const state = 'slip_in = 0.0\nif e:\n    slip_in = tick\n'
  expect(scan('slip_in = 0.0', null, state)).toEqual([])
  // a record field edited on its own: the class is in the whole file
  const rec = '@dataclass\nclass Trade:\n    pnl: float = 0.0\n    commission: float = 0.0\n'
  expect(scan('    commission: float = 0.0', null, rec)).toEqual([])
  // a real zero in the hunk still warns
  expect(scan('    fees = 0.0', null, 'def f():\n    fees = 0.0\n    return run(fees)\n').map(f => f.kind)).toEqual(['zero'])
})

test('CG-R4: instance state set later to a computed value is quiet', () => {
  const pos = 'class Position:\n    def __init__(self):\n        self.slippage = 0.0\n    def fill(self, p, s):\n        self.slippage = p - s\n'
  expect(kinds(pos)).toEqual([])
  // a plain attribute setting that is never re-assigned still warns
  expect(kinds('class Cfg:\n    def __init__(self):\n        self.slippage = 0.0\n')).toEqual(['slippage:zero'])
})

test('CG-R5: paths, imports and other markets do not pick the NQ floor', () => {
  const c = costsOf({ costs: { NQ: { rt_pts: 0.9 }, MNQ: { rt_pts: 0.9 } } })
  const mgc = 'ROOT = Path.home() / "mnq-mgc-research"\nSYMBOL = "MGC"\nSLIPPAGE_PTS = 0.2\n'
  expect(floorFor(mgc, c)).toBe(null)
  expect(scan(mgc, floorFor(mgc, c))).toEqual([])
  const es = 'from nq_bot.data import load\ndf = load("ES_1m_clean")\nSLIP_PTS = 0.5\n'
  expect(floorFor(es, c)).toBe(null)
  // a file naming NQ and another market: the floor holds only on lines naming NQ
  const both = 'nq = load("NQ_1m")\nes = load("ES_1m")\nSLIP_PTS = 0.5\nNQ_SLIP_PTS = 0.25\n'
  expect(scan(both, floorFor(both, c)).map(f => `${f.name}:${f.kind}`)).toEqual(['NQ_SLIP_PTS:below-floor'])
  // another market named only in a docstring or comment does not count
  const doc = '"""Port of ~/Downloads/ICT_v6_MGC_DEPLOY.pine to MNQ."""\ndf = load("MNQ_1m")  # was MGC\nSLIP_PT = 0.25  # pts/side\n'
  expect(scan(doc, floorFor(doc, c)).map(f => `${f.name}:${f.kind}`)).toEqual(['SLIP_PT:below-floor'])
  // an NQ-only file still gets the floor
  const nq = 'df = load("NQ_1m")\nSLIP_PTS = 0.5\n'
  expect(scan(nq, floorFor(nq, c)).map(f => `${f.name}:${f.kind}`)).toEqual(['SLIP_PTS:below-floor'])
})

test('path filter: trading .py only, test_*.py skipped', () => {
  const roots = ['/h/Trading', '/h/nq_bot']
  expect(isTradingPy('/h/nq_bot/bt.py', roots)).toBe(true)
  expect(isTradingPy('/h/nq_bot/test_bt.py', roots)).toBe(false)
  expect(isTradingPy('/h/YouTube/bt.py', roots)).toBe(false)
  expect(isTradingPy('/h/Trading/notes.md', roots)).toBe(false)
})

// ---- /costs text ----
const BAD = {
  costs: {
    _comment: 'measured',
    NQ: { rt_pts: 0.9, rt_pts_open: 2.5, source: 'costflip 2026-10-07' },
    MNQ: { rt_pts: 0.9, rt_pts_open: 2.5, source: 'costflip 2026-10-07' },
  },
}
const POLICY_OFF = { schema: 'policy/1', rules: { cost_gate: false } }
const POLICY_ON = { schema: 'policy/1', rules: { cost_gate: true } }

test('/costs text: table and policy state', () => {
  const t = costsText(BAD, '/c.json', POLICY_OFF, '/p.json')
  expect(t).toContain('symbol  rt_pts midday  rt_pts open  source')
  expect(t).toContain('NQ      0.9            2.5          costflip 2026-10-07')
  expect(t).toContain('MNQ     0.9            2.5')
  expect(t.includes('_comment')).toBe(false)
  expect(t).toContain('policy cost_gate: off (/p.json)')
  expect(costsText(BAD, '/c.json', POLICY_ON, '/p.json')).toContain('policy cost_gate: ON')
  expect(costsText({ files: [] }, '/c.json', null, '/p.json')).toContain('/c.json has no "costs" section')
  expect(costsText(null, '/c.json', null, '/p.json')).toContain('policy cost_gate: off (no /p.json)')
})

// ---- the hooks end to end ----
type Seen = { toasts: string[] }

function engine(on: On, seen: Seen, files: Record<string, string>) {
  mock.env(on, { HOME: '/h' })
  on('fs.list', () => ({ value: [{ name: 'nq_bot', kind: 'other', size: 0, mtimeMs: 0, isLink: true }] }))
  on('fs.stat', () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: true, realPath: '/h/nq_bot' } }))
  on('fs.read', (_, e) => {
    const v = files[e.path]
    return v === undefined ? { deny: 'ENOENT' } : { value: v }
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {} }))
}

const COSTS_FILE = '/h/.claude/mods-src/bad-data/bad-data.json'
const POLICY_FILE = '/h/.claude/verdict/policy.json'
const FILES = { [COSTS_FILE]: JSON.stringify(BAD), [POLICY_FILE]: JSON.stringify(POLICY_OFF) }
const write = (file_path: string, content: string) => ({ tool: 'Write' as const, file_path, content })
const edit = (file_path: string, old_string: string, new_string: string) => ({ tool: 'Edit' as const, file_path, old_string, new_string })

test('Write commission=0 to a trading file toasts and adds context', async ($, on) => {
  const seen: Seen = { toasts: [] }
  engine(on, seen, FILES)
  const r = await $.tool.call(write('/h/nq_bot/bt.py', 'commission = 0\n'))
  expect(seen.toasts.length).toBe(1)
  expect(seen.toasts[0]).toContain('commission=0 L1')
  expect(String(r.context ?? '')).toContain('GROSS result')
  expect(r.deny).toBe(undefined)
})

test('Write slippage_pts=0.25 in an NQ file warns below the floor', async ($, on) => {
  const seen: Seen = { toasts: [] }
  engine(on, seen, FILES)
  const r = await $.tool.call(write('/h/Trading/x/bt.py', 'SYM = "NQ"\nslippage_pts = 0.25\n'))
  expect(seen.toasts[0]).toContain('slippage_pts=0.25 L2')
  expect(String(r.context ?? '')).toContain('measured NQ round trip 0.9 pts')
})

test('Edit adding fee=0 warns, line numbers from new_string', async ($, on) => {
  const seen: Seen = { toasts: [] }
  engine(on, seen, FILES)
  const r = await $.tool.call(edit('/h/nq_bot/bt.py', 'x = 1', 'x = 1\nres = run(df, fee=0)'))
  expect(seen.toasts[0]).toContain('fee=0 L2')
  expect(String(r.context ?? '')).toContain('in the edited text')
})

test('Edit below the floor uses the whole file to see NQ', async ($, on) => {
  const seen: Seen = { toasts: [] }
  engine(on, seen, { ...FILES, '/h/nq_bot/e.py': 'df = load("NQ_1m")\nslip_pts = 0.25\n' })
  await $.tool.call(edit('/h/nq_bot/e.py', 'slip_pts = 1.0', 'slip_pts = 0.25'))
  expect(seen.toasts[0]).toContain('slip_pts=0.25')
})

test('CG-2: an Edit of one part sums with the parts already in the file', async ($, on) => {
  const seen: Seen = { toasts: [] }
  const file = 'df = load("NQ_1m")\nSLIP_PT = 0.39  # per side\nCOMM_PT = 0.062  # per side\n'
  engine(on, seen, { ...FILES, '/h/nq_bot/p.py': file })
  await $.tool.call(edit('/h/nq_bot/p.py', 'SLIP_PT = 0.25  # per side', 'SLIP_PT = 0.39  # per side'))
  expect(seen.toasts).toEqual([])
})

test('normal work stays quiet', async ($, on) => {
  const seen: Seen = { toasts: [] }
  engine(on, seen, { ...FILES, '/h/nq_bot/old.py': 'commission = 0\nx = 1\n' })
  await $.tool.call(write('/h/nq_bot/a.py', 'commission = 2.5\n'))
  await $.tool.call(write('/h/nq_bot/b.py', 'SYM = "NQ"\nslippage_pts = 1.0\n'))
  await $.tool.call(write('/h/nq_bot/c.py', 'commission = 0  # cost-ok: gross reference\n'))
  await $.tool.call(write('/h/YouTube/d.py', 'commission = 0\n'))
  await $.tool.call(edit('/h/nq_bot/old.py', 'x = 1', 'x = 2'))
  await $.tool.call(write('/h/nq_bot/test_bt.py', 'commission = 0\n'))
  expect(seen.toasts).toEqual([])
})

const RUN = { command: 'costs', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false } } as never

test('/costs prints the table and the policy state', async ($, on) => {
  const seen: Seen = { toasts: [] }
  engine(on, seen, FILES)
  const t = String((await $.command.run(RUN)).text ?? '')
  expect(t).toContain(`Measured round-trip costs in points (${COSTS_FILE})`)
  expect(t).toContain('NQ      0.9            2.5          costflip 2026-10-07')
  expect(t).toContain(`policy cost_gate: off (${POLICY_FILE})`)
})

test('/costs with no costs section says so', async ($, on) => {
  const seen: Seen = { toasts: [] }
  engine(on, seen, { [COSTS_FILE]: JSON.stringify({ files: [] }) })
  const t = String((await $.command.run(RUN)).text ?? '')
  expect(t).toContain('has no "costs" section')
  expect(t).toContain('policy cost_gate: off (no ')
})
