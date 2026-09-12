import { execa } from 'execa'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_REDACTION_PATTERNS = [
  /(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi,
  /((?:token|api[_-]?key|password)\s*[=:]\s*)[^\s,;]+/gi,
]

export function redactText(value, { secrets = [] } = {}) {
  let output = String(value ?? '')

  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      output = output.split(secret).join('[REDACTED]')
    }
  }

  for (const pattern of DEFAULT_REDACTION_PATTERNS) {
    output = output.replace(pattern, '$1[REDACTED]')
  }

  return output
}

function readDeclaredPackageManager(packageJson) {
  const declaration = packageJson?.packageManager
  if (typeof declaration !== 'string') return null
  const match = declaration.match(/^(pnpm|npm|yarn)@([^+\s]+)(?:\+.*)?$/)
  return match ? { name: match[1], version: match[2] } : null
}

export function resolvePackageManagerInvocation({ file, args, packageManager, pathValue = process.env.PATH }) {
  if (file !== packageManager?.name || !packageManager?.version) return { file, args }

  const voltaPath = String(pathValue || '')
    .split(path.delimiter)
    .map(directory => path.join(directory, 'volta'))
    .find(candidate => existsSync(candidate))

  if (!voltaPath) return { file, args }
  const voltaHome = path.dirname(path.dirname(voltaPath))
  const managedExecutable = path.join(
    voltaHome,
    'tools',
    'image',
    packageManager.name,
    packageManager.version,
    'bin',
    packageManager.name,
  )
  if (!existsSync(managedExecutable)) return { file, args }
  return {
    file: managedExecutable,
    args,
  }
}

export function createCommandAdapter({
  file,
  args = [],
  cwd = process.cwd(),
  environment = {},
  allowedEnvironmentVariables = [],
  secrets = [],
  idempotent = false,
  timeoutMs,
}) {
  if (typeof file !== 'string' || file.length === 0) {
    throw new TypeError('Command adapter requires a non-empty executable file')
  }

  const selectedEnvironment = {
    PATH: [path.dirname(process.execPath), environment.PATH ?? process.env.PATH].filter(Boolean).join(path.delimiter),
    ...Object.fromEntries(
      ['HOME', 'VOLTA_HOME', 'COREPACK_HOME', 'PNPM_HOME', 'CI']
        .filter((name) => Object.hasOwn(process.env, name))
        .map((name) => [name, process.env[name]]),
    ),
    ...Object.fromEntries(
      allowedEnvironmentVariables
        .filter((name) => Object.hasOwn(process.env, name))
        .map((name) => [name, process.env[name]]),
    ),
    ...environment,
  }

  function commandEvidence(result) {
    return {
      kind: 'command',
      executable: file,
      arguments: args.map((argument) => redactText(argument, { secrets })),
      exitCode: result.exitCode ?? null,
      stdout: redactText(result.stdout, { secrets }),
      stderr: redactText(result.stderr, { secrets }),
    }
  }

  return {
    idempotent,
    async execute({ node, signal }) {
      try {
        let packageManager = null
        if (['pnpm', 'npm', 'yarn'].includes(file)) {
          try {
            packageManager = readDeclaredPackageManager(JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')))
          } catch (error) {
            if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') throw error
          }
        }
        const invocation = resolvePackageManagerInvocation({ file, args, packageManager, pathValue: selectedEnvironment.PATH })
        const invocationEnvironment = invocation.file === file
          ? selectedEnvironment
          : {
              ...selectedEnvironment,
              PATH: [path.dirname(invocation.file), selectedEnvironment.PATH].filter(Boolean).join(path.delimiter),
            }
        const result = await execa(invocation.file, invocation.args, {
          cwd,
          env: invocationEnvironment,
          extendEnv: false,
          reject: false,
          timeout: node.timeoutMs ?? timeoutMs,
          cancelSignal: signal,
          stripFinalNewline: false,
        })
        const evidence = commandEvidence(result)

        if (result.exitCode === 0) return { status: 'succeeded', evidence }

        const code = result.timedOut
          ? 'COMMAND_TIMEOUT'
          : result.isCanceled
            ? 'COMMAND_CANCELLED'
            : 'COMMAND_EXIT_NON_ZERO'

        return {
          status: 'failed',
          error: {
            code,
            message:
              code === 'COMMAND_EXIT_NON_ZERO'
                ? `Command exited with ${result.exitCode}`
                : redactText(result.shortMessage, { secrets }),
          },
          evidence,
        }
      } catch (error) {
        const code = error.timedOut
          ? 'COMMAND_TIMEOUT'
          : error.isCanceled
            ? 'COMMAND_CANCELLED'
            : 'COMMAND_EXECUTION_ERROR'

        return {
          status: 'failed',
          error: { code, message: redactText(error.shortMessage ?? error.message, { secrets }) },
          evidence: commandEvidence(error),
        }
      }
    },
  }
}
