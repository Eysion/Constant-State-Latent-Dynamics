import path from 'node:path'
import { z } from 'zod'

const relativePath = z.string().min(1).refine((value) => {
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'))
  return !path.posix.isAbsolute(normalized) && normalized !== '.' && normalized !== '..' && !normalized.startsWith('../')
}, 'must be a repository-relative path')

const nonEmptyList = z.array(z.string().min(1)).min(1)
const base = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.string().min(1),
})

const intakeSchema = base.extend({
  kind: z.literal('intake'),
  request: z.string().min(1),
  ownedPaths: z.array(relativePath).min(1),
  acceptanceCriteria: nonEmptyList,
  assumptions: z.array(z.string().min(1)).default([]),
})

const contextReviewSchema = base.extend({
  kind: z.literal('context-review'),
  guidancePaths: z.array(relativePath).min(1),
  sourceReferences: z.array(z.strictObject({
    path: relativePath,
    line: z.number().int().positive(),
    purpose: z.string().min(1),
  })).min(1),
  verification: nonEmptyList,
})

const inlinePlanSchema = base.extend({
  kind: z.literal('inline-plan'),
  goal: z.string().min(1),
  ownedPaths: z.array(relativePath).min(1),
  steps: nonEmptyList,
  acceptance: nonEmptyList,
  verification: nonEmptyList,
  risks: z.array(z.string().min(1)).default([]),
})

const structuredPlanSchema = base.extend({
  kind: z.literal('structured-plan'),
  goal: z.string().min(1),
  ownedPaths: z.array(relativePath).min(1),
  constraints: z.array(z.string().min(1)).default([]),
  tasks: z.array(z.strictObject({
    id: z.string().min(1),
    description: z.string().min(1),
    acceptance: z.string().min(1),
  })).min(1),
  verification: nonEmptyList,
  risks: z.array(z.string().min(1)).default([]),
})

const openspecSchema = base.extend({
  kind: z.literal('openspec-contract'),
  proposalPath: relativePath,
  behavior: nonEmptyList,
  acceptance: nonEmptyList,
  compatibility: z.array(z.string().min(1)).default([]),
})

const implementationSchema = base.extend({
  kind: z.literal('implementation'),
  summary: z.string().min(1),
  changedPaths: z.array(relativePath).min(1),
  verificationScope: nonEmptyList,
  residualRisks: z.array(z.string().min(1)).default([]),
})

const qualityAssessmentSchema = base.extend({
  kind: z.literal('quality-assessment'),
  candidateCount: z.number().int().min(2).max(5),
  selectedCandidateId: z.string().min(1),
  accuracyScore: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  evidence: z.array(z.strictObject({
    kind: z.enum(['retrieval', 'source-review', 'verification', 'independent-review']),
    reference: z.string().min(1),
  })).min(1),
  decision: z.enum(['accepted', 'verify-or-clarify']),
})

const commitPlanSchema = base.extend({
  kind: z.literal('atomic-commit-plan'),
  commitPlan: z.object({ schemaVersion: z.literal(1) }).passthrough(),
})

function failure(code, message, issues = []) {
  return { ok: false, error: { code, message, issues } }
}

