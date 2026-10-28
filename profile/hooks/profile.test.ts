import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

type Seen = { registered: string[]; argv: string[][] }

function engine(on: On, seen: Seen): void {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => {
    seen.registered.push((e as { name: string }).name)
    return { value: { command: 'profile' } }
  })
  on('process.run', (_, e) => {
    seen.argv.push([...((e as { argv: readonly string[] }).argv)])
    return { value: { exitCode: 0, stdout: 'listed\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

const command = (args = '') => ({ command: 'profile', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false } }) as never

test('registers the profile command at session start', async ($, on) => {
  const seen: Seen = { registered: [], argv: [] }
  engine(on, seen)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(seen.registered).toContain('profile')
})

test('/profile list invokes the list subcommand', async ($, on) => {
  const seen: Seen = { registered: [], argv: [] }
  engine(on, seen)
  const result = await $.command.run(command('list'))
  expect(seen.argv[0]?.slice(-1)).toEqual(['list'])
  expect((result as { text?: string }).text).toBe('listed\n')
})

test('session.start returns even when the auto run never resolves', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'profile' } }))
  on('process.run', () => new Promise<never>(() => {}))
  const r = await Promise.race([
    $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true }).then(() => 'done'),
    new Promise(res => setTimeout(() => res('hung'), 2000)),
  ])
  expect(r).toBe('done')
})
