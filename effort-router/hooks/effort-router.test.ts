import { expect, test } from 'claude-code/testing'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ON = 'Ultracode is on: optimize for the most exhaustive, correct answer'
const u = (text: string) => ({ role: 'user', content: [{ type: 'text', text }] })
const a = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }] })
// Ultracode on from the session's first prompt (the app's default) vs switched on later by the user.
const SESSION_DEFAULT = [u(`hello\n<system-reminder>${ON}</system-reminder>`), a('hi')]
const USER_SWITCHED = [u('hello'), a('hi'), u(`next\n<system-reminder>${ON}</system-reminder>`), a('ok')]

type Opts = { haiku?: string; down?: boolean; config?: string; msgs?: any[]; cwd?: string; storeDown?: boolean }
const COMPOSE = { model: 'opus', promptModel: 'opus', surfaces: [], tools: [], outputStyle: null, traits: [] }

function engine(on: any, seen: any, o: Opts = {}) {
  const store: Record<string, unknown> = {}
  Object.assign(seen, { efforts: [], prompts: [], toasts: [], status: [], asked: 0, requests: [] })
  on('model.complete', (_: any, e: any) => {
    seen.asked++
    seen.requests.push(e)
    if (o.down) throw new Error('haiku down')
    return { value: { isAnswered: true, text: o.haiku ?? 'medium', usage } }
  })
  on('fs.read', (_: any, e: any) => ({ value: String(e.path).endsWith('config.json') ? (o.config ?? '') : '' }))
  on('env.get', () => ({ value: '/Users/t' }))
  on('session.cwd', () => ({ value: o.cwd ?? '/Users/t/elsewhere' }))
  on('session.messages', () => ({ value: o.msgs ?? [] }))
  on('store.get', (_: any, e: any) => {
    if (o.storeDown) throw new Error('store down')
    return { value: store[e.key] }
  })
  on('store.set', (_: any, e: any) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('ui.status', (_: any, e: any) => {
    seen.status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_: any, e: any) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('command.run', (_: any, e: any) => ({ text: `engine ${e.command}` }))
  on('prompt.compose', () => ({ sections: [] }))
  on('prompt.submit', (_: any, e: any) => {
    seen.prompts.push(e)
    return { text: e.text }
  })
  on('turn.step', async function* (_: any, e: any) {
    seen.efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' }
  })
}

let stepIndex = 0
async function step($: any, extra: any = {}) {
  const s = $.turn.step({ turnId: 't1', index: stepIndex++, model: 'opus', effort: 'max', messageCount: 1, ...extra })
  for await (const _ of s) {
    // drain
  }
}

async function say($: any, text: string, kind = 'composer') {
  await $.prompt.submit({ text, origin: { kind }, wait: false })
}

const notes = (seen: any) => (seen.prompts.at(-1)?.context ?? []).join('\n')

test('a session that starts at max (the desktop default) is routed', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'medium' })
  await say($, 'add a --dry-run flag to the export script that prints the rows')
  await step($, { effort: 'max' })
  expect(seen.efforts).toEqual(['medium'])
  expect(seen.status.at(-1)).toContain('effort: medium')
})

test('an effort changed mid-session is respected until it is set back', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'low' })
  await say($, 'make the header bold')
  await step($, { effort: 'max' })
  await say($, 'make the footer bold')
  await step($, { effort: 'xhigh' })
  await say($, 'make the nav bold')
  await step($, { effort: 'max' })
  expect(seen.efforts).toEqual(['low', 'xhigh', 'low'])
})

test('thanks runs at low without asking Haiku', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'high' })
  await say($, 'thanks!')
  await step($)
  expect(seen.efforts).toEqual(['low'])
  expect(seen.asked).toBe(0)
})

test('Haiku reads the request and the previous assistant message', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'high', msgs: [u('look at the strategy'), a('Want me to run the 40-variant backtest sweep?')] })
  await say($, 'is the sweep worth it')
  await step($)
  expect(seen.asked).toBe(1)
  expect(seen.requests[0].prompt).toContain('40-variant backtest sweep')
  expect(seen.requests[0].prompt).toContain('is the sweep worth it')
  expect(seen.efforts).toEqual(['high'])
})

