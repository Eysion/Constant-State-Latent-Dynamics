import path from 'node:path'
import { detectUnattendedRequest, inferUnattendedRiskSignals } from './unattended-policy.mjs'
import { evaluatePromptIntake } from './prompt-intake.mjs'

function splitReadOnlyCommands(source) {
  const segments = []
  let current = ''
  let quote = null
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      current += character
      if (character === quote && source[index - 1] !== '\\') quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      current += character
      continue
    }
    if (source.startsWith('&&', index) || source.startsWith('||', index)) {
      segments.push(current.trim())
      current = ''
      index += 1
      continue
    }
    if (character === '|' || character === ';') {
      segments.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  if (quote) return null
  segments.push(current.trim())
  return segments.filter(Boolean)
}

function isAllowedShell(command) {
  const source = String(command)
  if (/[\r\n<>`]/.test(source) || /\$\(|\$\{|\(< /.test(source) || /(^|[^&])&([^&]|$)/.test(source)) return false
  const segments = splitReadOnlyCommands(source)
  if (!segments) return false
  return segments.every((segment) => {
    const value = segment.trim()
    return /^(?:pwd|ls|rg|grep|cat|head|tail|wc|diff)(?:\s|$)[^;&|<>`]*$/.test(value)
      || /^find\s+(?!.*(?:-exec|(?:-ok)|-delete|-fprintf|-fprint|-fls|>))[^;&|<>`]*$/.test(value)
      || /^(?:git\s+(?:status(?:\s+--short)?|diff(?:\s+(?:--check|--stat|--name-only))?|log(?:\s|$)|show(?:\s|$)|branch\s+--show-current|rev-parse(?:\s+--show-toplevel|\s+HEAD)|remote\s+(?:-v|get-url\s+(?:--all\s+|--push\s+)?[A-Za-z0-9._-]+)))\s*$/.test(value)
      || /^(?:node\s+)?(?:"[^"]+"|[^\s]+)?tooling\/ai-workflow\/cli\/workflow\.mjs(?:\s+[^;&|<>`]*)?$/.test(value)
  })
}

function normalizeToolPath(value, repositoryDirectory) {
  if (typeof value !== 'string' || value.length === 0) return null
  const root = path.resolve(repositoryDirectory ?? process.cwd())
  const resolved = path.resolve(root, value)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null
  return resolved
}

export function evaluateHook(event, input = {}, { activeRun, repositoryDirectory } = {}) {
  if (event === 'pre-tool-use') {
    const toolName = input?.tool_name ?? input?.toolName ?? ''
    if (/^(Write|Edit|MultiEdit)$/i.test(toolName)) {
      if (!activeRun || ['completed', 'failed', 'cancelled', 'blocked'].includes(activeRun.status)) {
        return { decision: 'deny', reason: 'Start an active eligible workflow Run before modifying files.' }
      }
      const target = normalizeToolPath(input?.tool_input?.file_path ?? input?.toolInput?.filePath ?? '', repositoryDirectory)
      const ownedPaths = (activeRun.ownedPaths ?? []).map((ownedPath) => normalizeToolPath(ownedPath, repositoryDirectory)).filter(Boolean)
      if (!target || !ownedPaths.includes(target)) return { decision: 'deny', reason: 'The file is outside the active Run immutable owned paths.' }
    }
    const command = input?.tool_input?.command ?? input?.toolInput?.command ?? ''
    if (!isAllowedShell(command)) return { decision: 'deny', reason: 'Unclassified Bash is denied. Use read-only shell commands, the workflow CLI, or a registered command adapter.' }
    if (/(?:^|[;&|]\s*)git\s+(?:add|commit)\b/.test(command)) return { decision: 'deny', reason: 'Git staging and local commits are owned by the workflow CLI. Use workflow shadow, then workflow commit --yes.' }
    return { decision: 'allow', reason: 'Command is on the read-only/workflow CLI allowlist.' }
  }
  const runText = activeRun ? `Active workflow run: ${activeRun.runId ?? activeRun}.` : 'No active workflow run.'
  if (event === 'session-start') return { decision: 'allow', message: `${runText} Use workflow start/status/resume to enter the local state machine.` }
  if (event === 'user-prompt-submit') {
    const prompt = input?.prompt ?? input?.user_prompt ?? ''
    const intake = evaluatePromptIntake({ request: prompt })
    const unattended = detectUnattendedRequest(prompt)
    if (unattended.enabled) {
      const blockers = inferUnattendedRiskSignals(prompt)
      return { decision: 'allow', message: blockers.length > 0 ? `${runText} 无人值守资格评估：WAIT_CONFIRMATION（${blockers.join(', ')}）。补齐业务边界并确认后才能启动。` : `${runText} 无人值守资格评估已请求；仍需在 start 时确认精确 changed-file 与自动验证能力，合格后才会启用受限 Loop。` }
    }
    return { decision: 'allow', message: `${runText} Prompt Intake: ${intake.decision}. ${intake.reasons.join(', ') || 'ready'}${intake.template ? `\n${intake.template}` : ''}` }
  }
  if (event === 'stop') return { decision: 'allow', message: `${runText} Check workflow status before claiming completion.` }
  return { decision: 'allow', message: runText }
}
