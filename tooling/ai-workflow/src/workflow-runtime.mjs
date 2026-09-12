import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createCommandAdapter } from './command-adapter.mjs'
import { createCommitExecutor } from './commit-executor.mjs'
import { deriveEventGates } from './event-gates.mjs'
import { validateNodeEvidence } from './context-evidence.mjs'
import { createGitAdapter, normalizeRepositoryPaths } from './git-adapter.mjs'
import { createJsonEventStore } from './json-event-store.mjs'
import { createFileLeaseManager } from './lease-manager.mjs'
import { validateLoopCompletion } from './loop-evidence.mjs'
import { compileExecutionPlan } from './planner.mjs'
import { resolveWorkflowModes } from './planning-policy.mjs'
import { createRepositoryWriterLock } from './repository-writer-lock.mjs'
import { captureRunContext } from './run-context.mjs'
import { createRunner } from './runner.mjs'
import { createSedimentAdapter } from './sediment-adapter.mjs'
import { createShadowMode } from './shadow-mode.mjs'
import { loadWorkflowDefinition } from './workflow-definition.mjs'
import { searchContextIndex } from './context-index.mjs'
import { resolveQualityGate } from './quality-policy.mjs'
import { resolveEvidenceRoute, summarizeToolBudget } from './evidence-routing-policy.mjs'
import { assessUnattendedStart, detectUnattendedRequest, inferUnattendedRiskSignals, UNATTENDED_SIGNAL } from './unattended-policy.mjs'
import { evaluatePromptIntake } from './prompt-intake.mjs'

function runtimeError(code, message, details = {}) {
  return { ok: false, error: { code, message, ...details } }
}

function sedimentPathFor(config, taskId) {
  return path.relative(config.repositoryDirectory, path.join(config.sedimentDirectory, `${taskId}.md`))
    .split(path.sep)
    .join('/')
}

async function fingerprintPaths(repositoryDirectory, paths) {
  return Promise.all(paths.map(async (relativePath) => {
    const filePath = path.join(repositoryDirectory, relativePath)
    try {
      const metadata = await lstat(filePath)
      if (!metadata.isFile()) return { path: relativePath, kind: 'non-file' }
      return { path: relativePath, kind: 'file', digest: createHash('sha256').update(await readFile(filePath)).digest('hex') }
    } catch (error) {
      if (error.code === 'ENOENT') return { path: relativePath, kind: 'missing' }
      throw error
    }
  })).then((items) => items.sort((left, right) => left.path.localeCompare(right.path)))
}

