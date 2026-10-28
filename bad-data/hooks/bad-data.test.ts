import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { findDefects, subject, type Defect } from './lib'

// The match strings as bad-data.json holds them.
const D: Defect[] = [
  { id: 'nq-kaggle-offset', match: 'NQ_1m_kaggle_clean', defect: '+1 minute off' },
  { id: 'es-new-bad-bars', match: 'ES_1m_new', defect: '6,231 corrupt bars', instead: 'ES_1m_clean or ES_1m_6mo' },
  { id: 'nq-primary-rolls', match: 'NQ_1m_primary', defect: 'unadjusted rolls' },
  { id: 'mgc-5m-hole', match: 'regex:(?<![\\w])MGC_5m\\.parquet|orbpb_MGC_5m\\.parquet', defect: '110-day hole' },
  { id: 'lse-dotF-rolls', match: 'regex:(?<![\\w])(?:ES|NQ|GC|SI)\\.F(?![\\w])', defect: 'roll method undisclosed' },
]
const ids = (t: string) => findDefects(t, D).map(d => d.id)

test('each defective file is recognised', () => {
  expect(ids("pd.read_parquet('nq_bot/NQ_1m_kaggle_clean.parquet')")).toEqual(['nq-kaggle-offset'])
  expect(ids('df = load("ES_1m_new.parquet")')).toEqual(['es-new-bad-bars'])
  expect(ids('data_cache/NQ_1m_primary.parquet')).toEqual(['nq-primary-rolls'])
  expect(ids('data/processed/MGC_5m.parquet')).toEqual(['mgc-5m-hole'])
  expect(ids('data/cache/orbpb_MGC_5m.parquet')).toEqual(['mgc-5m-hole'])
  expect(ids('lse.bars(symbol="NQ.F", start=...)')).toEqual(['lse-dotF-rolls'])
})

test('clean neighbours are not flagged', () => {
  expect(ids('nq_bot_v11/ES_1m_clean.parquet')).toEqual([])
  expect(ids('ES_1m_6mo.parquet NQ_1m_6mo.parquet')).toEqual([])
  expect(ids('data/processed/topstep/MGC_5m_topstep.parquet')).toEqual([])
  expect(ids('data/cache/orbpb_MGC_5m_topstep.parquet')).toEqual([])
  expect(ids('data/processed/MNQ_5m.parquet')).toEqual([])
  expect(ids('np.NQ.Fill(x); ES.Fx')).toEqual([])
})

test('search commands and prose files are not loads', () => {
  expect(subject('Bash', { command: 'grep -rn NQ_1m_primary src/' })).toBeNull()
  expect(subject('Write', { file_path: '/h/HANDOFF.md', content: 'ES_1m_new is bad' })).toBeNull()
  expect(subject('Bash', { command: 'python run.py --data ES_1m_new.parquet' })?.text).toContain('ES_1m_new')
  expect(subject('Glob', { pattern: '*.parquet' })).toBeNull()
})

function engine(on: On, toasts: string[]) {
  on('fs.read', () => ({ value: JSON.stringify({ files: D }) }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {} }))
}

test('code that loads a defective file toasts once and tells Claude each time', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts)
  const code = "import pandas as pd\nes = pd.read_parquet('nq_bot/ES_1m_new.parquet')\n"
  const r1 = await $.tool.call({ tool: 'Write', file_path: '/h/Trading/x/a.py', content: code })
  const r2 = await $.tool.call({ tool: 'Write', file_path: '/h/Trading/x/b.py', content: code })
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('ES_1m_new')
  expect(String(r1.context ?? '')).toContain('ES_1m_clean')
  expect(String(r2.context ?? '')).toContain('6,231')
})

test('ordinary calls pass untouched', async ($, on) => {
  const toasts: string[] = []
  engine(on, toasts)
  const r = await $.tool.call({ tool: 'Bash', command: 'python backtest.py --data ES_1m_6mo.parquet' })
  await $.tool.call({ tool: 'Read', file_path: '/h/Trading/nq_bot/README.md' })
  expect(toasts).toEqual([])
  expect(r.context).toBeUndefined()
})