test('Haiku xhigh on a short request without a stakes cue runs at high', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'xhigh' })
  await say($, 'tidy up the readme sections')
  await step($)
  expect(seen.efforts).toEqual(['high'])
})

test('Haiku xhigh stays xhigh with a stakes cue', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'xhigh' })
  await say($, 'check the sizing before it touches the live account')
  await step($)
  expect(seen.efforts).toEqual(['xhigh'])
})

test('a stakes word lifts a short request to xhigh whatever Haiku says', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'medium' })
  await say($, 'patch the credentials handling in the portal login')
  await step($)
  expect(seen.efforts).toEqual(['xhigh'])
  expect(seen.status.at(-1)).toContain('stakes')
})

test('Haiku xhigh stays xhigh on a long, detailed request', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'xhigh' })
  await say($, Array.from({ length: 70 }, (_, i) => `step${i}`).join(' '))
  await step($)
  expect(seen.efforts).toEqual(['xhigh'])
})

test('"continue" never drops below medium and keeps the last level', async ($, on) => {
  const seen: any = {}
  const o: Opts = { haiku: 'high' }
  engine(on, seen, o)
  await say($, 'investigate why the fills differ from the broker')
  await step($)
  o.haiku = 'low'
  await say($, 'lets continue please')
  await step($)
  expect(seen.efforts).toEqual(['high', 'high'])
})

test('Haiku down: the keyword rules decide', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { down: true })
  await say($, 'debug why the backtest shows a lookahead leak')
  await step($)
  expect(seen.efforts).toEqual(['high'])
})

test('max only by override, and the prefix is stripped', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'low' })
  await say($, '!max rename the variable')
  await step($, { effort: 'medium' })
  expect(seen.efforts).toEqual(['max'])
  expect(seen.prompts[0].text).toBe('rename the variable')
  expect(seen.asked).toBe(0)
})

test('!hard means high and beats a mid-session change', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'low' })
  await say($, 'fix the typo')
  await step($, { effort: 'max' })
  await say($, '!hard fix the other typo')
  await step($, { effort: 'low' })
  expect(seen.efforts).toEqual(['low', 'high'])
})

test('task notifications are ignored: the session effort stands', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'low' })
  await say($, 'make the header bold')
  await say($, 'debug the backtest leak', 'task-notification')
  await step($)
  expect(seen.efforts).toEqual(['max'])
  expect(seen.asked).toBe(1)
})

test('subagent requests are untouched', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'high' })
  await say($, 'debug why the backtest leaks')
  await step($, { agentId: 'a1', effort: 'low' })
  await step($)
  expect(seen.efforts).toEqual(['low', 'high'])
})

test('/effort-router off stops routing, on resumes it', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'low' })
  await $.command.run({ command: 'effort-router', args: 'off' } as any)
  await say($, 'make the header bold')
  await step($)
  await $.command.run({ command: 'effort-router', args: 'on' } as any)
  await say($, 'make the header bold')
  await step($)
  expect(seen.efforts).toEqual(['max', 'low'])
})

test('an ultracode job gets the opt-in note and a toast when ultracode is off', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'medium' })
  await say($, 'can we rerun all of the strats again and check if the results changed')
  await step($)
  expect(notes(seen)).toContain('effort-router: ultracode job')
  expect(seen.toasts.join('\n')).toContain('ultracode')
  expect(seen.efforts).toEqual(['high'])
  expect(seen.status.at(-1)).toContain('+ ultracode')
})

test('an ultracode job adds no note when the session already has ultracode on', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'high ultracode', msgs: USER_SWITCHED })
  await say($, 'port the whole pipeline to the new engine')
  expect(notes(seen)).toBe('')
})

test('session-default ultracode: a small request gets the work-solo note', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'low', msgs: SESSION_DEFAULT })
  await say($, 'make the header bold')
  expect(notes(seen)).toContain('effort-router: no orchestration needed')
})

test('ultracode the user switched on mid-session is left alone', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'low', msgs: USER_SWITCHED })
  await say($, 'make the header bold')
  expect(notes(seen)).toBe('')
})

test('!solo drops the job note and !ultra adds one', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'medium' })
  await say($, '!solo rerun all of the strats again')
  expect(notes(seen)).toBe('')
  expect(seen.prompts.at(-1).text).toBe('rerun all of the strats again')
  await say($, '!ultra tidy the docs folder')
  expect(notes(seen)).toContain('effort-router: ultracode job')
  expect(seen.prompts.at(-1).text).toBe('tidy the docs folder')
})

