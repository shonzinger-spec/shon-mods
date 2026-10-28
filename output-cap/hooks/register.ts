import type { Register } from 'claude-code'

import { capLines, lineCount, maxOf, share } from './lib.ts'

export const register: Register = (on, options) => {
  const max = maxOf(options)

  // Cap what Claude reads of a long Bash result. The command has already run;
  // only the text Claude reads is shortened, never an image or a background
  // task's handle. stdout and stderr share one budget of `max` lines.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    if (ran.isError) {
      // An errored result is read as its error text. A deny after the tool ran
      // reaches Claude as an error result too: the same error, capped.
      const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : undefined)
      if (text === undefined) return ran
      const c = capLines(text, max)
      return c.cut === 0 ? ran : { deny: c.text }
    }
    const r = ran.result
    if (!r || r.isImage || r.backgroundTaskId) return ran
    const stdout = r.stdout ?? ''
    const stderr = r.stderr ?? ''
    const [outMax, errMax] = share(lineCount(stdout), lineCount(stderr), max)
    const out = capLines(stdout, outMax)
    const err = capLines(stderr, errMax)
    if (out.cut === 0 && err.cut === 0) return ran
    return { result: { ...r, stdout: out.text, stderr: err.text } }
  }).catch(($, e, next) => next(e))
}
