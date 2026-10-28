import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { isResultFor, preregOf } from './lib'

test('pre-registration files are recognised with their lock markers', () => {
  expect(preregOf('/r/prereg/orb-x.json')?.markers).toEqual(['/r/prereg/orb-x.result.json'])
  expect(preregOf('/r/prereg/orb-x.json')?.listDir).toBe('/r/results')
  expect(preregOf('/r/PREREGISTRATION_v59.md')?.markers).toEqual(['/r/PREREG_v59_RESULT.sha256'])
  expect(preregOf('/r/PREREG_v59.sha256')?.slug).toBe('v59')
  expect(preregOf('/r/src/engine.py')).toBeNull()
  expect(preregOf('/r/PREREGISTRATION.md')).toBeNull()
})

test('a results entry must be the slug, not a longer slug', () => {
  expect(isResultFor('orb-x_metrics.csv', 'orb-x')).toBe(true)
  expect(isResultFor('orb-x', 'orb-x')).toBe(true)
  expect(isResultFor('orb-xyz.csv', 'orb-x')).toBe(false)
})

// The world: /r holds v59 (results recorded) and v60 (no results yet),
// and prereg/orb-x.json whose results/ folder has orb-x_metrics.csv.
const EXISTS = new Set(['/r/PREREG_v59_RESULT.sha256'])

function engine(on: On) {
  mock.env(on, { HOME: '/h' })
  on('session.start', () => ({ cwd: '/r' }))
  on('session.cwd', () => ({ value: '/r' }))
  on('command.register', () => ({ value: { command: 'prereg' } }))
  on('fs.exists', (_, e) => ({ value: EXISTS.has((e as { path: string }).path) }))
  on('fs.list', (_, e) => ({
    value: (e as { path: string }).path === '/r/results'
      ? [{ name: 'orb-x_metrics.csv', kind: 'file', size: 1, mtimeMs: 0, isLink: false }]
      : [],
  }))
  on('tool.call', () => ({ result: {} }))
}

const denied = (r: { deny?: string; text?: string }) => String(r.deny ?? r.text ?? '')

test('edits to a locked pre-registration are refused', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/r', surface: 'desktop', isInteractive: true })
  const a = await $.tool.call({ tool: 'Edit', file_path: '/r/PREREGISTRATION_v59.md', old_string: '1.3', new_string: '1.1' })
  expect(denied(a)).toContain('LOCKED')
  const b = await $.tool.call({ tool: 'Bash', command: "sed -i '' 's/1.3/1.1/' PREREGISTRATION_v59.md" })
  expect(denied(b)).toContain('LOCKED')
  const c = await $.tool.call({ tool: 'Write', file_path: '/r/prereg/orb-x.json', content: '{}' })
  expect(denied(c)).toContain('orb-x_metrics.csv')
})

test('unlocked pre-registrations, reads and ordinary files pass', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/r', surface: 'desktop', isInteractive: true })
  const calls = [
    await $.tool.call({ tool: 'Edit', file_path: '/r/PREREGISTRATION_v60.md', old_string: 'a', new_string: 'b' }),
    await $.tool.call({ tool: 'Bash', command: 'cat PREREGISTRATION_v59.md > /tmp/copy.md' }),
    await $.tool.call({ tool: 'Bash', command: 'shasum -a 256 PREREGISTRATION_v59.md' }),
    await $.tool.call({ tool: 'Write', file_path: '/r/prereg/orb-xyz.json', content: '{}' }),
    await $.tool.call({ tool: 'Edit', file_path: '/r/src/engine.py', old_string: 'a', new_string: 'b' }),
  ]
  for (const r of calls) expect(r.deny).toBeUndefined()
})
