#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { normalizeCliArguments } from '../src/cli-arguments.mjs'
import { evaluateHook } from '../src/hook-adapter.mjs'
import { buildContextIndex, searchContextIndex } from '../src/context-index.mjs'
import { loadWorkflowConfig } from '../src/workflow-config.mjs'
import { resolveProject } from '../src/project-resolver.mjs'
import { createWorkflowRuntime } from '../src/workflow-runtime.mjs'
import { explainRun, summarizeRun, timelineRun } from '../src/workflow-observability.mjs'

function parseArguments(values) {
  const options = { _: [] }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value.startsWith('--')) {
      options._.push(value)
      continue
    }
    const key = value.slice(2)
    if (key === 'commit' || key === 'yes' || key === 'verbose' || key === 'reviewed') {
      options[key] = true
      continue
    }
    const next = values[index + 1]
    if (next === undefined || next.startsWith('--')) throw new Error(`Missing value for --${key}`)
    index += 1
    if (key === 'changed-file' || key === 'signal' || key === 'verification') {
      options[key] = [...(options[key] ?? []), next]
    } else {
      options[key] = next
    }
  }
  return options
}

async function readJson(filePath) {
  return JSON.parse(await readFile(path.resolve(filePath), 'utf8'))
}

async function readStdin() {
  if (process.stdin.isTTY) return ''
  let value = ''
  for await (const chunk of process.stdin) value += chunk
  return value
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function help() {
  process.stdout.write(`Local workflow CLI\n\n` +
    `workflow repos\n` +
    `workflow index [--repo ID]\nworkflow search [--repo ID] --query TEXT [--limit N]\nworkflow context record [--repo ID] [--run ID] --query TEXT --select-file FILE --reviewed\nworkflow tool record [--repo ID] [--run ID] --details FILE\n` +
    `workflow start [--repo ID] --task-id ID --request TEXT --changed-file PATH [--planning-mode inline|structured|openspec] [--execution-mode single-pass|loop] [--signal NAME] [--commit] [--sediment required|skip]\n` +
    `workflow status [--repo ID] [--run ID] [--verbose]\nworkflow explain [--repo ID] [--run ID]\nworkflow timeline [--repo ID] [--run ID]\nworkflow resume [--repo ID] [--run ID]\n` +
    `workflow resolve [--repo ID] --node ID [--run ID] [--evidence TEXT | --evidence-file FILE]\n` +
    `  intake/planning/implementation/quality-assessment/atomic-commit-plan require their structured JSON evidence templates.\n` +
    `workflow sediment [--repo ID] --details FILE [--run ID]\n` +
    `workflow shadow [--repo ID] --plan FILE --details FILE [--run ID]\n` +
    `workflow commit [--repo ID] --plan FILE --yes [--run ID]\n`)
}

async function activeRunGuard(runtime, config) {
  const runId = await runtime.activeRun()
  if (!runId) return null
  const current = await runtime.status(runId)
  if (!current.ok) return null
  return {
    runId,
    status: current.projection.status,
    ownedPaths: current.record.plan.context.changedFiles.map((item) => path.resolve(config.repositoryDirectory, item)),
  }
}

async function outputHook(event, activeRun, workspaceMessage = '', suppliedInput = null) {
  const inputText = suppliedInput ?? await readStdin()
  let input = {}
  try { input = inputText.trim() ? JSON.parse(inputText) : {} } catch { input = {} }
  const decision = evaluateHook(event, input, { activeRun, repositoryDirectory })
  if (event === 'pre-tool-use' && decision.decision === 'deny') {
    print({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: decision.reason,
      },
    })
    process.exit(0)
  }
  process.stdout.write(`${workspaceMessage}${decision.message ?? decision.reason}\n`)
  process.exit(0)
}

const [command = 'help', ...rest] = normalizeCliArguments(process.argv.slice(2))
const options = parseArguments(rest)
const repositoryDirectory = path.resolve(options.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd())
const configSource = await readFile(path.join(repositoryDirectory, '.workflow', 'config.yaml'), 'utf8')
const configResult = loadWorkflowConfig(configSource, repositoryDirectory, {
  repositoryId: options.repo,
})
if (!configResult.ok) {
  print(configResult)
  process.exit(1)
}

if (command === 'help' || command === '--help') {
  help()
  process.exit(0)
}

if (command === 'repos') {
  if (configResult.mode === 'workspace') {
    print({
      ok: true,
      mode: 'workspace',
      workspaceName: configResult.workspace.workspaceName,
      repositories: configResult.workspace.repositories.map((repository) => ({
        id: repository.id,
        projectName: repository.projectName,
        path: repository.path,
        stacks: repository.stacks,
        legacyWorkflowStatus: repository.legacyWorkflowStatus,
        legacyWorkflowEntrypoints: repository.legacyWorkflowEntrypoints,
        verification: repository.verification,
      })),
    })
  } else {
    print({
      ok: true,
      mode: 'single',
      repositories: [{ id: configResult.config.projectName, path: '.' }],
    })
  }
  process.exit(0)
}