async function rejectOwnedSymlinks(repositoryDirectory, paths) {
  for (const relativePath of paths) {
    try {
      if ((await lstat(path.join(repositoryDirectory, relativePath))).isSymbolicLink()) {
        return runtimeError(
          'OWNED_PATH_SYMLINK_UNSUPPORTED',
          `Owned path must not be a symbolic link: ${relativePath}`,
        )
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return { ok: true }
}

async function writeTextAtomically(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  await rename(temporaryPath, filePath)
}

export async function createWorkflowRuntime({ config }) {
  const workflowResult = loadWorkflowDefinition(
    await readFile(config.workflowDefinition, 'utf8'),
    config.workflowDefinition,
  )
  if (!workflowResult.ok) return { ok: false, errors: workflowResult.errors }

  const store = createJsonEventStore({ rootDirectory: config.stateDirectory })
  const leaseManager = createFileLeaseManager({
    rootDirectory: path.join(config.stateDirectory, 'leases'),
  })
  const writerLock = createRepositoryWriterLock({ leaseManager })
  const git = createGitAdapter({ repositoryDirectory: config.repositoryDirectory, writerLock })
  const hasRegisteredVerification = Object.hasOwn(config.governance?.commands ?? {}, 'test')
  const configuredVerification = hasRegisteredVerification
    ? config.governance.commands.test
    : config.verification
  const verificationAdapter = configuredVerification === null
    ? null
    : createCommandAdapter({
      file: configuredVerification.file,
      args: configuredVerification.args,
      cwd: config.repositoryDirectory,
      idempotent: true,
      timeoutMs: configuredVerification.timeoutMs,
    })
  const runner = createRunner({
    store,
    leaseManager,
    adapters: {
      verification: {
        idempotent: true,
        async execute(input) {
          if (verificationAdapter === null) {
            return {
              status: 'succeeded',
              evidence: {
                kind: 'verification',
                decision: 'skipped',
                reason: 'governance.commands.test is explicitly null',
              },
            }
          }
          const before = await captureRunContext({
            git,
            repositoryDirectory: config.repositoryDirectory,
            governance: config.governance,
          })
          if (!before.ok) return { status: 'failed', error: before.error }
          const outcome = await verificationAdapter.execute(input)
          const after = await captureRunContext({
            git,
            repositoryDirectory: config.repositoryDirectory,
            governance: config.governance,
          })
          if (!after.ok) return { status: 'failed', error: after.error, evidence: outcome.evidence }
          const ownedPathFingerprints = await fingerprintPaths(
            config.repositoryDirectory,
            input.plan.context.changedFiles.filter((item) => item !== sedimentPathFor(config, input.plan.context.taskId)),
          )
          return {
            ...outcome,
            evidence: {
              ...outcome.evidence,
              freshness: {
                planHash: input.plan.planHash,
                before: before.context,
                after: after.context,
                ownedPathFingerprints,
              },
            },
          }
        },
      },
    },
  })
  const activeRunPath = path.join(config.stateDirectory, 'active-run')

  async function activeRun() {
    try {
      return (await readFile(activeRunPath, 'utf8')).trim() || null
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  async function resolveRunId(runId) {
    return runId || (await activeRun())
  }

  async function withRunLease(runId, operation) {
    const acquired = await leaseManager.acquire(`run-${runId}`, {
      ttlMs: 30_000,
      metadata: { operation: 'external-node' },
    })
    if (!acquired.ok) return acquired
    try {
      return await operation()
    } finally {
      await leaseManager.release(acquired.lease)
    }
  }

  async function start(context) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(context.taskId)) {
      return runtimeError('INVALID_RUN_ID', 'Task id contains unsupported characters')
    }
    if (!Array.isArray(context.changedFiles) || context.changedFiles.length === 0) {
      return runtimeError(
        'OWNED_PATHS_REQUIRED',
        'Start requires at least one exact repository-relative --changed-file path',
      )
    }
    const intake = evaluatePromptIntake({ request: context.request, changedFiles: context.changedFiles })
    if (intake.decision === 'HARD_BLOCK' || intake.decision === 'WAIT_CONFIRMATION') {
      return runtimeError(`PROMPT_INTAKE_${intake.decision}`, 'Prompt Intake did not authorize implementation', { reasons: intake.reasons })
    }
    const ownedPaths = normalizeRepositoryPaths(context.changedFiles)
    if (!ownedPaths.ok) return ownedPaths
    const symlinkValidation = await rejectOwnedSymlinks(config.repositoryDirectory, ownedPaths.paths)
    if (!symlinkValidation.ok) return symlinkValidation
    const unattendedRequest = detectUnattendedRequest(context.request)
    const requestedSignals = [...new Set([
      ...(context.signals ?? []),
      ...inferUnattendedRiskSignals(context.request),
      ...(unattendedRequest.enabled ? [UNATTENDED_SIGNAL, 'LOOP_REQUESTED'] : []),
    ])]
    if (unattendedRequest.enabled || requestedSignals.includes(UNATTENDED_SIGNAL)) {
      const scopeIssues = []
      for (const ownedPath of ownedPaths.paths) {
        try {
          const metadata = await lstat(path.join(config.repositoryDirectory, ownedPath))
          if (!metadata.isFile()) scopeIssues.push(`unattended scope is not a file: ${ownedPath}`)
        } catch (error) {
          if (error.code === 'ENOENT' && !requestedSignals.includes('NEW_FILE_SCOPE')) scopeIssues.push(`new unattended path requires NEW_FILE_SCOPE: ${ownedPath}`)
          else if (error.code !== 'ENOENT') throw error
        }
      }
      const assessment = assessUnattendedStart({
        request: context.request,
        changedFiles: ownedPaths.paths,
        signals: requestedSignals,
        automatedVerificationAvailable: verificationAdapter !== null,
        scopeIssues,
      })
      if (assessment.status !== 'eligible') {
        return runtimeError('UNATTENDED_ELIGIBILITY_REQUIRED', '无人值守尚未开启：请先补齐并确认资格条件', { blockers: assessment.blockers })
      }
    }
    const runContext = await captureRunContext({
      git,
      repositoryDirectory: config.repositoryDirectory,
      governance: config.governance,
    })
    if (!runContext.ok) return runContext
    const sedimentRequired =
      context.sediment !== 'skip' ||
      requestedSignals.includes('PRODUCTION_BUG') ||
      requestedSignals.includes('SEDIMENT_REQUIRED')
    const sedimentPath = sedimentPathFor(config, context.taskId)
    const modes = resolveWorkflowModes({
      planningPolicy: config.planningPolicy,
      executionPolicy: config.executionPolicy,
      signals: requestedSignals,
      requestedPlanningMode: context.planningMode,
      requestedExecutionMode: context.executionMode,
      automatedFeedbackAvailable: verificationAdapter !== null,
    })
    if (!modes.ok) return modes
    if (requestedSignals.includes(UNATTENDED_SIGNAL) && modes.executionMode !== 'loop') {
      return runtimeError('UNATTENDED_LOOP_REQUIRED', '无人值守必须使用可验证的受限 Loop，不能降级为 single-pass')
    }
    const eventGates = deriveEventGates({ signals: requestedSignals, changedFiles: ownedPaths.paths })
    const qualityGate = resolveQualityGate({ policy: config.qualityPolicy, signals: eventGates.signals })
    const evidenceRoute = resolveEvidenceRoute({ policy: config.evidenceRoutingPolicy, qualityGate })
    const modeSignals = [
      ...(modes.planningMode === 'openspec' ? ['PLANNING_OPENSPEC'] : []),
      ...(modes.executionMode === 'loop' ? ['EXECUTION_LOOP'] : []),
    ]
    const proposalPath = `openspec/changes/${context.taskId}/proposal.md`
    const proposalPaths = modes.planningMode === 'openspec' && !(await git.isIgnored(proposalPath))
      ? [proposalPath]
      : []
    const compiled = compileExecutionPlan(workflowResult.definition, {
      ...context,
      changedFiles: ownedPaths.paths,
      runContext: runContext.context,
      planningMode: modes.planningMode,
      executionMode: modes.executionMode,
      loop: modes.loop,
      modeReasons: modes.reasons,
      signals: [...eventGates.signals, ...modeSignals, ...(qualityGate.enabled ? ['QUALITY_GATE'] : [])],
      eventGates: eventGates.evidence,
      qualityGate,
      evidenceRoute,
      changedFiles: [
        ...ownedPaths.paths,
        ...proposalPaths,
        ...(sedimentRequired ? [sedimentPath] : []),
      ],
    })
    if (!compiled.ok) return compiled
    const created = await store.createRun(compiled.plan)
    if (!created.ok) return created
    await writeTextAtomically(activeRunPath, `${compiled.plan.runId}\n`)
    return created
  }

  async function status(runId) {
    const resolved = await resolveRunId(runId)
    if (!resolved) return runtimeError('NO_ACTIVE_RUN', 'No active workflow run')
    return store.getRun(resolved)
  }

  async function resume(runId) {
    const resolved = await resolveRunId(runId)
    if (!resolved) return runtimeError('NO_ACTIVE_RUN', 'No active workflow run')
    return runner.runUntilBlocked(resolved)
  }

  async function recordContext(runId, { query, selections, reviewed = false } = {}) {
    const resolved = await resolveRunId(runId)
    if (!resolved) return runtimeError('NO_ACTIVE_RUN', 'No active workflow run')
    if (reviewed !== true) {
      return runtimeError('CONTEXT_REVIEW_REQUIRED', 'Record context only after verifying the selected locations with rg and source reading')
    }
    if (!Array.isArray(selections) || selections.length === 0) {
      return runtimeError('CONTEXT_SELECTIONS_REQUIRED', 'Record context requires at least one selected path and line')
    }
    const retrieval = await searchContextIndex({
      repositoryDirectory: config.repositoryDirectory,
      stateDirectory: config.stateDirectory,
      query,
      limit: 50,
    })
    if (!retrieval.ok) return retrieval
    const requested = new Map()
    for (const selection of selections) {
      if (!selection || typeof selection.path !== 'string' || !Number.isInteger(selection.line) || selection.line < 1) {
        return runtimeError('CONTEXT_SELECTION_INVALID', 'Every selection requires a repository-relative path and positive integer line')
      }
      requested.set(`${selection.path}:${selection.line}`, { path: selection.path, line: selection.line })
    }
    const matches = new Map(retrieval.results.map((result) => [`${result.path}:${result.line}`, result]))
    const missing = [...requested.keys()].filter((key) => !matches.has(key))
    if (missing.length > 0) {
      return runtimeError('CONTEXT_SELECTION_NOT_RETRIEVED', 'Selected locations must be present in the current lexical retrieval', { missing })
    }
    const references = [...requested.values()].map((selection) => {
      const result = matches.get(`${selection.path}:${selection.line}`)
      return { path: result.path, line: result.line, stale: result.stale }
    }).sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line)
    return withRunLease(resolved, () => store.appendRunEvent(resolved, {
      type: 'CONTEXT_RECORDED',
      idempotencyKey: `${resolved}/context/${createHash('sha256').update(JSON.stringify({ query: retrieval.query, indexedAt: retrieval.indexedAt, references })).digest('hex')}`,
      evidence: {
        kind: 'lexical-context-references',
        query: retrieval.query,
        indexFile: path.relative(config.repositoryDirectory, retrieval.indexFile).split(path.sep).join('/'),
        indexedAt: retrieval.indexedAt,
        reviewed: true,
        references,
      },
    }))
  }

  async function recordToolCall(runId, details = {}) {
    const resolved = await resolveRunId(runId)
    if (!resolved) return runtimeError('NO_ACTIVE_RUN', 'No active workflow run')
    if (!/^[a-f0-9]{64}$/i.test(details.inputDigest ?? '') || !/^[a-f0-9]{64}$/i.test(details.resultDigest ?? '')) {
      return runtimeError('TOOL_DIGEST_INVALID', 'Tool calls require SHA-256 inputDigest and resultDigest values')
    }
    return withRunLease(resolved, async () => {
      const current = await status(resolved)
      if (!current.ok) return current
      const route = current.record.plan.context.evidenceRoute
      const capability = route.capabilities.find((item) => item.id === details.capabilityId)
      if (!capability || !capability.enabled) return runtimeError('TOOL_CAPABILITY_NOT_ALLOWED', 'Tool capability is not registered and enabled in this immutable Run')
      if (capability.access !== 'read') return runtimeError('TOOL_WRITE_REQUIRES_AUTHORIZATION', 'Evidence routing records only read-only tool calls')
      const previous = current.record.events.find((event) => event.type === 'TOOL_CALL_FINISHED' && event.evidence?.capabilityId === capability.id && event.evidence?.inputDigest === details.inputDigest && event.evidence?.outcome === 'succeeded')
      if (route.cache && previous) return { ok: true, cached: true, record: current.record, projection: current.projection, invocation: previous.evidence }
      const budget = summarizeToolBudget(current.record, route)
      if (capability.kind === 'mcp' && budget.mcpCalls >= route.budget.maxMcpCalls) return runtimeError('MCP_CALL_BUDGET_EXCEEDED', 'Run has exhausted its MCP call budget', budget)
      const costUnits = details.costUnits ?? capability.costUnits
      if (!Number.isInteger(costUnits) || costUnits < 0 || costUnits > capability.costUnits) return runtimeError('TOOL_COST_INVALID', 'Tool costUnits must not exceed the registered capability cost')
      if (budget.costUnits + costUnits > route.budget.maxCostUnits) return runtimeError('TOOL_COST_BUDGET_EXCEEDED', 'Run has exhausted its tool cost budget', budget)
      const invocationId = `${capability.id}-${createHash('sha256').update(`${details.inputDigest}/${details.resultDigest}`).digest('hex').slice(0, 16)}`
      const started = await store.appendRunEvent(resolved, { type: 'TOOL_CALL_STARTED', idempotencyKey: `${resolved}/tool/${invocationId}/start`, evidence: { invocationId, capabilityId: capability.id, kind: capability.kind, purpose: String(details.purpose ?? '').slice(0, 240), inputDigest: details.inputDigest } })
      if (!started.ok) return started
      return store.appendRunEvent(resolved, { type: 'TOOL_CALL_FINISHED', idempotencyKey: `${resolved}/tool/${invocationId}/finish`, evidence: { invocationId, capabilityId: capability.id, kind: capability.kind, purpose: String(details.purpose ?? '').slice(0, 240), inputDigest: details.inputDigest, resultDigest: details.resultDigest, outcome: details.outcome === 'failed' ? 'failed' : 'succeeded', elapsedMs: Number.isInteger(details.elapsedMs) && details.elapsedMs >= 0 ? details.elapsedMs : 0, costUnits, adopted: details.adopted === true } })
    })
  }

  async function prepareExternalNode(runId, nodeId) {
    let current = await store.getRun(runId)
    if (!current.ok) return current
    let state = current.projection.nodeStates[nodeId]
    if (!state) return runtimeError('NODE_NOT_FOUND', `Unknown node: ${nodeId}`)
    if (state === 'waiting') {
      current = await store.appendNodeEvent(runId, nodeId, {
        type: 'INPUT_RECEIVED',
        idempotencyKey: `${runId}/${nodeId}/external-input`,
      })
      if (!current.ok) return current
      state = 'ready'
    }
    if (state !== 'ready') {
      return runtimeError('NODE_NOT_READY', `Node ${nodeId} is ${state}, expected ready or waiting`)
    }
    const attemptId = `${nodeId}-external-${randomUUID()}`
    const started = await store.appendNodeEvent(runId, nodeId, {
      type: 'NODE_STARTED',
      attemptId,
      idempotencyKey: `${runId}/${nodeId}/${attemptId}/start`,
    })
    return started.ok ? { ...started, attemptId } : started
  }

  async function finishExternalNode(runId, nodeId, outcome, attemptId) {
    const eventType = outcome.status === 'succeeded'
      ? 'NODE_SUCCEEDED'
      : outcome.status === 'waiting'
        ? 'NODE_WAITING'
        : 'NODE_FAILED'
    return store.appendNodeEvent(runId, nodeId, {
      type: eventType,
      attemptId,
      idempotencyKey: `${runId}/${nodeId}/${attemptId}/outcome`,
      evidence: outcome.evidence,
      error: outcome.error,
    })
  }

  async function resolveNode(runId, nodeId, { status: outcomeStatus = 'succeeded', evidence = {} } = {}) {
    const resolved = await resolveRunId(runId)
    if (!resolved) return runtimeError('NO_ACTIVE_RUN', 'No active workflow run')
    return withRunLease(resolved, async () => {
      if (nodeId === 'loop-execution' && outcomeStatus === 'succeeded') {
        const current = await store.getRun(resolved)
        if (!current.ok) return current
        const validation = validateLoopCompletion(evidence, current.record.plan.context.loop)
        if (!validation.ok) return validation
      }
      if (outcomeStatus === 'succeeded' || (outcomeStatus === 'waiting' && nodeId === 'quality-assessment')) {
        const current = await store.getRun(resolved)
        if (!current.ok) return current
        const evidenceValidation = validateNodeEvidence({
          nodeId,
          evidence,
          context: current.record.plan.context,
        })
        if (!evidenceValidation.ok) return evidenceValidation
        evidence = evidenceValidation.evidence
      }
      const prepared = await prepareExternalNode(resolved, nodeId)
      if (!prepared.ok) return prepared
      return finishExternalNode(
        resolved,
        nodeId,
        outcomeStatus === 'succeeded' || outcomeStatus === 'waiting'
          ? { status: outcomeStatus, evidence }
          : { status: 'failed', error: { code: 'EXTERNAL_NODE_FAILED', message: String(evidence) } },
        prepared.attemptId,
      )
    })
  }

  async function runAdapterNode(runId, nodeId, adapter) {
    const resolved = await resolveRunId(runId)
    if (!resolved) return runtimeError('NO_ACTIVE_RUN', 'No active workflow run')
    return withRunLease(resolved, async () => {
      const prepared = await prepareExternalNode(resolved, nodeId)
      if (!prepared.ok) return prepared
      const outcome = await adapter.execute({
        runId: resolved,
        node: prepared.record.plan.nodes.find((node) => node.id === nodeId),
        plan: prepared.record.plan,
        attemptId: prepared.attemptId,
        idempotencyKey: `${resolved}/${nodeId}/${prepared.attemptId}`,
      })
      const finished = await finishExternalNode(resolved, nodeId, outcome, prepared.attemptId)
      return finished.ok ? { ...finished, outcome } : finished
    })
  }

  async function sediment(runId, sedimentDetails) {
    const adapter = createSedimentAdapter({
      sedimentDirectory: config.sedimentDirectory,
      writerLock,
      details: () => sedimentDetails,
    })
    return runAdapterNode(runId, 'sediment', adapter)
  }

  async function shadow(runId, commitPlan, sedimentDetails) {
    const current = await status(runId)
    if (!current.ok) return current
    const shadowMode = createShadowMode({ git, stateDirectory: config.stateDirectory })
    const decision = await shadowMode.evaluate({
      plan: current.record.plan,
      commitPlan,
      sedimentDetails,
    })
    if (decision.decision === 'ready') {
      const completed = await resolveNode(current.record.runId, 'shadow-decision', {
        evidence: { kind: 'shadow-decision', reportPath: decision.reportPath },
      })
      if (!completed.ok) return completed
    }
    return decision
  }

  async function commit(runId, options) {
    const current = await status(runId)
    if (!current.ok) return current
    const successfulEvidence = (nodeId) => current.record.events
      .filter(
        (event) =>
          event.type === 'NODE_TRANSITIONED' &&
          event.nodeId === nodeId &&
          event.eventType === 'NODE_SUCCEEDED',
      )
      .at(-1)?.evidence
    const verificationEvidence = successfulEvidence('verification')
    const sedimentEvidence = successfulEvidence('sediment')
    if (!verificationEvidence) {
      return runtimeError('VERIFICATION_REQUIRED', 'Run has no successful verification evidence')
    }
    if (verificationEvidence.decision === 'skipped') {
      return runtimeError('VERIFICATION_SKIPPED', 'An explicitly skipped verification cannot authorize a local commit')
    }
    if (verificationEvidence.freshness?.planHash !== current.record.plan.planHash) {
      return runtimeError(
        'VERIFICATION_NOT_FRESH',
        'Verification evidence is not bound to the current immutable Run plan',
      )
    }
    const freshPaths = verificationEvidence.freshness.ownedPathFingerprints
    if (!Array.isArray(freshPaths)) {
      return runtimeError('VERIFICATION_NOT_FRESH', 'Verification evidence has no owned-path content snapshot')
    }
    const currentPaths = await fingerprintPaths(
      config.repositoryDirectory,
      freshPaths.map((entry) => entry.path),
    )
    if (JSON.stringify(currentPaths) !== JSON.stringify(freshPaths)) {
      return runtimeError('VERIFICATION_STALE', 'An owned path changed after the recorded verification')
    }
    if (!sedimentEvidence) {
      return runtimeError('SEDIMENT_REQUIRED', 'Run has no successful sediment decision')
    }
    const executor = createCommitExecutor({
      git,
      writerLock,
      journalDirectory: path.join(config.stateDirectory, 'commit-journals'),
    })
    return runAdapterNode(current.record.runId, 'commit', {
      execute: () => executor.execute({
        plan: current.record.plan,
        commitPlan: options.commitPlan,
        authorized: options.authorized,
        verificationEvidence: [verificationEvidence],
        sedimentEvidence,
      }).then((result) => result.ok
        ? { status: 'succeeded', evidence: { kind: 'atomic-commit', commits: result.commits } }
        : { status: 'failed', error: result.error }),
    })
  }

  return {
    ok: true,
    runtime: { activeRun, commit, recordContext, recordToolCall, resolveNode, resume, sediment, shadow, start, status },
  }
}