function exactPaths(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

function normalizePaths(paths) {
  return [...new Set(paths.map((value) => path.posix.normalize(value.replaceAll('\\', '/'))))].sort()
}

function includesAnyText(values, candidates) {
  const normalized = values.join(' ').toLowerCase()
  return candidates.some((candidate) => normalized.includes(candidate.toLowerCase()))
}

export function expectedImplementationPaths(context) {
  const generated = new Set([
    `openspec/changes/${context.taskId}/proposal.md`,
    ...context.changedFiles.filter((value) => /(?:^|\/)workflow-sediment\//.test(value) || /(?:^|\/)records\//.test(value)),
  ])
  return context.changedFiles.filter((value) => !generated.has(value))
}

export function validateNodeEvidence({ nodeId, evidence, context }) {
  const expectedPaths = normalizePaths(context.changedFiles)
  const parse = (schema) => {
    const result = schema.safeParse(evidence)
    return result.success
      ? { ok: true, evidence: result.data }
      : failure('EVIDENCE_SCHEMA_INVALID', `Invalid ${nodeId} evidence`, result.error.issues)
  }

  if (nodeId === 'intake') {
    const result = parse(intakeSchema)
    if (!result.ok) return result
    if (result.evidence.request !== context.request) {
      return failure('INTAKE_REQUEST_MISMATCH', 'Intake evidence must preserve the registered request')
    }
    if (!exactPaths(normalizePaths(result.evidence.ownedPaths), expectedPaths)) {
      return failure('INTAKE_OWNED_PATHS_MISMATCH', 'Intake evidence must declare exactly the Run owned paths')
    }
    return result
  }

  if (nodeId === 'context-review') {
    const result = parse(contextReviewSchema)
    if (!result.ok) return result
    if (!includesAnyText(result.evidence.verification, ['test', 'lint', 'build', 'check', 'verif'])) {
      return failure('CONTEXT_REVIEW_VERIFICATION_NOT_ACTIONABLE', 'Context review must record the configured verification command')
    }
    return result
  }

  if (nodeId === 'openspec-contract') {
    const result = parse(openspecSchema)
    if (!result.ok) return result
    const expected = `openspec/changes/${context.taskId}/proposal.md`
    return result.evidence.proposalPath === expected
      ? result
      : failure('OPENSPEC_PATH_MISMATCH', `OpenSpec proposalPath must be ${expected}`)
  }

  if (nodeId === 'planning') {
    const schema = context.planningMode === 'inline'
      ? inlinePlanSchema
      : context.planningMode === 'structured'
        ? structuredPlanSchema
        : structuredPlanSchema
    const result = parse(schema)
    if (!result.ok) return result
    if (!exactPaths(normalizePaths(result.evidence.ownedPaths), expectedPaths)) {
      return failure('PLAN_OWNED_PATHS_MISMATCH', 'Planning evidence must declare exactly the Run owned paths')
    }
    if (!includesAnyText(result.evidence.verification, ['test', 'lint', 'build', 'check', 'verif'])) {
      return failure('PLAN_VERIFICATION_NOT_ACTIONABLE', 'Planning evidence must include an actionable verification check')
    }
    if (context.planningMode === 'inline' && result.evidence.steps.length === 0) {
      return failure('PLAN_STEPS_REQUIRED', 'Inline planning evidence must contain implementation steps')
    }
    return result
  }

  if (nodeId === 'implementation') {
    const result = parse(implementationSchema)
    if (!result.ok) return result
    const allowed = new Set(normalizePaths(context.changedFiles))
    const changedPaths = normalizePaths(result.evidence.changedPaths)
    if (changedPaths.some((value) => !allowed.has(value))) {
      return failure('IMPLEMENTATION_PATH_OUT_OF_SCOPE', 'Implementation evidence contains a path outside the Run owned paths')
    }
    const expectedImplementation = normalizePaths(expectedImplementationPaths(context))
    if (!exactPaths(changedPaths, expectedImplementation)) {
      return failure('IMPLEMENTATION_PATHS_INCOMPLETE', 'Implementation evidence must declare exactly the non-generated owned paths')
    }
    if (!includesAnyText(result.evidence.verificationScope, ['test', 'lint', 'build', 'check', 'verif'])) {
      return failure('IMPLEMENTATION_VERIFICATION_NOT_ACTIONABLE', 'Implementation evidence must state an actionable verification scope')
    }
    return result
  }

  if (nodeId === 'quality-assessment') {
    const result = parse(qualityAssessmentSchema)
    if (!result.ok) return result
    const gate = context.qualityGate
    if (!gate?.enabled) return failure('QUALITY_GATE_NOT_ENABLED', 'Quality assessment is not part of this Run')
    if (result.evidence.candidateCount !== gate.candidateCount || result.evidence.threshold !== gate.accuracyThreshold) {
      return failure('QUALITY_GATE_POLICY_MISMATCH', 'Quality assessment must preserve the Run candidate count and threshold')
    }
    const accepted = result.evidence.accuracyScore >= gate.accuracyThreshold
    if ((result.evidence.decision === 'accepted') !== accepted) {
      return failure('QUALITY_GATE_DECISION_INVALID', 'Accepted requires a score at or above the threshold; lower scores must verify or clarify')
    }
    return result
  }

  if (nodeId === 'atomic-commit-plan') return parse(commitPlanSchema)
  return { ok: true, evidence }
}
