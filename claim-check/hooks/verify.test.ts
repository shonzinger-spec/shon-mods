import { expect, test } from 'claude-code/testing'

import { claimsDone, gateVerdict, isCheckCommand, isGreen, type Entry } from './verify'

const green: Entry = { k: 'check', green: true }
const red: Entry = { k: 'check', green: false }
const edit: Entry = { k: 'edit' }

test('recognises pytest/claude plugin test/tsc chains', () => {
  expect(isCheckCommand('cd /x && python3 -m pytest -q 2>&1 | tail -5')).toBe(true)
  expect(isCheckCommand('claude plugin test claim-check')).toBe(true)
  expect(isCheckCommand('claude plugin validate claim-check')).toBe(true)
  expect(isCheckCommand('bash ts/tscheck.sh claim-check')).toBe(true)
  expect(isCheckCommand('npx tsc -p .')).toBe(true)
  expect(isCheckCommand('npm run test')).toBe(true)
  expect(isCheckCommand('python -m unittest discover')).toBe(true)
  expect(isCheckCommand('cargo test --release')).toBe(true)
  expect(isCheckCommand('go test ./...')).toBe(true)
  expect(isCheckCommand('make test')).toBe(true)
  expect(isCheckCommand('ruff check .')).toBe(true)
  expect(isCheckCommand('bash -n script.sh')).toBe(true)
  expect(isCheckCommand('node --test')).toBe(true)
  expect(isCheckCommand('PYTEST_ADDOPTS=-x pytest tests/')).toBe(true)
})

test('ignores ls and git status', () => {
  expect(isCheckCommand('ls -la')).toBe(false)
  expect(isCheckCommand('git status')).toBe(false)
  expect(isCheckCommand('')).toBe(false)
  expect(isCheckCommand('echo hello && cat README.md')).toBe(false)
})

test('extra patterns are case-insensitive regex sources and bad ones are ignored', () => {
  expect(isCheckCommand('./scripts/verify-all.sh', ['verify-all'])).toBe(true)
  expect(isCheckCommand('./scripts/verify-all.sh')).toBe(false)
  expect(isCheckCommand('ls', ['(unclosed'])).toBe(false)
})

test('isGreen false on isError', () => {
  expect(isGreen({ isError: true, text: '12 passed' })).toBe(false)
})

test('isGreen false on Exit code 1 text', () => {
  expect(isGreen({ text: 'Exit code 1\nsomething broke' })).toBe(false)
  expect(isGreen({ text: 'Exit code 127\ncommand not found' })).toBe(false)
})

test('isGreen false on FAIL line or N failed', () => {
  expect(isGreen({ text: 'ok a\nFAIL b\n' })).toBe(false)
  expect(isGreen({ text: '3 failed, 9 passed' })).toBe(false)
  expect(isGreen({ text: '1 failing' })).toBe(false)
})

test('isGreen true on 12 passed 0 failed', () => {
  expect(isGreen({ text: '12 passed 0 failed' })).toBe(true)
  expect(isGreen({ isError: false, text: 'Exit code 0\nall good' })).toBe(true)
  expect(isGreen({})).toBe(true)
})

test('claimsDone classifies explicit, generic and none', () => {
  expect(claimsDone('All tests pass.')).toBe('explicit')
  expect(claimsDone('The build is green and lint clean.')).toBe('explicit')
  expect(claimsDone('Typecheck passed')).toBe('explicit')
  expect(claimsDone('I verified the result')).toBe('explicit')
  expect(claimsDone('Done. The mod is ready.')).toBe('generic')
  expect(claimsDone('Fixed the bug and it works now')).toBe('generic')
  expect(claimsDone('Implemented the hook')).toBe('generic')
  expect(claimsDone('Here is how the hook works in general.')).toBe(null)
  expect(claimsDone('')).toBe(null)
})

test('negated claims stay quiet', () => {
  expect(claimsDone('I have not verified this yet')).toBe(null)
  expect(claimsDone('Not done yet, tests were not run')).toBe(null)
})

test('explicit claim with no check flags no-check', () => {
  expect(gateVerdict([], 'All tests pass')).toBe('no-check')
  expect(gateVerdict([edit], 'tests pass')).toBe('no-check')
})

test('explicit claim with red last check flags failed', () => {
  expect(gateVerdict([edit, red], 'All tests pass')).toBe('failed')
  expect(gateVerdict([green, edit, red], 'verified')).toBe('failed')
})

test('green then edit flags stale', () => {
  expect(gateVerdict([green, edit], 'tests pass')).toBe('stale')
})

test('edit then green is quiet', () => {
  expect(gateVerdict([edit, green], 'tests pass')).toBe(null)
  expect(gateVerdict([green, edit, green], 'Done')).toBe(null)
  expect(gateVerdict([red, edit, green], 'tests pass')).toBe(null)
})

test('explicit claim with a green check and no edit is quiet', () => {
  expect(gateVerdict([green], 'tests pass')).toBe(null)
})

test('generic done without edit stays quiet', () => {
  expect(gateVerdict([], 'Done.')).toBe(null)
  expect(gateVerdict([red], 'Fixed, it works now')).toBe(null)
})

test('generic done with edit and no check flags', () => {
  expect(gateVerdict([edit], 'Done.')).toBe('no-check')
  expect(gateVerdict([edit, red], 'Fixed')).toBe('failed')
  expect(gateVerdict([green, edit], 'Implemented')).toBe('stale')
})

test('no claim in the reply is always quiet', () => {
  expect(gateVerdict([edit], 'Here is the explanation.')).toBe(null)
  expect(gateVerdict([edit, red], '')).toBe(null)
})

test('isGreen false on bun/pytest/tsc/ruff summaries piped through tail', () => {
  expect(isGreen({ text: ' 42 pass\n 1 fail' })).toBe(false)
  expect(isGreen({ text: '(fail) my test' })).toBe(false)
  expect(isGreen({ text: '1 error in 0.2s' })).toBe(false)
  expect(isGreen({ text: 'Found 3 errors.' })).toBe(false)
  expect(isGreen({ text: 'a.ts(1,1): error TS2322' })).toBe(false)
  expect(isGreen({ text: ' 42 pass\n 0 fail' })).toBe(true)
})

test('explicit claim plus unrelated negation still flags no-check', () => {
  expect(claimsDone('All 43 tests pass; 2 unresolved TODOs remain.')).toBe('explicit')
  expect(gateVerdict([edit], 'All 43 tests pass; 2 unresolved TODOs remain.')).toBe('no-check')
})

test('generic Fixed plus not ready elsewhere still flags', () => {
  expect(claimsDone('Fixed it. Tests pass. The README isn\'t done yet.')).toBe('explicit')
  expect(gateVerdict([edit], 'Fixed. The cache is not ready until restart.')).toBe('no-check')
})