test('a bare "continue" keeps an ultracode job going; on its own it is not one', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'medium ultracode' })
  await say($, 'continue')
  expect(notes(seen)).toBe('')
  await say($, 'go through all of the variations possible')
  expect(notes(seen)).toContain('ultracode job')
  await say($, 'lets continue pelase')
  expect(notes(seen)).toContain('continuing the ultracode job')
})

test('with ultracode.auto off the router only suggests', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'medium', config: '{"ultracode":{"auto":false}}', msgs: SESSION_DEFAULT })
  await say($, 'rerun all of the strats again')
  expect(notes(seen)).toBe('')
  expect(seen.toasts.join('\n')).toContain('!ultra')
  const r = await $.prompt.compose(COMPOSE as any)
  expect(r.sections.length).toBe(0)
})

test('the standing rule rides in the system prompt when auto is on', async ($, on) => {
  const seen: any = {}
  engine(on, seen)
  const r = await $.prompt.compose(COMPOSE as any)
  expect(r.sections.map((s: any) => s.id)).toEqual(['effort-router:ultracode'])
  expect(r.sections[0].scope).toBe('session')
})

test('a failing hook never blocks the prompt', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { storeDown: true })
  await say($, 'make the header bold')
  expect(seen.prompts.at(-1).text).toBe('make the header bold')
})

test('"can we please continue here" is a follow-up: never below medium, keeps the last level', async ($, on) => {
  const seen: any = {}
  const o: Opts = { haiku: 'low' }
  engine(on, seen, o)
  await say($, 'can we please continue here')
  await step($)
  expect(seen.efforts).toEqual(['medium'])
  o.haiku = 'high'
  await say($, 'investigate why the fills differ from the broker')
  await step($)
  o.haiku = 'low'
  await say($, 'can we please continue here')
  await step($)
  expect(seen.efforts).toEqual(['medium', 'high', 'high'])
})

test('"can u pls continue" is a follow-up too', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'low' })
  await say($, 'can u pls continue')
  await step($)
  expect(['medium', 'high', 'xhigh']).toContain(seen.efforts[0])
})

test('a breadth phrase inside a long pasted prompt is not an ultracode job', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'high' })
  const filler = Array.from({ length: 210 }, (_, i) => `word${i}`).join(' ')
  await say($, `${filler} we should go through all of the strats at some point`)
  expect(notes(seen)).toBe('')
})

test('a short breadth request is still an ultracode job at high or above', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'medium' })
  await say($, 'can u go through all of the strats again')
  await step($)
  expect(notes(seen)).toContain('ultracode job')
  expect(['high', 'xhigh']).toContain(seen.efforts[0])
})

test('a hand-off to a new session runs at its own level, without the follow-up floor or the last ultracode job', async ($, on) => {
  const seen: any = {}
  const o: Opts = { haiku: 'high ultracode' }
  engine(on, seen, o)
  await say($, 'go through all of the variations possible')
  await step($)
  o.haiku = 'low'
  await say($, 'lets continue this in a new session')
  await step($)
  expect(seen.efforts).toEqual(['high', 'low'])
  expect(notes(seen)).toBe('')
  expect(seen.status.at(-1)).toContain('hand-off')
})

test('"add all of them to a new session" is a hand-off, not an ultracode job', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'low' })
  await say($, 'yes, add all of them to a new session')
  await step($)
  expect(seen.efforts).toEqual(['low'])
  expect(notes(seen)).toBe('')
})

test('Haiku down: a hand-off to a new session is low', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { down: true })
  await say($, 'ok, lets do it in a different session. give me the prompt for that')
  await step($)
  expect(seen.efforts).toEqual(['low'])
})

test('a longer request that only mentions a new session keeps the usual rules', async ($, on) => {
  const seen: any = {}
  engine(on, seen, { haiku: 'medium' })
  await say($, 'go through all of the strats again and then write a short summary I can paste into a new session')
  await step($)
  expect(notes(seen)).toContain('ultracode job')
  expect(['high', 'xhigh']).toContain(seen.efforts[0])
})
