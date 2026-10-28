import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { aliasRe, dropData, isNamed, match, ownWords, type Index } from './lib'

const IDX: Index = {
  built_at: 'x',
  memory_dir: '/mem',
  entries: {
    'project_orb_topstep.md': {
      file: 'project_orb_topstep.md', label: 'l', section: '🛑 NQ intraday directional kills', status: 'killed',
      emoji: '🛑', date: '2026-08-07', date_src: 'text', reason: 'TopStep first-breakout ORB: all 8 combos negative',
    },
    'project_tabby_qt7h.md': {
      file: 'project_tabby_qt7h.md', label: 'l', section: '', status: 'killed',
      emoji: '🛑', date: '2026-10-09', date_src: 'text', reason: 'QT+7H KILLED: TV 2026 holdout PF 0.89',
    },
    'project_sweep_reclaim.md': {
      file: 'project_sweep_reclaim.md', label: 'l', section: '', status: 'killed',
      emoji: '🛑', date: '2026-10-09', date_src: 'text', reason: 'Sweep & Reclaim 0/6',
    },
    'project_lilfish_replication.md': {
      file: 'project_lilfish_replication.md', label: 'l', section: '', status: 'killed',
      emoji: '🛑', date: '2026-10-05', date_src: 'text', reason: 'first-50 rule FAIL all 4 gates',
    },
    'project_ifvg_nq.md': {
      file: 'project_ifvg_nq.md', label: 'l', section: '', status: 'killed',
      emoji: '🛑', date: '2026-09-12', date_src: 'text', reason: 'IFVG NQ 5m: PF 0.94 net',
    },
    'project_noise_momentum.md': {
      file: 'project_noise_momentum.md', label: 'l', section: '', status: 'killed',
      emoji: '🛑', date: '2026-09-02', date_src: 'text', reason: 'noise momentum NQ: no edge net',
    },
    'project_james_method.md': {
      file: 'project_james_method.md', label: 'l', section: '', status: 'caution',
      emoji: '⚠️', date: '2026-09-20', date_src: 'text', reason: 'James method: thin sample',
    },
    'project_overnight_es.md': {
      file: 'project_overnight_es.md', label: 'l', section: '', status: 'killed',
      emoji: '🛑', date: '2026-08-30', date_src: 'text', reason: 'overnight hold ES: cost flips it',
    },
    'project_resume_tailor.md': {
      file: 'project_resume_tailor.md', label: 'l', section: '', status: 'open',
      emoji: '', date: '', date_src: '', reason: 'micro-SaaS complete',
    },
  },
  terms: {
    ORB: { aliases: ['orb', 'opening range'], files: ['project_orb_topstep.md'] },
    'Quarterly Theory': { aliases: ['quarterly theory', '=QT'], files: ['project_tabby_qt7h.md'] },
    resume: { aliases: ['resume'], files: ['project_resume_tailor.md'] },
    'London session': { aliases: ['london'], files: ['project_orb_topstep.md'], needs_context: true },
    carry: { aliases: ['carry'], files: ['project_tabby_qt7h.md'], needs_context: true, strict: true },
    sweep: {
      aliases: ['sweep', 'liquidity sweep', 'sweep & reclaim', 'sweep and reclaim'],
      files: ['project_sweep_reclaim.md'],
      needs_context: true,
      strict: true,
    },
    momentum: { aliases: ['momentum'], files: ['project_noise_momentum.md'], needs_context: true },
    James: { aliases: ['james'], files: ['project_james_method.md'], needs_context: true },
    overnight: { aliases: ['overnight'], files: ['project_overnight_es.md'], needs_context: true },
    'Lil Fish': { aliases: ['lil fish', 'lilfish'], files: ['project_lilfish_replication.md'] },
    IFVG: { aliases: ['ifvg', 'inverse fvg'], files: ['project_ifvg_nq.md'] },
  },
}

test('a named strategy finds its kill, whole words only', () => {
  expect(match('retest the ORB breakout on MNQ', IDX, new Set()).map(h => h.entry.file)).toEqual(['project_orb_topstep.md'])
  expect(match('the opening range idea again', IDX, new Set()).length).toBe(1)
  expect(match('absorb the cost', IDX, new Set())).toEqual([])
})

test('case-sensitive aliases: QT yes, Qt no', () => {
  expect(aliasRe('=QT').test('try QT on gold')).toBe(true)
  expect(aliasRe('=QT').test('a Qt widget')).toBe(false)
})