if (configResult.mode === 'workspace' && !configResult.config) {
  if (command === 'hook') {
    const inputText = await readStdin()
    let hookInput = {}
    try { hookInput = inputText.trim() ? JSON.parse(inputText) : {} } catch { hookInput = {} }
    const rawTarget = hookInput?.tool_input?.file_path ?? hookInput?.toolInput?.filePath ?? ''
    const absoluteTarget = rawTarget ? path.resolve(repositoryDirectory, rawTarget) : ''
    const matched = configResult.workspace.repositories
      .map((item) => ({ ...item, absolutePath: path.resolve(repositoryDirectory, item.path) }))
      .filter((item) => absoluteTarget === item.absolutePath || absoluteTarget.startsWith(`${item.absolutePath}${path.sep}`))
      .sort((left, right) => right.absolutePath.length - left.absolutePath.length)[0]
    if (matched) {
      const selected = loadWorkflowConfig(configSource, repositoryDirectory, { repositoryId: matched.id })
      const selectedRuntime = selected.ok ? await createWorkflowRuntime({ config: selected.config }) : selected
      if (selectedRuntime.ok) {
        await outputHook(options._[0], await activeRunGuard(selectedRuntime.runtime, selected.config), '', inputText)
      }
    }
    const ids = configResult.workspace.repositories.map((repository) => repository.id).join(', ')
    await outputHook(
      options._[0],
      null,
      `Workspace mode. Repositories: ${ids}. Select CLI operations with --repo <id>. `,
      inputText,
    )
  }
  print({
    ok: false,
    error: {
      code: 'WORKSPACE_REPOSITORY_REQUIRED',
      message: 'Workspace commands require --repo <id>',
      availableRepositories: configResult.workspace.repositories.map((repository) => repository.id),
    },
  })
  process.exit(1)
}

if (configResult.config?.governance?.remotePatterns?.length > 0) {
  const identity = await resolveProject({
    repositoryDirectory: configResult.config.repositoryDirectory,
    remotePatterns: configResult.config.governance.remotePatterns,
    canonicalRemote: configResult.config.governance.canonicalRemote,
    matchAllRemotes: configResult.config.governance.matchAllRemotes,
  })
  if (!identity.ok) {
    print({
      ok: false,
      error: {
        code: 'PROJECT_REMOTE_' + identity.status.toUpperCase().replaceAll('-', '_'),
        message: 'Repository remote did not match configured project identity: ' + identity.status,
        canonical: identity.canonical?.normalized ?? null,
      },
    })
    process.exit(1)
  }
}

const runtimeResult = await createWorkflowRuntime({ config: configResult.config })
if (!runtimeResult.ok) {
  print(runtimeResult)
  process.exit(1)
}
const runtime = runtimeResult.runtime
let result

if (command === 'start') {
  result = await runtime.start({
    taskId: options['task-id'],
    request: options.request,
    sediment: options.sediment ?? 'required',
    signals: [...(options.signal ?? []), ...(options.commit ? ['COMMIT_REQUESTED'] : [])],
    changedFiles: options['changed-file'] ?? [],
    planningMode: options['planning-mode'],
    executionMode: options['execution-mode'],
  })
} else if (command === 'status') {
  result = await runtime.status(options.run)
  if (result.ok) result = options.verbose ? { ok: true, ...summarizeRun(result.record, result.projection) } : { ok: true, projection: result.projection }
} else if (command === 'explain') {
  result = await runtime.status(options.run)
  if (result.ok) result = { ok: true, explanation: explainRun(result.record, result.projection) }
} else if (command === 'timeline') {
  result = await runtime.status(options.run)
  if (result.ok) result = { ok: true, runId: result.record.runId, events: timelineRun(result.record) }
} else if (command === 'resume') {
  result = await runtime.resume(options.run)
} else if (command === 'resolve') {
  const externalEvidence = options['evidence-file']
    ? await readJson(options['evidence-file'])
    : { kind: 'external', message: options.evidence ?? 'completed by operator' }
  result = await runtime.resolveNode(options.run, options.node, {
    status: options.status ?? 'succeeded',
    evidence: externalEvidence,
  })
} else if (command === 'sediment') {
  result = await runtime.sediment(options.run, await readJson(options.details))
} else if (command === 'shadow') {
  result = await runtime.shadow(
    options.run,
    await readJson(options.plan),
    await readJson(options.details),
  )
} else if (command === 'commit') {
  result = await runtime.commit(options.run, {
    commitPlan: await readJson(options.plan),
    authorized: options.yes === true,
  })
} else if (command === 'hook') {
  const event = options._[0]
  await outputHook(event, await activeRunGuard(runtime, configResult.config))
} else if (command === 'index') {
  result = await buildContextIndex({
    repositoryDirectory: configResult.config.repositoryDirectory,
    stateDirectory: configResult.config.stateDirectory,
  })
} else if (command === 'search') {
  result = await searchContextIndex({
    repositoryDirectory: configResult.config.repositoryDirectory,
    stateDirectory: configResult.config.stateDirectory,
    query: options.query,
    limit: options.limit === undefined ? undefined : Number(options.limit),
  })
} else if (command === 'context') {
  if (options._[0] !== 'record') throw new Error(`Unknown context command: ${options._[0] ?? '<missing>'}`)
  const selectionDocument = await readJson(options['select-file'])
  result = await runtime.recordContext(options.run, {
    query: options.query,
    selections: Array.isArray(selectionDocument) ? selectionDocument : selectionDocument.selections,
    reviewed: options.reviewed === true,
  })
} else if (command === 'tool') {
  if (options._[0] !== 'record') throw new Error(`Unknown tool command: ${options._[0] ?? '<missing>'}`)
  result = await runtime.recordToolCall(options.run, await readJson(options.details))
} else {
  throw new Error(`Unknown workflow command: ${command}`)
}

print(result)
if (!result?.ok) process.exitCode = 1
