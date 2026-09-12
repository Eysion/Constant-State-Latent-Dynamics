import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { createWorkflowRuntime } from '../src/workflow-runtime.mjs'
import { buildContextIndex } from '../src/context-index.mjs'

const workflowRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('selects planning and execution nodes from deterministic signals', async (t) => {
  const repositoryDirectory = await mkdtemp(path.join(tmpdir(), 'workflow-runtime-modes-'))
  t.after(() => rm(repositoryDirectory, { recursive: true, force: true }))
  const runtimeResult = await createWorkflowRuntime({
    config: {
      repositoryDirectory,
      workflowDefinition: path.join(workflowRoot, 'workflows', 'development-v1.yaml'),
      stateDirectory: path.join(repositoryDirectory, '.workflow', 'state'),
      sedimentDirectory: path.join(repositoryDirectory, 'records'),
      verification: {
        file: process.execPath,
        args: ['-e', "process.stdout.write('verified')"],
        timeoutMs: 1000,
      },
    },
  })
  const runtime = runtimeResult.runtime

  const longTask = await runtime.start({
    taskId: 'long-task',
    request: 'A long but deterministic migration',
    sediment: 'skip',
    signals: ['LONG_RUNNING_IMPLEMENTATION'],
    changedFiles: ['example.txt'],
  })
  assert.equal(longTask.record.plan.context.planningMode, 'structured')
  assert.equal(longTask.record.plan.context.executionMode, 'single-pass')
  assert.equal(longTask.record.plan.nodes.some((node) => node.id === 'loop-execution'), false)

  const loopTask = await runtime.start({
    taskId: 'loop-task',
    request: 'Iterate against automated acceptance',
    sediment: 'skip',
    signals: ['ITERATIVE_ACCEPTANCE'],
    changedFiles: ['example.txt'],
  })
  assert.equal(loopTask.record.plan.context.executionMode, 'loop')
  assert.equal(loopTask.record.plan.nodes.some((node) => node.id === 'loop-execution'), true)

  const contractTask = await runtime.start({
    taskId: 'contract-task',
    request: 'Change an API contract',
    sediment: 'skip',
    signals: ['API_CONTRACT_CHANGE'],
    changedFiles: ['example.txt'],
  })
  assert.equal(contractTask.record.plan.context.planningMode, 'openspec')
  assert.equal(contractTask.record.plan.nodes.some((node) => node.id === 'openspec-contract'), true)
  assert.deepEqual(contractTask.record.plan.context.eventGates, [{
    signal: 'API_CONTRACT_CHANGE', source: 'operator', confidence: 'declared',
  }])
})

test('refuses a Run without registered owned paths before it can collect AI evidence', async (t) => {
  const repositoryDirectory = await mkdtemp(path.join(tmpdir(), 'workflow-runtime-owned-paths-'))
  t.after(() => rm(repositoryDirectory, { recursive: true, force: true }))
  const runtimeResult = await createWorkflowRuntime({
    config: {
      repositoryDirectory,
      workflowDefinition: path.join(workflowRoot, 'workflows', 'development-v1.yaml'),
      stateDirectory: path.join(repositoryDirectory, '.workflow', 'state'),
      sedimentDirectory: path.join(repositoryDirectory, 'records'),
      verification: { file: process.execPath, args: ['-e', ''], timeoutMs: 1000 },
    },
  })
  const result = await runtimeResult.runtime.start({
    taskId: 'missing-owned-paths', request: 'No paths', sediment: 'skip', signals: [], changedFiles: [],
  })
  assert.equal(result.error.code, 'OWNED_PATHS_REQUIRED')
})

