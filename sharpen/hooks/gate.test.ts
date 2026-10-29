import { expect, test } from 'claude-code/testing'
import { skipReason } from './gate'

const w = (n: number, word = 'thing') => Array.from({ length: n }, () => word).join(' ')
const CHAT20 = 'honestly that all sounds fine to me but maybe we should wait just a little longer before we go deciding on it'
const VERB20 = 'honestly that all sounds fine to me but maybe we should fix it just a little longer before we go deciding on it'

test('chat under 25 words with no action verb is chat', () => {
  expect(CHAT20.split(' ').length).toBeLessThan(25)
  expect(skipReason(CHAT20)).toBe('chat')
})

test('under 25 words with an action verb is not skipped', () => {
  expect(VERB20.split(' ').length).toBeLessThan(25)
  expect(skipReason(VERB20)).toBe(null)
})

test('25 or more words with no action verb is not skipped', () => {
  expect(skipReason(w(25))).toBe(null)
})

test('under 15 words is short', () => {
  expect(skipReason('please build the thing now')).toBe('short')
})

test('image attachment is attachment', () => {
  expect(skipReason(VERB20, [{ type: 'image' }])).toBe('attachment')
})

test('document attachment is attachment', () => {
  expect(skipReason(VERB20, [{ type: 'document' }])).toBe('attachment')
})

test('audio attachment does not skip', () => {
  expect(skipReason(VERB20, [{ type: 'audio' }])).toBe(null)
})

test('slash command and double dash are command', () => {
  expect(skipReason('/clear')).toBe('command')
  expect(skipReason('-- ' + VERB20)).toBe('command')
})
