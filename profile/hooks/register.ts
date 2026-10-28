import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'profile',
      description: '/profile <name|all|list|measure [name]|learn <section>|auto>: switch which plugins load next session',
    })
    // Give every new sidebar section a profile after its first chat; never block or fail the session.
    void $.process.run(['python3', `${$.plugin.root}/scripts/profile.py`, 'auto'], { timeoutMs: 30000 }).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'profile' }, async ($, e) => {
    const arg = e.args.trim()
    const [first = '', ...rest] = arg.split(/\s+/).filter(Boolean)
    const named = ['list', 'measure', 'learn', 'auto'].includes(first)
    const subcommand = !arg ? 'list' : named ? first : 'switch'
    const argv = ['python3', `${$.plugin.root}/scripts/profile.py`, subcommand]
    if (subcommand === 'switch') argv.push(arg)
    else if (rest.length) argv.push(...rest)
    const run = await $.process.run(argv, { timeoutMs: 30000 })
    return { text: run.exitCode === 0 ? run.stdout : run.stderr }
  })
}
