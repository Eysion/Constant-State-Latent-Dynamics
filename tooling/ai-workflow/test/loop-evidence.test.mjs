import assert from 'node:assert/strict'
import test from 'node:test'
import { validateLoopCompletion } from '../src/loop-evidence.mjs'

const policy = { maxIterations: 3, noProgressLimit: 2, timeBudgetMinutes: 30 }

function evidence(overrides = {}) {
  return {
    schemaVersion: 1,
    executionMode: 'loop',
    iterations: [
      { iteration: 1, change: 'fixed one case', feedback: 'one failure remains', progress: '2 to 1 failures' },
      { iteration: 2, change: 'fixed final case', feedback: 'all pass', progress: '1 to 0 failures' },
    ],
    elapsedMinutes: 12,
    stopReason: 'acceptance-passed',
    acceptanceEvidence: ['pnpm test: passed'],
    ...overrides,
  }
}

test('accepts bounded loop completion with final evidence', () => {
  assert.equal(validateLoopCompletion(evidence(), policy).ok, true)
})

test('rejects budget exhaustion and false success', () => {
  const tooMany = evidence({
    iterations: [
      ...evidence().iterations,
      { iteration: 3, change: 'third', feedback: 'failed', progress: 'smaller' },
      { iteration: 4, change: 'fourth', feedback: 'failed', progress: 'smaller' },
    ],
  })
  const blocked = evidence({ stopReason: 'no-progress' })

  assert.equal(validateLoopCompletion(tooMany, policy).error.code, 'LOOP_ITERATION_BUDGET_EXCEEDED')
  assert.equal(validateLoopCompletion(blocked, policy).error.code, 'LOOP_ACCEPTANCE_NOT_REACHED')
})
