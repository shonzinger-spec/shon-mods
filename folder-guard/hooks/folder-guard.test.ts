import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { suggest, topItem } from './lib'

test('topItem: the item right under a banned folder, never under a dot-folder', () => {
  expect(topItem('/h/Desktop/x.py', '/h')?.item).toBe('/h/Desktop/x.py')
  expect(topItem('/h/newproj/src/a.py', '/h')?.item).toBe('/h/newproj')
  expect(topItem('/h/Trading/p/a.py', '/h')?.item).toBe('/h/Trading')
  expect(topItem('/h/.claude/mods-src/x/a.ts', '/h')).toBeNull()
  expect(topItem('/h/Documents/.hidden', '/h')).toBeNull()
  expect(topItem('/tmp/x', '/h')).toBeNull()
  expect(topItem('/H/DESKTOP/x.py', '/h')?.banned).toBe('/h/Desktop')
})

test('suggestions follow the words; none when nothing fits', () => {
  expect(suggest('/h/Desktop/orb_backtest.py', 'import pandas', '/h', '/h/Desktop')?.path).toBe('/h/Trading/_scratch/orb_backtest.py')
  expect(suggest('/h/newvid/upload.py', 'youtube thumbnail', '/h', '/h')?.dir).toBe('YouTube')
  expect(suggest('/h/Documents/resume_v2.md', '', '/h', '/h/Documents')?.dir).toBe('Career')
  expect(suggest('/h/Desktop/buck_converter_schematic.kicad_sch', '', '/h', '/h/Desktop')?.path).toBe('/h/Engineering/_scratch/buck_converter_schematic.kicad_sch')
  expect(suggest('/h/Desktop/hvac_leads.csv', '', '/h', '/h/Desktop')?.dir).toBe('AutoRank-Business')
  expect(suggest('/h/Desktop/notes.txt', 'groceries', '/h', '/h/Desktop')).toBeNull()
})

// The world: /h holds Trading/, nq_bot/, Desktop/old.txt; the shell sits in /h.
const EXISTS = new Set(['/h/Trading', '/h/nq_bot', '/h/Desktop/old.txt', '/h/Desktop', '/h/Documents'])

function engine(on: On) {
  mock.env(on, { HOME: '/h' })
  on('session.start', () => ({ cwd: '/h' }))
  on('session.cwd', () => ({ value: '/h' }))
  on('fs.exists', (_, e) => ({ value: EXISTS.has((e as { path: string }).path) }))
  on('tool.call', () => ({ result: {} }))
}

const isDenied = (r: { deny?: string }) => typeof r.deny === 'string'

test('new loose files and folders are refused, with a suggestion', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/h', surface: 'desktop', isInteractive: true })
  const a = await $.tool.call({ tool: 'Write', file_path: '/h/Desktop/orb_backtest.py', content: 'df = pd.read_parquet(p)' })
  expect(a.deny).toContain('~/Trading/_scratch/orb_backtest.py')
  const b = await $.tool.call({ tool: 'Write', file_path: '/h/newproj/main.py', content: 'print(1)' })
  expect(a.deny && b.deny).toBeTruthy()
  expect(b.deny).toContain('ask the user')
  expect(isDenied(await $.tool.call({ tool: 'Bash', command: 'mkdir ~/scratchwork' }))).toBe(true)
  expect(isDenied(await $.tool.call({ tool: 'Bash', command: 'cp report.pdf ~/Documents/' }))).toBe(true)
  expect(isDenied(await $.tool.call({ tool: 'Bash', command: 'echo hi > notes.txt' }))).toBe(true)
})

test('normal work passes: existing files, projects, dot-folders, quoted >, heredocs, tmp', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/h', surface: 'desktop', isInteractive: true })
  const calls = [
    await $.tool.call({ tool: 'Write', file_path: '/h/Desktop/old.txt', content: 'overwrite an existing file' }),
    await $.tool.call({ tool: 'Write', file_path: '/h/Trading/newproj/a.py', content: 'x' }),
    await $.tool.call({ tool: 'Write', file_path: '/h/nq_bot/new_file.py', content: 'x' }),
    await $.tool.call({ tool: 'Write', file_path: '/h/.claude/mods-src/m/hooks/hooks.json', content: '{}' }),
    await $.tool.call({ tool: 'Bash', command: "ls -l ~/Trading | grep -c -- '->'" }),
    await $.tool.call({ tool: 'Bash', command: "cat > /h/.claude/x.ts <<'EOF'\nconst f = ($, e) => next(e)\nEOF" }),
    await $.tool.call({ tool: 'Bash', command: 'cd /h/.claude/mods-src/m && echo {} > hooks/hooks.json' }),
    await $.tool.call({ tool: 'Bash', command: 'python3 run.py 2>/dev/null > /tmp/out.txt' }),
    await $.tool.call({ tool: 'Bash', command: 'rm -f ~/stale.txt' }),
    await $.tool.call({ tool: 'Edit', file_path: '/h/Desktop/new.py', old_string: 'a', new_string: 'b' }),
  ]
  for (const r of calls) expect(r.deny).toBeUndefined()
})

test('category hub folders may be created; other loose items stay refused', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/h', surface: 'desktop', isInteractive: true })
  expect(isDenied(await $.tool.call({ tool: 'Bash', command: 'mkdir ~/Engineering' }))).toBe(false)
  expect(isDenied(await $.tool.call({ tool: 'Bash', command: 'mkdir ~/Engineering2' }))).toBe(true)
  expect(isDenied(await $.tool.call({ tool: 'Bash', command: 'touch ~/notes.txt' }))).toBe(true)
})
