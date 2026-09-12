import { z } from 'zod'

const loopEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  executionMode: z.literal('loop'),
  iterations: z.array(z.strictObject({
    iteration: z.number().int().positive(),
    change: z.string().min(1),
    feedback: z.string().min(1),
    progress: z.string().min(1),
  })).min(1),
  elapsedMinutes: z.number().nonnegative(),
  stopReason: z.enum([
    'acceptance-passed',
    'blocked',
    'no-progress',
    'budget-exhausted',
  ]),
  acceptanceEvidence: z.array(z.string().min(1)),
})

function failure(code, message, details = {}) {
  return { ok: false, error: { code, message, ...details } }
}

export function validateLoopCompletion(evidence, policy) {
  const artifact = evidence?.artifact ?? evidence
  const parsed = loopEvidenceSchema.safeParse(artifact)
  if (!parsed.success) {
    return failure(
      'LOOP_EVIDENCE_INVALID',
      'Loop completion requires structured iteration and acceptance evidence',
      {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    )
  }

  const iterationNumbers = parsed.data.iterations.map((iteration) => iteration.iteration)
  const expectedNumbers = iterationNumbers.map((_, index) => index + 1)
  if (iterationNumbers.some((value, index) => value !== expectedNumbers[index])) {
    return failure('LOOP_ITERATION_SEQUENCE_INVALID', 'Loop iterations must be numbered from 1 without gaps')
  }
  if (parsed.data.iterations.length > policy.maxIterations) {
    return failure(
      'LOOP_ITERATION_BUDGET_EXCEEDED',
      `Loop used ${parsed.data.iterations.length} iterations; maximum is ${policy.maxIterations}`,
    )
  }
  if (parsed.data.elapsedMinutes > policy.timeBudgetMinutes) {
    return failure(
      'LOOP_TIME_BUDGET_EXCEEDED',
      `Loop used ${parsed.data.elapsedMinutes} minutes; maximum is ${policy.timeBudgetMinutes}`,
    )
  }
  if (parsed.data.stopReason !== 'acceptance-passed') {
    return failure(
      'LOOP_ACCEPTANCE_NOT_REACHED',
      `Loop stopped with ${parsed.data.stopReason}; it cannot be marked successful`,
    )
  }
  if (parsed.data.acceptanceEvidence.length === 0) {
    return failure('LOOP_ACCEPTANCE_EVIDENCE_REQUIRED', 'Loop success requires acceptance evidence')
  }

  return { ok: true, evidence: parsed.data }
}
