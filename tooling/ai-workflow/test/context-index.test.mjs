import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildContextIndex, searchContextIndex } from '../src/context-index.mjs'

test('builds a deterministic lexical index and reports stale retrievals', async (t) => {
  const repository = await mkdtemp(path.join(os.tmpdir(), 'workflow-context-index-'))
  t.after(() => rm(repository, { recursive: true, force: true }))
  const state = path.join(repository, '.workflow', 'state')
  await writeFile(path.join(repository, 'service.mjs'), 'export function settlePayment() { return paymentToken }\n')
  await writeFile(path.join(repository, 'notes.md'), '# Payment flow\nToken is required.\n')
  await writeFile(path.join(repository, 'ignored.txt'), 'paymentToken')
  const built = await buildContextIndex({ repositoryDirectory: repository, stateDirectory: state })
  assert.equal(built.documents, 2)
  const fresh = await searchContextIndex({ repositoryDirectory: repository, stateDirectory: state, query: 'payment token' })
  assert.equal(fresh.ok, true)
  assert.deepEqual(fresh.results[0], {
    path: 'service.mjs', line: 1, content: 'export function settlePayment() { return paymentToken }', matchedTerms: ['payment', 'token'], score: 20, stale: false,
  })
  await writeFile(path.join(repository, 'notes.md'), '# Changed\n')
  const stale = await searchContextIndex({ repositoryDirectory: repository, stateDirectory: state, query: 'payment' })
  assert.equal(stale.results.some((item) => item.path === 'notes.md' && item.stale), true)
})

test('requires an existing index and a meaningful query', async (t) => {
  const repository = await mkdtemp(path.join(os.tmpdir(), 'workflow-context-index-empty-'))
  t.after(() => rm(repository, { recursive: true, force: true }))
  const state = path.join(repository, '.workflow', 'state')
  assert.equal((await searchContextIndex({ repositoryDirectory: repository, stateDirectory: state, query: 'x' })).error.code, 'CONTEXT_INDEX_NOT_FOUND')
  await buildContextIndex({ repositoryDirectory: repository, stateDirectory: state })
  assert.equal((await searchContextIndex({ repositoryDirectory: repository, stateDirectory: state })).error.code, 'EMPTY_CONTEXT_QUERY')
  assert.equal((await searchContextIndex({ repositoryDirectory: repository, stateDirectory: state, query: '...' })).error.code, 'EMPTY_CONTEXT_QUERY')
  assert.equal((await searchContextIndex({ repositoryDirectory: repository, stateDirectory: state, query: 'x', limit: 0 })).error.code, 'CONTEXT_SEARCH_LIMIT_INVALID')
})
