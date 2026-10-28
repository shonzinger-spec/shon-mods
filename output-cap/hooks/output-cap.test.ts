import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { capLines } from './lib.ts'

const lines = (n: number, tag = 'line') => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n') + '\n'

// The test's tool.call hook stands for core: it answers every Bash call with `out`.
function bash(on: On, out: { stdout?: string; stderr?: string; isError?: boolean; isImage?: boolean }) {
  on('tool.call', () =>
    out.isError
      ? ({ isError: true, result: out.stdout, text: out.stdout } as never)
      : { result: { stdout: out.stdout ?? '', stderr: out.stderr ?? '', interrupted: false, ...(out.isImage ? { isImage: true } : {}) } },
  )
}

test('lib: over the cap keeps head and tail with a note; at the cap untouched', () => {
  const c = capLines(lines(400), 150)
  const kept = c.text.trimEnd().split('\n')
  expect(c.cut).toBe(250)
  expect(kept.length).toBe(151)
  expect(kept[0]).toBe('line 1')
  expect(kept[74]).toBe('line 75')
  expect(kept[75]).toContain('250 lines cut')
  expect(kept[76]).toBe('line 326')
  expect(kept[150]).toBe('line 400')
  expect(capLines(lines(150), 150)).toEqual({ text: lines(150), cut: 0 })
})

test('a 400-line Bash result reaches Claude as 150 lines and a note', async ($, on) => {
  bash(on, { stdout: lines(400) })
  const r = await $.tool.call({ tool: 'Bash', command: 'seq 400' })
  const out = String((r.result as { stdout: string }).stdout)
  expect(out).toContain('250 lines cut by output-cap')
  expect(out.trimEnd().split('\n').length).toBe(151)
  expect(out.startsWith('line 1\n')).toBe(true)
  expect(out.trimEnd().endsWith('line 400')).toBe(true)
})

test('long stderr is capped too; short stdout beside it is kept whole', async ($, on) => {
  bash(on, { stdout: 'ok\n', stderr: lines(300, 'warn') })
  const r = await $.tool.call({ tool: 'Bash', command: 'make' })
  const res = r.result as { stdout: string; stderr: string }
  expect(res.stdout).toBe('ok\n')
  // one shared budget: stdout's 1 line leaves 149 for stderr
  expect(res.stderr).toContain('151 lines cut')
})

test('a result at the cap passes untouched', async ($, on) => {
  bash(on, { stdout: lines(150) })
  expect((await $.tool.call({ tool: 'Bash', command: 'a' })).result).toEqual({ stdout: lines(150), stderr: '', interrupted: false })
})

test('an image result passes untouched', async ($, on) => {
  bash(on, { stdout: lines(400), isImage: true })
  expect(String(((await $.tool.call({ tool: 'Bash', command: 'b' })).result as { stdout: string }).stdout)).toBe(lines(400))
})

test('max_lines from userConfig sets the cap', { options: { max_lines: 10 } }, async ($, on) => {
  bash(on, { stdout: lines(40) })
  const out = String(((await $.tool.call({ tool: 'Bash', command: 'seq 40' })).result as { stdout: string }).stdout)
  expect(out).toContain('30 lines cut')
  expect(out.trimEnd().split('\n').length).toBe(11)
})

test('a short errored result passes untouched', async ($, on) => {
  bash(on, { stdout: lines(40), isError: true })
  const r = await $.tool.call({ tool: 'Bash', command: 'false' })
  expect(r.isError).toBe(true)
  expect(String(r.text)).toBe(lines(40))
})

test('a long errored result reaches Claude capped, still as an error', async ($, on) => {
  bash(on, { stdout: lines(400), isError: true })
  const r = await $.tool.call({ tool: 'Bash', command: 'make test' })
  expect(r.deny).toBeDefined()
  const text = String(r.deny)
  expect(text).toContain('250 lines cut by output-cap')
  expect(text.trimEnd().split('\n').length).toBe(151)
  expect(text.startsWith('line 1\n')).toBe(true)
  expect(text.trimEnd().endsWith('line 400')).toBe(true)
})

const kept = (s: string) => s.trimEnd().split('\n').filter(l => l !== '' && !l.includes('lines cut by output-cap'))

test('stdout and stderr share one 150-line budget', async ($, on) => {
  bash(on, { stdout: lines(200, 'out'), stderr: lines(200, 'err') })
  const res = (await $.tool.call({ tool: 'Bash', command: 'make' })).result as { stdout: string; stderr: string }
  expect(kept(res.stdout).length + kept(res.stderr).length).toBe(150)
  expect(kept(res.stdout).length).toBe(75)
  expect(res.stderr.trimEnd().endsWith('err 200')).toBe(true)
})

test('a short stream keeps its lines; the long one gets the rest of the budget', async ($, on) => {
  bash(on, { stdout: lines(300, 'out'), stderr: lines(20, 'err') })
  const res = (await $.tool.call({ tool: 'Bash', command: 'make' })).result as { stdout: string; stderr: string }
  expect(res.stderr).toBe(lines(20, 'err'))
  expect(kept(res.stdout).length).toBe(130)
})

test('the note says to pipe through grep, head or tail next time, not to re-run', () => {
  const note = capLines(lines(400), 150).text.split('\n')[75]
  expect(note).toContain('next time pipe the command through grep, head or tail')
  expect(note).not.toContain('re-run')
})
