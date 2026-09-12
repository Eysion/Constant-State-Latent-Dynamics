import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('experiment emits reproducible metrics for a short stream', () => {
  const output = execFileSync(process.execPath, ['src/experiment.mjs', '2000'], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.baseline.steps, 2000);
  assert.equal(result.o1Len.dim, 8);
  assert.ok(Number.isFinite(result.o1Len.meanSquaredError));
  assert.ok(Number.isFinite(result.o1Len.heapDeltaBytes));
});