test('a generic term needs a trading word beside it', () => {
  const idx: Index = {
    ...IDX,
    terms: { carry: { aliases: ['carry'], files: ['project_orb_topstep.md'], needs_context: true } },
  }
  expect(match('carry on with the email draft', idx, new Set())).toEqual([])
  expect(match('carry on with them in a new session; stop here, long context, edge case', idx, new Set())).toEqual([])
  expect(match('test a futures carry strategy', idx, new Set()).length).toBe(1)
})

test('open (not killed) entries are not raised', () => {
  expect(match('update my resume', IDX, new Set())).toEqual([])
})

test('an entry already raised this session is not raised again', () => {
  expect(match('ORB', IDX, new Set(['project_orb_topstep.md']))).toEqual([])
})

function engine(on: On, seen: { context?: readonly string[]; toasts: string[] }) {
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.read', () => ({ value: JSON.stringify(IDX) }))
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    seen.context = e.context
    return { text: e.text, context: e.context }
  })
}

test('a prompt naming a killed strategy carries the verdict to Claude', async ($, on) => {
  const seen: { context?: readonly string[]; toasts: string[] } = { toasts: [] }
  engine(on, seen)
  await $.prompt.submit({ text: 'can we re-run the ORB test with a tighter stop?', wait: false, origin: { kind: 'composer' } })
  expect(seen.toasts.length).toBe(1)
  expect(seen.toasts[0]).toContain('ORB')
  expect(String(seen.context ?? '')).toContain('killed 2026-08-07')
  expect(String(seen.context ?? '')).toContain('project_orb_topstep.md')
})

test('a prompt naming nothing killed passes untouched', async ($, on) => {
  const seen: { context?: readonly string[]; toasts: string[] } = { toasts: [] }
  engine(on, seen)
  await $.prompt.submit({ text: 'fix the typo in my resume', wait: false, origin: { kind: 'composer' } })
  expect(seen.toasts).toEqual([])
  expect(seen.context).toBeUndefined()
})

const NOTE = [
  '<system-reminder>The session "Build mods" finished a turn. It reported: "Vault fixed: dropped the MGC London placeholder."</system-reminder>',
  '<side-sessions-event>None of the sessions is working now; carry on with any step left.</side-sessions-event>',
].join('\n')

test('a prompt that is only an injected side-session note produces nothing', async ($, on) => {
  const seen: { context?: readonly string[]; toasts: string[] } = { toasts: [] }
  engine(on, seen)
  await $.prompt.submit({ text: NOTE, wait: false, origin: { kind: 'composer' } })
  expect(seen.toasts).toEqual([])
  expect(seen.context).toBeUndefined()
})

test('the user line beside injected blocks still fires', async ($, on) => {
  const seen: { context?: readonly string[]; toasts: string[] } = { toasts: [] }
  engine(on, seen)
  await $.prompt.submit({ text: `${NOTE}\ntest London session ORB on MGC`, wait: false, origin: { kind: 'composer' } })
  expect(seen.toasts.length).toBe(1)
  expect(String(seen.context ?? '')).toContain('project_orb_topstep.md')
})

const files = (t: string) => match(t, IDX, new Set()).map(h => h.entry.file)

test('a generic one-word alias counts only inside a strategy name', () => {
  expect(files('run a 108-cell parameter sweep on the NQ strategy')).toEqual([])
  expect(files('carry on with the NQ backtest after lunch')).toEqual([])
  expect(files('re-test the liquidity sweep on MNQ')).toEqual(['project_sweep_reclaim.md'])
  expect(files('try a sweep & reclaim on MGC 5m')).toEqual(['project_sweep_reclaim.md'])
  expect(files('the NQ sweep setup again')).toEqual(['project_sweep_reclaim.md'])
  expect(files('test a futures carry strategy')).toEqual(['project_tabby_qt7h.md'])
  expect(files('a London carry on NQ').sort()).toEqual(['project_orb_topstep.md', 'project_tabby_qt7h.md'])
  expect(isNamed('ZN TOM long on futures', '=TOM')).toBe(true)
  expect(isNamed('ask Tom about the NQ report', '=TOM')).toBe(false)
})

