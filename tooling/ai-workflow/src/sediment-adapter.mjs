import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function decisionFingerprint(context, details) {
  return createHash('sha256')
    .update(JSON.stringify({ context, details }))
    .digest('hex')
}

export function decideSediment(context, details = {}) {
  const required =
    context.sediment !== 'skip' ||
    context.signals.includes('PRODUCTION_BUG') ||
    context.signals.includes('SEDIMENT_REQUIRED')

  if (!required) {
    return {
      decision: 'skip',
      reason: 'The run explicitly selected the sediment skip policy',
      missingFields: [],
    }
  }

  const requiredFields = ['summary', 'verification']
  if (context.signals.includes('PRODUCTION_BUG')) {
    requiredFields.push('symptom', 'rootCause', 'fix', 'risk')
  }
  const missingFields = requiredFields.filter((field) => {
    const value = details[field]
    return Array.isArray(value) ? value.length === 0 || value.some((item) => !nonEmpty(item)) : !nonEmpty(value)
  })

  if (missingFields.length > 0) {
    return {
      decision: 'blocked',
      reason: `Missing required sediment fields: ${missingFields.join(', ')}`,
      missingFields,
    }
  }

  return { decision: 'required', reason: 'Task requires a local sediment record', missingFields: [] }
}

function renderSediment(plan, details, generatedAt, fingerprint) {
  const context = plan.context
  const lines = [
    `# ${context.taskId}`,
    '',
    `- Workflow run: ${plan.runId}`,
    `- Sediment policy: ${context.sediment}`,
    `- Signals: ${context.signals.join(', ') || 'none'}`,
    `- Generated at: ${generatedAt}`,
    `- Content fingerprint: ${fingerprint}`,
    '',
    '## Summary',
    '',
    details.summary.trim(),
    '',
    '## Verification',
    '',
    ...details.verification.map((item) => `- ${item.trim()}`),
  ]

  if (context.signals.includes('PRODUCTION_BUG')) {
    lines.push(
      '',
      '## Production Bug',
      '',
      `- Symptom: ${details.symptom.trim()}`,
      `- Root cause: ${details.rootCause.trim()}`,
      `- Fix: ${details.fix.trim()}`,
      `- Risk: ${details.risk.trim()}`,
    )
  }

  return `${lines.join('\n')}\n`
}

async function readExisting(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export function createSedimentAdapter({
  sedimentDirectory,
  writerLock,
  details = () => ({}),
  now = () => new Date().toISOString(),
}) {
  const root = path.resolve(sedimentDirectory)

  function recordPath(plan) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(plan.context.taskId)) {
      throw new Error('Task id contains unsupported characters')
    }
    return path.join(root, `${plan.context.taskId}.md`)
  }

  function evaluate(plan) {
    const sedimentDetails = details({ plan }) ?? {}
    const decision = decideSediment(plan.context, sedimentDetails)
    const fingerprint = decisionFingerprint(plan.context, sedimentDetails)
    return { sedimentDetails, decision, fingerprint }
  }

  async function execute({ plan }) {
    const evaluated = evaluate(plan)
    if (evaluated.decision.decision === 'skip') {
      return { status: 'succeeded', evidence: { kind: 'sediment', ...evaluated.decision } }
    }
    if (evaluated.decision.decision === 'blocked') {
      return { status: 'waiting', evidence: { kind: 'sediment', ...evaluated.decision } }
    }

    const result = await writerLock.withLock(`sediment:${plan.runId}`, async (capability) => {
      const held = writerLock.assertHeld(capability)
      if (!held.ok) return held
      const filePath = recordPath(plan)
      const existing = await readExisting(filePath)
      if (existing?.includes(`Content fingerprint: ${evaluated.fingerprint}`)) {
        return { ok: true, action: 'unchanged', filePath }
      }

      const content = renderSediment(
        plan,
        evaluated.sedimentDetails,
        now(),
        evaluated.fingerprint,
      )
      await mkdir(path.dirname(filePath), { recursive: true })
      const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
      await writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temporaryPath, filePath)
      return { ok: true, action: existing === null ? 'created' : 'updated', filePath }
    })

    if (!result.ok) {
      return { status: 'failed', error: result.error, evidence: { kind: 'sediment' } }
    }
    return {
      status: 'succeeded',
      evidence: { kind: 'sediment', ...evaluated.decision, ...result },
    }
  }

  async function reconcile({ plan }) {
    const evaluated = evaluate(plan)
    if (evaluated.decision.decision === 'skip') {
      return { status: 'succeeded', evidence: { kind: 'sediment', ...evaluated.decision } }
    }
    if (evaluated.decision.decision === 'blocked') {
      return { status: 'waiting', evidence: { kind: 'sediment', ...evaluated.decision } }
    }

    const existing = await readExisting(recordPath(plan))
    if (existing?.includes(`Content fingerprint: ${evaluated.fingerprint}`)) {
      return {
        status: 'succeeded',
        evidence: { kind: 'sediment-reconcile', decision: 'required', action: 'found' },
      }
    }
    return { status: 'unknown' }
  }

  return { idempotent: true, execute, reconcile }
}
