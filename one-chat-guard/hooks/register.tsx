import { atom, read, update, type Hook, type Register } from 'claude-code'

import type { Candidate } from '../types'
import { bandText, dropKept, isIgnoredTitle, mergeCands, mergeCfg, pairKey, parseMatches, shouldCheck, type Cfg } from './lib'

type Ctx = Parameters<Hook<'turn.complete'>>[0]

const candidatesA = atom({ plugin: 'one-chat-guard', key: 'candidates' } as const, [] as Candidate[])
const dismissedA = atom({ plugin: 'one-chat-guard', key: 'dismissed' } as const, false)
const stageA = atom({ plugin: 'one-chat-guard', key: 'stage' } as const, 0)

const textOf = (r: { content?: unknown }) => ((r.content ?? []) as { text?: string }[]).map(c => c.text ?? '').join('')

// Module variables start over on a reload; the stage atom (session state) does not.
const S = { cwd: '', firstPrompt: '', me: null as { id: string; title: string } | null, titleTries: 0 }

async function loadCfg($: Ctx): Promise<Cfg> {
  try {
    return mergeCfg(JSON.parse(String(await $.fs.read(`${$.plugin.root}/config.json`))))
  } catch {
    return mergeCfg({})
  }
}

async function self($: Ctx): Promise<{ id: string; title: string }> {
  try {
    const r = await $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: 'self' })
    const j = JSON.parse(textOf(r)) as { sessionId?: unknown; title?: unknown }
    S.me = { id: typeof j.sessionId === 'string' ? j.sessionId : '', title: typeof j.title === 'string' ? j.title : '' }
  } catch {
    S.me = { id: S.me?.id ?? '', title: '' }
  }
  return S.me
}

// Read-only lookup. The prompt goes in on stdin, so it is never written to disk or shown in `ps`.
async function find($: Ctx, cfg: Cfg, id: string, title: string): Promise<Candidate[]> {
  const argv = ['/usr/bin/python3', `${$.plugin.root}/tools/find_similar.py`, `--cwd=${S.cwd}`, '--prompt-file=-', `--min-jaccard=${cfg.minJaccard}`]
  if (id) argv.push(`--self-id=${id}`)
  if (title) argv.push(`--title=${title}`)
  for (const t of cfg.ignoreTitles) argv.push(`--ignore-title=${t}`)
  try {
    const r = await $.process.run(argv, { stdin: S.firstPrompt, timeoutMs: 8000 })
    return r.exitCode === 0 ? parseMatches(r.stdout) : []
  } catch {
    return []
  }
}

async function check($: Ctx, cfg: Cfg, title: string) {
  const who = await self($)
  const kept = await $.store.get('kept').catch(() => undefined)
  const found = dropKept(await find($, cfg, who.id, title), who.id, Array.isArray(kept) ? (kept as string[]) : [])
  if (found.length) await update($, candidatesA, old => mergeCands(old, found))
}

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    S.cwd = e.cwd
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // Never blocks or edits the prompt: whatever goes wrong here, it passes on unchanged.
    try {
      const cfg = await loadCfg($)
      const stage = await read($, stageA)
      if (shouldCheck({ phase: 'prompt', stage, cfg, text: e.text, hasCommand: !!e.command, isMeta: !!e.isMeta })) {
        await update($, stageA, () => 1)
        S.firstPrompt = e.text
        // Fire and forget: the lookup (MCP call + python) must never hold the prompt back.
        void check($, cfg, '').catch(() => {})
      }
    } catch {
      // nothing to show
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      const cfg = await loadCfg($)
      if (shouldCheck({ phase: 'turn', stage: await read($, stageA), cfg })) {
        const who = await self($)
        S.titleTries += 1
        const usable = !isIgnoredTitle(who.title, cfg)
        if (usable || S.titleTries >= 3) {
          await update($, stageA, () => 2)
          if (usable) await check($, cfg, who.title)
        }
      }
    } catch {
      // nothing to show
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const cands = await read($, candidatesA)
    const top = cands[0]
    if (e.props.hasSurvey || !top || (await read($, dismissedA))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)

    const keep = async () => {
      const kept = await $.store.get('kept').catch(() => undefined)
      const keys = cands.map(c => pairKey(S.me?.id ?? '', c.sessionId))
      await $.store.set('kept', [...new Set([...(Array.isArray(kept) ? (kept as string[]) : []), ...keys])].slice(-500))
      await update($, dismissedA, () => true)
    }
    const open = async () => {
      try {
        const r = await $.mcp.call('ccd_window', 'open_session_in', { session_id: top.sessionId, target: 'focus' })
        if ((r as { isError?: boolean }).isError) throw new Error(textOf(r))
        await update($, dismissedA, () => true)
      } catch {
        $.ui.toast(`one-chat-guard: open "${top.title}" from the sidebar (could not switch to it from here).`)
      }
    }

    return (
      <Box>
        <Text>{bandText(top, cands.length)} </Text>
        <Button key="open" label="Open it" onPress={open} />
        <Button key="keep" label="Keep this chat" onPress={keep} />
      </Box>
    )
  })
}
