import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('experiment emits reproducible metrics for a short stream', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['dist/experiment.cjs', '2000'], { encoding: 'utf8' }));
  assert.equal(result.baseline.steps, 2000);
  assert.equal(result.o1Len.dim, 8);
  assert.ok(Number.isFinite(result.o1Len.meanSquaredError));
});

test('online model emits finite metrics with fixed latent state', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['dist/train.cjs', '1000'], { encoding: 'utf8' }));
  assert.equal(result.latentDim, 8);
  assert.ok(Number.isFinite(result.meanSquaredError));
  assert.ok(result.maxStateNorm < 2);
});