test('enforces unattended eligibility inside runtime and never silently downgrades it', async (t) => {
  const repositoryDirectory = await mkdtemp(path.join(tmpdir(), 'workflow-runtime-unattended-'))
  t.after(() => rm(repositoryDirectory, { recursive: true, force: true }))
  const base = {
    repositoryDirectory,
    workflowDefinition: path.join(workflowRoot, 'workflows', 'development-v1.yaml'),
    sedimentDirectory: path.join(repositoryDirectory, 'records'),
  }
  const enabled = await createWorkflowRuntime({ config: {
    ...base,
    stateDirectory: path.join(repositoryDirectory, '.workflow', 'enabled'),
    verification: { file: process.execPath, args: ['-e', ''], timeoutMs: 1000 },
  } })
  await writeFile(path.join(repositoryDirectory, 'owned.mjs'), '')
  const started = await enabled.runtime.start({ taskId: 'unattended-ok', request: '无人值守完善本地模块', sediment: 'skip', signals: [], changedFiles: ['owned.mjs'] })
  assert.equal(started.record.plan.context.executionMode, 'loop')
  assert.equal(started.record.plan.context.signals.includes('UNATTENDED'), true)
  const downgraded = await enabled.runtime.start({ taskId: 'unattended-single', request: '无人值守完善本地模块', sediment: 'skip', signals: [], changedFiles: ['owned.mjs'], executionMode: 'single-pass' })
  assert.equal(downgraded.error.code, 'UNATTENDED_LOOP_REQUIRED')

  const disabled = await createWorkflowRuntime({ config: {
    ...base,
    stateDirectory: path.join(repositoryDirectory, '.workflow', 'disabled'),
    governance: { commands: { test: null } },
    verification: { file: process.execPath, args: ['-e', ''], timeoutMs: 1000 },
  } })
  const blocked = await disabled.runtime.start({ taskId: 'unattended-no-test', request: '无人值守完善本地模块', sediment: 'skip', signals: [], changedFiles: ['owned.mjs'] })
  assert.equal(blocked.error.code, 'UNATTENDED_ELIGIBILITY_REQUIRED')
  assert.deepEqual(blocked.error.blockers, ['no automated verification command'])
})

test('records only explicit, reviewed lexical references used by a Run', async (t) => {
  const repositoryDirectory = await mkdtemp(path.join(tmpdir(), 'workflow-runtime-context-'))
  t.after(() => rm(repositoryDirectory, { recursive: true, force: true }))
  await writeFile(path.join(repositoryDirectory, 'service.mjs'), 'export const paymentToken = token\n')
  const stateDirectory = path.join(repositoryDirectory, '.workflow', 'state')
  await buildContextIndex({ repositoryDirectory, stateDirectory })
  const runtimeResult = await createWorkflowRuntime({
    config: {
      repositoryDirectory,
      workflowDefinition: path.join(workflowRoot, 'workflows', 'development-v1.yaml'),
      stateDirectory,
      sedimentDirectory: path.join(repositoryDirectory, 'records'),
      verification: { file: process.execPath, args: ['-e', ''], timeoutMs: 1000 },
    },
  })
  const runtime = runtimeResult.runtime
  await runtime.start({ taskId: 'context-record', request: 'Trace payment token', sediment: 'skip', signals: [], changedFiles: ['service.mjs'] })
  assert.equal((await runtime.recordContext(null, {
    query: 'payment token', selections: [{ path: 'service.mjs', line: 1 }], reviewed: false,
  })).error.code, 'CONTEXT_REVIEW_REQUIRED')
  const recorded = await runtime.recordContext(null, {
    query: 'payment token', selections: [{ path: 'service.mjs', line: 1 }], reviewed: true,
  })
  assert.equal(recorded.ok, true)
  assert.deepEqual(recorded.appendedEvent.evidence.references, [{ path: 'service.mjs', line: 1, stale: false }])
  assert.equal(recorded.appendedEvent.evidence.content, undefined)
  assert.equal((await runtime.recordContext(null, {
    query: 'payment token', selections: [{ path: 'missing.mjs', line: 1 }], reviewed: true,
  })).error.code, 'CONTEXT_SELECTION_NOT_RETRIEVED')
})

