import { expect, test } from 'claude-code/testing'
import { stripInvented } from './strip'

const brief = (deliv: string, extra = '') =>
  `## Goal\nShip it\n## Deliverables\n${deliv}\n## Constraints\nNone\n${extra}`

test('drops a bullet naming a file the idea does not mention', () => {
  const r = stripInvented(brief('- the fix\n- report.md summary'), 'fix the login bug', '')
  expect(r.brief).not.toContain('report.md')
  expect(r.brief).toContain('- the fix')
  expect(r.removed).toBe(1)
})

test('keeps a bullet when the idea names the file', () => {
  const r = stripInvented(brief('- write Report.md'), 'please write report.md for me', '')
  expect(r.brief).toContain('Report.md')
  expect(r.removed).toBe(0)
})

test('keeps a bullet when the profile names the file', () => {
  const r = stripInvented(brief('- update context.md'), 'tidy things', 'notes live in context.md')
  expect(r.brief).toContain('context.md')
  expect(r.removed).toBe(0)
})

test('an emptied section gets the fallback bullet', () => {
  const r = stripInvented(brief('- docs/plan.md'), 'do the thing', '')
  expect(r.brief).toContain('- Exactly what the request asks for; no extra files.')
  expect(r.brief).not.toContain('plan.md')
  expect(r.removed).toBe(1)
})

test('removes the Stretch section whole', () => {
  const r = stripInvented(brief('- the fix', '## Stretch\n- add dashboard.html\n## Effort\nlow'), 'fix it', '')
  expect(r.brief).not.toContain('Stretch')
  expect(r.brief).not.toContain('dashboard.html')
  expect(r.brief).toContain('## Effort')
})

test('no Deliverables heading leaves the brief unchanged', () => {
  const b = '## Goal\nWrite report.md\n## Effort\nlow'
  const r = stripInvented(b, 'x', '')
  expect(r.brief).toBe(b)
  expect(r.removed).toBe(0)
})

test('a bullet with no file token is untouched', () => {
  const r = stripInvented(brief('- a working login flow'), 'fix login', '')
  expect(r.brief).toContain('- a working login flow')
  expect(r.removed).toBe(0)
})

test('counts every removed bullet', () => {
  const r = stripInvented(brief('- a.py\n- b.md\n- keep this\n- notes/c.json'), 'idea', '')
  expect(r.removed).toBe(3)
  expect(r.brief).toContain('- keep this')
})
