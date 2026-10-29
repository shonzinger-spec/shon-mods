import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Latest } from '../types'
import { SECTION_ID, bandText, commandText, isUnread, parseLatest, parseReadDate, sectionText } from './lib'

const unread = atom({ plugin: 'friction-review', key: 'unread' } as const, null)

// The shape of the `$` the hooks receive.
type Ctx = Parameters<Hook<'turn.complete'>>[0]

const dir = async ($: Ctx) => `${(await $.env.get('HOME')) ?? ''}/.claude/friction-review`

async function readText($: Ctx, path: string): Promise<string> {
  try {
    return String(await $.fs.read(path))
  } catch {
    return ''
  }
}

async function load($: Ctx): Promise<{ latest: Latest | null; readDate: string | null }> {
  const d = await dir($)
  const latest = parseLatest(await readText($, `${d}/latest.json`))
  const readDate = parseReadDate(await readText($, `${d}/read.json`))
  return { latest, readDate }
}

async function refresh($: Ctx): Promise<Latest | null> {
  const { latest, readDate } = await load($)
  await update($, unread, () => (latest && isUnread(latest, readDate) ? latest : null))
  return latest
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'friction', description: 'Show the latest weekly friction report (top patterns) and mark it read' })
    await refresh($)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'friction' }, async $ => {
    const latest = await refresh($)
    if (latest) {
      const d = await dir($)
      await $.fs.write(`${d}/read.json`, JSON.stringify({ date: latest.date }) + '\n')
      await update($, unread, () => null)
    }
    return { text: commandText(latest) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      if (e.props.hasSurvey) return next(e)
      const u = await read($, unread)
      if (!u) return next(e)
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box>
          <Text color="yellow">{bandText(u)}</Text>
        </Box>
      )
    } catch {
      return next(e)
    }
  })

  // Only while a report is unread: one standing instruction, so the cached prompt is untouched the rest of the week.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    // A headless run (claude -p, the SDK) has nobody to offer the report to; it would leak into job output.
    if (e.traits?.includes('print')) return r
    const u = await read($, unread).catch(() => null)
    if (!u) return r
    return { sections: [...r.sections, { id: SECTION_ID, text: sectionText(u), scope: 'session' as const }] }
  })
}