test('adds the initialized project quality gate for high-risk work', async (t) => {
  const repositoryDirectory = await mkdtemp(path.join(tmpdir(), 'workflow-runtime-quality-'))
  t.after(() => rm(repositoryDirectory, { recursive: true, force: true }))
  const runtimeResult = await createWorkflowRuntime({
    config: {
      repositoryDirectory,
      workflowDefinition: path.join(workflowRoot, 'workflows', 'development-v1.yaml'),
      stateDirectory: path.join(repositoryDirectory, '.workflow', 'state'),
      sedimentDirectory: path.join(repositoryDirectory, 'records'),
      verification: { file: process.execPath, args: ['-e', ''], timeoutMs: 1000 },
      qualityPolicy: {
        enabled: true, highRiskSignals: ['AUTH_OR_SECURITY_CHANGE'], negativeFeedbackSignals: ['USER_DISSATISFACTION'], candidateCount: 3, accuracyThreshold: 0.85,
      },
    },
  })
  const started = await runtimeResult.runtime.start({
    taskId: 'quality-gate', request: 'Secure a boundary', sediment: 'skip', signals: ['AUTH_OR_SECURITY_CHANGE'], changedFiles: ['auth.mjs'],
  })
  assert.equal(started.record.plan.context.qualityGate.enabled, true)
  assert.equal(started.record.plan.context.qualityGate.candidateCount, 3)
  assert.equal(started.record.plan.nodes.some((node) => node.id === 'quality-assessment'), true)
  assert.deepEqual(started.record.plan.nodes.find((node) => node.id === 'sediment').requires, ['quality-assessment'])
})

test('refuses an existing symbolic link as an owned path', async (t) => {
  const repositoryDirectory = await mkdtemp(path.join(tmpdir(), 'workflow-runtime-symlink-'))
  t.after(() => rm(repositoryDirectory, { recursive: true, force: true }))
  await writeFile(path.join(repositoryDirectory, 'outside.txt'), 'outside\n')
  await symlink('outside.txt', path.join(repositoryDirectory, 'owned-link.txt'))
  const runtimeResult = await createWorkflowRuntime({
    config: {
      repositoryDirectory,
      workflowDefinition: path.join(workflowRoot, 'workflows', 'development-v1.yaml'),
      stateDirectory: path.join(repositoryDirectory, '.workflow', 'state'),
      sedimentDirectory: path.join(repositoryDirectory, 'records'),
      verification: { file: process.execPath, args: ['-e', ''], timeoutMs: 1000 },
    },
  })
  const result = await runtimeResult.runtime.start({
    taskId: 'symlink-path', request: 'Reject a link', sediment: 'skip', signals: [], changedFiles: ['owned-link.txt'],
  })
  assert.equal(result.error.code, 'OWNED_PATH_SYMLINK_UNSUPPORTED')
})

test('records an explicit verification skip but does not convert it into fresh verification evidence', async (t) => {
  const repositoryDirectory = await mkdtemp(path.join(tmpdir(), 'workflow-runtime-verification-skip-'))
  t.after(() => rm(repositoryDirectory, { recursive: true, force: true }))
  const runtimeResult = await createWorkflowRuntime({
    config: {
      repositoryDirectory,
      workflowDefinition: path.join(workflowRoot, 'workflows', 'development-v1.yaml'),
      stateDirectory: path.join(repositoryDirectory, '.workflow', 'state'),
      sedimentDirectory: path.join(repositoryDirectory, 'records'),
      verification: { file: process.execPath, args: ['-e', 'throw new Error()'], timeoutMs: 1000 },
      governance: { commands: { test: null } },
    },
  })
  const runtime = runtimeResult.runtime
  await runtime.start({ taskId: 'skip-check', request: 'Skip is explicit', sediment: 'skip', signals: [], changedFiles: ['owned.txt'] })
  const evidence = {
    'context-review': { schemaVersion: 1, kind: 'context-review', guidancePaths: ['owned.txt'], sourceReferences: [{ path: 'owned.txt', line: 1, purpose: 'Review target' }], verification: ['verification is intentionally not configured'] },
    intake: { schemaVersion: 1, kind: 'intake', request: 'Skip is explicit', ownedPaths: ['owned.txt'], acceptanceCriteria: ['Skip is reported'] },
    planning: { schemaVersion: 1, kind: 'inline-plan', goal: 'Report skip', ownedPaths: ['owned.txt'], steps: ['Run verification node'], acceptance: ['Skip is reported'], verification: ['verification is intentionally not configured'] },
    implementation: { schemaVersion: 1, kind: 'implementation', summary: 'No file needed', changedPaths: ['owned.txt'], verificationScope: ['verification check is intentionally skipped'] },
  }
  for (const nodeId of ['intake', 'context-review', 'planning', 'implementation']) {
    await runtime.resume()
    await runtime.resolveNode(null, nodeId, { evidence: evidence[nodeId] })
  }
  await runtime.resume()
  const status = await runtime.status()
  const event = status.record.events.find((item) => item.nodeId === 'verification' && item.eventType === 'NODE_SUCCEEDED')
  assert.equal(event.evidence.decision, 'skipped')
})