test('pasted code and logs are cut before matching', () => {
  expect(dropData('see:\n```\nLil Fish replay 47 trades\n```\nwhy?')).toBe('see:\n \nwhy?')
  expect(dropData('2026-10-05 09:10:01 INFO lilfish start\nORB loaded\n2026-10-05 09:10:02 INFO done\nwhy did it stop?')).toBe(
    'why did it stop?',
  )
  expect(dropData('what does `sweep_v2(carry)` return?')).toBe('what does   return?')
  expect(dropData('    orb = load()\nok')).toBe('ok')
})

test('a strategy named only inside a paste raises nothing; the person\'s own line still does', async ($, on) => {
  const seen: { context?: readonly string[]; toasts: string[] } = { toasts: [] }
  engine(on, seen)
  const log = '2026-10-05 09:10:01 INFO farm/claude4b Lil Fish replay\n2026-10-05 09:10:02 INFO ORB filter loaded'
  await $.prompt.submit({ text: `${log}\nwhy did the job stop?`, wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'fix this:\n```py\nrun_orb(lil_fish=True)  # Lil Fish ORB\n```', wait: false, origin: { kind: 'composer' } })
  expect(seen.toasts).toEqual([])
  expect(seen.context).toBeUndefined()
  await $.prompt.submit({ text: `${log}\nretest Lil Fish on MNQ`, wait: false, origin: { kind: 'composer' } })
  expect(seen.toasts.length).toBe(1)
  expect(String(seen.context ?? '')).toContain('project_lilfish_replication.md')
})

// Prose the data-line rules once cut: each names a strategy and must still hit.
const PROSE: [string, string][] = [
  ['let me retest the ORB on NQ', 'project_orb_topstep.md'],
  ['import the Lil Fish trades into the farm', 'project_lilfish_replication.md'],
  ['raise the stop on the ORB to 20 ticks', 'project_orb_topstep.md'],
  ['type out why IFVG died', 'project_ifvg_nq.md'],
  ['[1] retest ORB', 'project_orb_topstep.md'],
  ['... and also the ORB', 'project_orb_topstep.md'],
  ['at 2026-10-27 09:30 the ORB fired twice', 'project_orb_topstep.md'],
  ['Then ORB {fast}', 'project_orb_topstep.md'],
]

test('prose that looks a little like code or logs still names its strategy', () => {
  for (const [said, file] of PROSE) {
    // alone, and as the second line of a prompt
    expect([said, files(ownWords(said))]).toEqual([said, [file]])
    expect([said, files(ownWords(`quick one:\n${said}`))]).toEqual([said, [file]])
  }
})

test('a one-line prompt is never cut as data', () => {
  expect(dropData('2026-10-05 09:10:01 INFO retest Lil Fish')).toBe('2026-10-05 09:10:01 INFO retest Lil Fish')
  expect(dropData('    retest the ORB')).toBe('retest the ORB')
})

test('real code and logs are still cut; two weak lines together are data', () => {
  expect(dropData('why?\nconst orb = load()\nimport numpy as np\ndef run_orb(x):')).toBe('why?')
  expect(dropData('why?\nraise ValueError("orb")\n12:01:02 ORB fired')).toBe('why?')
  expect(dropData('see\n{\n  "strategy": "ORB",\n}\nok')).toBe('see\nok')
  expect(dropData('see\n$ python orb.py\n... ORB loaded;\nok')).toBe('see\nok')
})

test('only strict generic words (sweep, carry) need a name; others need only a trading word', () => {
  expect(files('is momentum dead on NQ futures?')).toEqual(['project_noise_momentum.md'])
  expect(files("what did James's method score on NQ?")).toEqual(['project_james_method.md'])
  expect(files('does overnight still work on ES?')).toEqual(['project_overnight_es.md'])
  expect(files('is momentum dead?')).toEqual([])
  // strict: bare stays quiet even in a trading prompt
  expect(files('run a 108-cell parameter sweep on the NQ strategy')).toEqual([])
  expect(files('carry on with the NQ backtest after lunch')).toEqual([])
})

test('a strict word followed by on/for and a market, or a possessive and a noun, is a name', () => {
  expect(files('test carry on ZN')).toEqual(['project_tabby_qt7h.md'])
  expect(files('the sweep for MNQ again')).toEqual(['project_sweep_reclaim.md'])
  expect(files('the sweep on the NQ chart')).toEqual([])
  expect(isNamed("James's method", 'james')).toBe(true)
  expect(isNamed('the carry’s legs', 'carry')).toBe(true)
  expect(isNamed('carry on ZN', 'carry')).toBe(true)
  expect(isNamed('carry on with it', 'carry')).toBe(false)
})
