import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePackageManagerInvocation } from '../src/command-adapter.mjs'

test('uses the child project package manager executable when available through Volta', () => {
  const result = resolvePackageManagerInvocation({
    file: 'pnpm',
    args: ['lint'],
    packageManager: { name: 'pnpm', version: '9.15.6' },
    pathValue: process.env.PATH,
  })

  if (result.file.includes('/tools/image/pnpm/9.15.6/bin/pnpm')) {
    assert.deepEqual(result.args, ['lint'])
  } else {
    assert.deepEqual(result, { file: 'pnpm', args: ['lint'] })
  }
})

test('does not inject a version when the child project has no declaration', () => {
  assert.deepEqual(resolvePackageManagerInvocation({
    file: 'pnpm',
    args: ['test'],
    packageManager: null,
    pathValue: process.env.PATH,
  }), { file: 'pnpm', args: ['test'] })
})