test('drives a complete no-commit run through CLI runtime operations', async (t) => {
  const repositoryDirectory = await mkdtemp(path.join(tmpdir(), 'workflow-runtime-'))
  t.after(() => rm(repositoryDirectory, { recursive: true, force: true }))
  const runtimeResult = await createWorkflowRuntime({
    config: {
      repositoryDirectory,
      workflowDefinition: path.join(workflowRoot, 'workflows', 'development-v1.yaml'),
      stateDirectory: path.join(repositoryDirectory, '.workflow', 'state'),
      sedimentDirectory: path.join(repositoryDirectory, 'records'),
      verification: {
        file: process.execPath,
        args: ['-e', "process.stdout.write('verified')"],
        timeoutMs: 1000,
      },
    },
  })
  assert.equal(runtimeResult.ok, true)
  const runtime = runtimeResult.runtime

  await runtime.start({
    taskId: 'runtime-task',
    request: 'Exercise runtime lifecycle',
    sediment: 'required',
    signals: [],
    changedFiles: ['example.txt'],
  })
  const started = await runtime.status()
  assert.deepEqual(started.record.plan.context.changedFiles, [
    'example.txt',
    'records/runtime-task.md',
  ])
  await runtime.resume()
  await runtime.resolveNode(null, 'intake', { evidence: {
    schemaVersion: 1, kind: 'intake', request: 'Exercise runtime lifecycle',
    ownedPaths: ['example.txt', 'records/runtime-task.md'], acceptanceCriteria: ['Lifecycle completes'],
  } })
  await runtime.resume()
  await runtime.resolveNode(null, 'context-review', { evidence: { schemaVersion: 1, kind: 'context-review', guidancePaths: ['example.txt'], sourceReferences: [{ path: 'example.txt', line: 1, purpose: 'Review target' }], verification: ['node --test'] } })
  await runtime.resume()
  await runtime.resolveNode(null, 'planning', { evidence: {
    schemaVersion: 1, kind: 'inline-plan', goal: 'Exercise lifecycle',
    ownedPaths: ['example.txt', 'records/runtime-task.md'], steps: ['Run lifecycle'],
    acceptance: ['Lifecycle completes'], verification: ['node verification'],
  } })
  await runtime.resume()
  await runtime.resolveNode(null, 'implementation', { evidence: {
    schemaVersion: 1, kind: 'implementation', summary: 'Lifecycle exercised',
    changedPaths: ['example.txt'], verificationScope: ['node test verification'],
  } })
  const verified = await runtime.resume()

  assert.equal(verified.projection.nodeStates.verification, 'succeeded')
  assert.equal(verified.projection.nodeStates.sediment, 'waiting')

  const sediment = await runtime.sediment(null, {
    summary: 'Runtime lifecycle completed.',
    verification: ['node verification: passed'],
  })
  assert.equal(sediment.outcome.status, 'succeeded')
  const completed = await runtime.resume()

  assert.equal(completed.projection.status, 'completed')
  assert.match(
    await readFile(path.join(repositoryDirectory, 'records', 'runtime-task.md'), 'utf8'),
    /Runtime lifecycle completed/,
  )
})

