import { expect, test } from 'claude-code/testing'

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const LONG = 'can you make the bot better and also fix the pipeline thing so it runs every night without me touching it ok'

function engine(on: any, seen: any[], asked: string[]) {
  on('model.complete', (_: any, e: any) => {
    asked.push(String(e.prompt))
    return { value: { isAnswered: true, text: '## Goal\nShip it', usage } }
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
