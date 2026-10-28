import { expect, test } from 'claude-code/testing'

test('session.start registers the five commands', async ($, on) => {
  const names: string[] = []
  on('command.register', (_, e) => {
    names.push((e as { name: string }).name)
    return { value: { command: 'x' } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: 1_000 }))
  on('session.id', () => ({ value: 's1' }))
  on('mcp.call', () => ({ value: { content: [], isError: true } }))
  on('env.get', () => ({ value: '/home/t' }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(names.sort()).toEqual(['budget', 'done', 'next', 'section', 'task'])
})

test('/budget with empty state returns text', async ($, on) => {
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', () => ({ value: '' }))
  on('fs.exists', () => ({ value: false }))
  on('session.usage', () => ({ value: { rateLimits: [], startedAt: 0, context: { window: 0 } } }))
  const r = await $.command.run({ command: 'budget', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(JSON.stringify(r)).toContain('usage-coach')
})

test('a Skill call logs plugin and kind', async ($, on) => {
  const calls: { argv: string[]; init?: { stdin?: string } }[] = []
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.read', () => ({ value: '' }))
  on('fs.exists', () => ({ value: false }))
  on('tool.call', () => ({ result: {} }))
  on('clock.now', () => ({ value: 1_000 }))
  on('session.id', () => ({ value: 's1' }))
  on('process.run', (_, e) => {
    calls.push(e as never)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:brainstorming' })
  const row = JSON.parse(calls.find(c => c.init?.stdin?.includes('superpowers'))?.init?.stdin ?? '{}')
  expect(row.plugin).toBe('superpowers')
  expect(row.kind).toBe('skill')
})
