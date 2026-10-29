import { expect, test } from 'claude-code/testing'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const LONG = 'can you make the bot better and also fix the pipeline thing so it runs every night without me touching it ok'

const sysSeen: string[] = []

function engine(on: any, seen: any[], asked: string[], reply = '## Goal\nShip it') {
  on('model.complete', (_: any, e: any) => {
    asked.push(String(e.prompt))
    sysSeen.push(String(e.system))
    return { value: { isAnswered: true, text: reply, usage } }
  })
  on('fs.read', () => ({ value: 'CTX-PROFILE' }))
  on('store.get', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('prompt.submit', (_: any, e: any) => {
    seen.push(e)
    return { text: e.text }
  })
}

test('long prompt gets a brief as context, text unchanged', async ($, on) => {
  const seen: any[] = [], asked: string[] = []
  engine(on, seen, asked)
  await $.prompt.submit({ text: LONG, origin: { kind: 'composer' } } as any)
  expect(seen[0].text).toBe(LONG)
  expect(seen[0].context?.[0]).toContain('## Goal')
  expect(asked[0]).toContain('CTX-PROFILE')
})

test('short prompt passes through with no model call', async ($, on) => {
  const seen: any[] = [], asked: string[] = []
  engine(on, seen, asked)
  await $.prompt.submit({ text: 'yes do it', origin: { kind: 'composer' } } as any)
  expect(asked.length).toBe(0)
  expect(seen[0].context).toBeUndefined()
})

test('++ forces a brief and strips the prefix', async ($, on) => {
  const seen: any[] = [], asked: string[] = []
  engine(on, seen, asked)
  await $.prompt.submit({ text: '++ fix login', origin: { kind: 'composer' } } as any)
  expect(seen[0].text).toBe('fix login')
  expect(seen[0].context?.[0]).toContain('[sharpen]')
})

test('-- skips even a long prompt', async ($, on) => {
  const seen: any[] = [], asked: string[] = []
  engine(on, seen, asked)
  await $.prompt.submit({ text: '-- ' + LONG, origin: { kind: 'composer' } } as any)
  expect(asked.length).toBe(0)
})

test('task notifications are never expanded', async ($, on) => {
  const seen: any[] = [], asked: string[] = []
  engine(on, seen, asked)
  await $.prompt.submit({ text: LONG, origin: { kind: 'task-notification' } } as any)
  expect(asked.length).toBe(0)
  expect(seen[0].context).toBeUndefined()
})

const CHAT20 = 'honestly that all sounds fine to me but maybe we should wait just a little longer okay'

test('chat-like prompt under 25 words with no action verb makes no model call', async ($, on) => {
  const seen: any[] = [], asked: string[] = []
  engine(on, seen, asked)
  await $.prompt.submit({ text: CHAT20, origin: { kind: 'composer' } } as any)
  expect(asked.length).toBe(0)
  expect(seen[0].context).toBeUndefined()
})

test('a prompt with an image attached is not expanded', async ($, on) => {
  const seen: any[] = [], asked: string[] = []
  engine(on, seen, asked)
  await $.prompt.submit({ text: LONG, origin: { kind: 'composer' }, attachments: [{ type: 'image' }] } as any)
  expect(asked.length).toBe(0)
  expect(seen[0].context).toBeUndefined()
})

test('++ still expands a prompt with an image attached', async ($, on) => {
  const seen: any[] = [], asked: string[] = []
  engine(on, seen, asked)
  await $.prompt.submit({ text: '++ ' + LONG, origin: { kind: 'composer' }, attachments: [{ type: 'image' }] } as any)
  expect(asked.length).toBe(1)
  expect(seen[0].context?.[0]).toContain('[sharpen]')
})

test('invented deliverable files are dropped from the attached brief', async ($, on) => {
  const seen: any[] = [], asked: string[] = []
  engine(on, seen, asked, '## Goal\nShip it\n## Deliverables\n- the fix\n- report.md\n## Constraints\nNone')
  await $.prompt.submit({ text: LONG, origin: { kind: 'composer' } } as any)
  expect(seen[0].context?.[0]).toContain('- the fix')
  expect(seen[0].context?.[0]).not.toContain('report.md')
})

test('system prompt forbids inventing deliverables', async ($, on) => {
  const seen: any[] = [], asked: string[] = []
  engine(on, seen, asked)
  await $.prompt.submit({ text: LONG, origin: { kind: 'composer' } } as any)
  expect(sysSeen[sysSeen.length - 1]).toContain('Never invent')
  expect(sysSeen[sysSeen.length - 1]).not.toContain('Stretch')
})
