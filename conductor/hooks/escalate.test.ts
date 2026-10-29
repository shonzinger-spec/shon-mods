import { expect, test } from 'claude-code/testing'

import { isCheckCommand, taskKey } from './escalate.ts'

test('task key strips trailing round/attempt/retry counters and case/space', () => {
  const k = taskKey('Fix  the failing test', 'gp')
  for (const d of ['fix the failing test (retry)', 'Fix the failing test round 2', 'Fix the failing test #2', 'Fix the failing test - attempt 3', 'fix the failing test (round 2) (retry)'])
    expect(taskKey(d, 'gp')).toBe(k)
  expect(taskKey('Fix the failing test', 'other')).not.toBe(k)
})

test('check commands: test/build runners match; others do not', () => {
  for (const c of ['pytest -q', 'cd a && python3 -m pytest', 'claude plugin test conductor', 'pnpm run test', 'bun test', 'cargo build', 'go test ./...', 'npx tsc --noEmit', 'make test', 'node --test', 'vitest run', 'jest'])
    expect(isCheckCommand(c)).toBe(true)
  for (const c of ['ls', 'git status', 'cat test_pytest.py', 'npm install'])
    expect(isCheckCommand(c)).toBe(false)
})