test('uses Run evidence to shadow and commit implementation plus generated sediment', async (t) => {
  const repositoryDirectory = await mkdtemp(path.join(tmpdir(), 'workflow-runtime-commit-'))
  t.after(() => rm(repositoryDirectory, { recursive: true, force: true }))
  await execa('git', ['init', '--quiet'], { cwd: repositoryDirectory })
  await execa('git', ['config', 'user.name', 'Workflow Test'], { cwd: repositoryDirectory })
  await execa('git', ['config', 'user.email', 'workflow@example.invalid'], { cwd: repositoryDirectory })
  await writeFile(path.join(repositoryDirectory, 'owned.txt'), 'initial\n')
  await execa('git', ['add', 'owned.txt'], { cwd: repositoryDirectory })
  await execa('git', ['commit', '--quiet', '-m', 'test: initial'], { cwd: repositoryDirectory })
  await writeFile(path.join(repositoryDirectory, 'owned.txt'), 'changed\n')

  const runtimeResult = await createWorkflowRuntime({
    config: {
      repositoryDirectory,
      workflowDefinition: path.join(workflowRoot, 'workflows', 'development-v1.yaml'),
      stateDirectory: path.join(repositoryDirectory, '.workflow', 'state'),
      sedimentDirectory: path.join(repositoryDirectory, 'records'),
      verification: {
        file: process.execPath,
        args: ['-e', "process.stdout.write('verified')"],
        timeoutMs: 1000,
      },
    },
  })
  const runtime = runtimeResult.runtime
  const details = { summary: 'Committed through runtime.', verification: ['node check passed'] }
  const commitPlan = {
    schemaVersion: 1,
    runId: 'commit-task',
    groups: [
      {
        id: 'runtime-change',
        message: 'feat: commit through workflow runtime',
        paths: ['owned.txt', 'records/commit-task.md'],
      },
    ],
  }

  await runtime.start({
    taskId: 'commit-task',
    request: 'Commit through runtime',
    sediment: 'required',
    signals: ['COMMIT_REQUESTED'],
    changedFiles: ['owned.txt'],
  })
  const nodeEvidence = {
    'context-review': { schemaVersion: 1, kind: 'context-review', guidancePaths: ['owned.txt'], sourceReferences: [{ path: 'owned.txt', line: 1, purpose: 'Review target' }], verification: ['node --test'] },
    intake: { schemaVersion: 1, kind: 'intake', request: 'Commit through runtime', ownedPaths: ['owned.txt', 'records/commit-task.md'], acceptanceCriteria: ['Commit completes'] },
    planning: { schemaVersion: 1, kind: 'inline-plan', goal: 'Commit change', ownedPaths: ['owned.txt', 'records/commit-task.md'], steps: ['Commit exact paths'], acceptance: ['Commit completes'], verification: ['node verification'] },
    implementation: { schemaVersion: 1, kind: 'implementation', summary: 'Changed owned file', changedPaths: ['owned.txt'], verificationScope: ['node test verification'] },
  }
  for (const nodeId of ['intake', 'context-review', 'planning', 'implementation']) {
    await runtime.resume()
    await runtime.resolveNode(null, nodeId, { evidence: nodeEvidence[nodeId] })
  }
  await runtime.resume()
  await runtime.sediment(null, details)
  const verifiedRun = await runtime.status()
  const verificationEvidence = verifiedRun.record.events
    .filter((event) => event.nodeId === 'verification' && event.eventType === 'NODE_SUCCEEDED')
    .at(-1).evidence
  assert.equal(verificationEvidence.freshness.planHash, verifiedRun.record.plan.planHash)
  assert.equal(verificationEvidence.freshness.after.repository.status, 'git')
  await writeFile(path.join(repositoryDirectory, 'owned.txt'), 'changed after verification\n')
  const staleCommit = await runtime.commit(null, { commitPlan, authorized: true })
  assert.equal(staleCommit.error.code, 'VERIFICATION_STALE')
  await writeFile(path.join(repositoryDirectory, 'owned.txt'), 'changed\n')
  await runtime.resume()
  await runtime.resolveNode(null, 'atomic-commit-plan', { evidence: { schemaVersion: 1, kind: 'atomic-commit-plan', commitPlan } })
  await runtime.resume()
  const shadow = await runtime.shadow(null, commitPlan, details)
  assert.equal(shadow.decision, 'ready')
  await runtime.resume()
  const committed = await runtime.commit(null, { commitPlan, authorized: true })
  assert.equal(committed.outcome.status, 'succeeded')
  const completed = await runtime.resume()

  assert.equal(completed.projection.status, 'completed')
  const committedPaths = (await execa(
    'git',
    ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', 'HEAD'],
    { cwd: repositoryDirectory },
  )).stdout.split('\n').filter(Boolean).sort()
  assert.deepEqual(committedPaths, ['owned.txt', 'records/commit-task.md'])
})
