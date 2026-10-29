import { expect, test } from 'claude-code/testing'

import type { ChatRow, Scan } from '../types'
import { AUTO_MAX_AGE_MS, GRACE_MS, delivered, due, limitLine, parseCommand, resumable, sentKey, stillIdle } from './limit'

const NOW = 1_800_000_000_000
const RESET = NOW - 60_000
const row = (o: Partial<ChatRow>): ChatRow => ({
  sessionId: 'c1', title: 'Cut off', status: 'stalled', kind: 'limit', question: null, question_source: null,
  last_activity_ms: NOW - 3_600_000, error: "You've hit your session limit", error_at_ms: NOW - 3_600_000,
  limit: { kind: 'session', reset_at_ms: RESET }, ...o,
})
const scan = (rows: ChatRow[], now = NOW): Scan => ({ now_ms: now, rows })

test('not due before the reset; resumable at the reset, due only after the grace period', () => {
  const r = row({})
  expect(resumable(scan([r], RESET - 1), {}).length).toBe(0)
  expect(due(scan([r], RESET - 1), {}).length).toBe(0)
  expect(resumable(scan([r], RESET), {}).length).toBe(1)
  expect(due(scan([r], RESET + GRACE_MS - 1), {}).length).toBe(0)
  expect(due(scan([r], RESET + GRACE_MS), {}).map(x => x.sessionId)).toEqual(['c1'])
})

test('never sent twice for the same error, but a new error is eligible again', () => {
  const r = row({})
  const sent = { [sentKey(r)]: NOW }
  expect(due(scan([r]), sent).length).toBe(0)
  expect(resumable(scan([r]), sent).length).toBe(0)
  const again = row({ error_at_ms: NOW - 1_000_000, last_activity_ms: NOW - 1_000_000 })
  expect(due(scan([again], RESET + GRACE_MS), sent).length).toBe(1)
})

test('skips chats that are not a limit stall, have no reset time, or are this chat', () => {
  const rows = [
    row({ sessionId: 'a', status: 'working' }),
    row({ sessionId: 'b', kind: 'error', limit: { kind: 'rate', reset_at_ms: null } }),
    row({ sessionId: 'c', limit: { kind: 'session', reset_at_ms: null } }),
    row({ sessionId: 'd', limit: null }),
    row({ sessionId: 'me' }),
    row({ sessionId: 'old-scanner', error_at_ms: undefined, limit: undefined }),
  ]
  expect(due(scan(rows), {}, 'me').length).toBe(0)
})

test('skips a chat with activity newer than the limit error', () => {
  const r = row({ last_activity_ms: NOW - 30 * 60_000 })
  const late = RESET + GRACE_MS
  expect(due(scan([r], late), {}).length).toBe(0)
  // inside the 10 s slack the scanner also allows
  expect(due(scan([row({ last_activity_ms: NOW - 3_600_000 + 9_000 })], late), {}).length).toBe(1)
})

test('stillIdle refuses a running, archived or changed chat and an unreadable answer', () => {
  const r = row({})
  expect(stillIdle(JSON.stringify({ isRunning: false }), r)).toBe(true)
  expect(stillIdle(JSON.stringify({ isRunning: true }), r)).toBe(false)
  expect(stillIdle(JSON.stringify({ isArchived: true }), r)).toBe(false)
  expect(stillIdle(JSON.stringify({ errorAt: NOW }), r)).toBe(false)
  expect(stillIdle('not json', r)).toBe(false)
})

test('limitLine says when it resets, that it can continue, or that it was sent', () => {
  const r = row({ limit: { kind: 'session', reset_at_ms: NOW + 3_600_000 } })
  expect(limitLine(r, NOW, {})).toMatch(/^resets /)
  expect(limitLine(row({}), NOW, {})).toMatch(/ready to continue$/)
  expect(limitLine(row({}), NOW, { [sentKey(row({}))]: NOW })).toBe('continue message sent')
  expect(limitLine(row({ limit: { kind: 'rate', reset_at_ms: null } }), NOW, {})).toBe('reset time not found')
  expect(limitLine(row({ kind: 'error' }), NOW, {})).toBeNull()
})

test('parseCommand reads auto and resume arguments', () => {
  expect(parseCommand('auto on')).toEqual({ kind: 'auto', on: true })
  expect(parseCommand(' AUTO off ')).toEqual({ kind: 'auto', on: false })
  expect(parseCommand('auto')).toEqual({ kind: 'auto-status' })
  expect(parseCommand('resume')).toEqual({ kind: 'resume', n: null })
  expect(parseCommand('resume 2')).toEqual({ kind: 'resume', n: 2 })
  expect(parseCommand('resume x')).toEqual({ kind: 'none' })
  expect(parseCommand('')).toEqual({ kind: 'none' })
})

test('delivered() accepts only the delivered and queued tags', () => {
  expect(delivered('Message sent. (delivery: delivered; message_id: m1)')).toBe(true)
  expect(delivered('Waiting. (delivery: queued; message_id: m2)')).toBe(true)
  expect(delivered('x (Delivery:  Queued; message_id: m2)')).toBe(true)
  expect(delivered('(delivery: rejected; message_id: -)')).toBe(false)
  expect(delivered('(delivery: delivered; message_id: a) then (delivery: failed; message_id: b)')).toBe(false)
  expect(delivered('Session is archived; not delivered')).toBe(false)
  expect(delivered('')).toBe(false)
})

test('auto mode skips a stall whose reset passed more than 6 h ago; resumable still lists it', () => {
  const r = row({})
  const fresh = RESET + AUTO_MAX_AGE_MS - 60_000
  const old = RESET + AUTO_MAX_AGE_MS + 60_000
  expect(due(scan([r], fresh), {}).map(x => x.sessionId)).toEqual(['c1'])
  expect(due(scan([r], old), {}).length).toBe(0)
  expect(resumable(scan([r], old), {}).length).toBe(1)
})
