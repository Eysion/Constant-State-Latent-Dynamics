import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("experiment emits reproducible metrics for a short stream", () => {
  const result = JSON.parse(
    execFileSync(process.execPath, ["dist/experiment.cjs", "2000"], {
      encoding: "utf8",
    }),
  );
  assert.equal(result.dataset.total, 2000);
  assert.equal(result.dataset.train + result.dataset.validation + result.dataset.test, 2000);
  assert.ok(Number.isFinite(result.constantState.test.meanSquaredError));
  assert.ok(Number.isFinite(result.baselines.persistence.meanSquaredError));
});

test("online model emits finite metrics with fixed latent state", () => {
  const result = JSON.parse(
    execFileSync(process.execPath, ["dist/train.cjs", "1000"], {
      encoding: "utf8",
    }),
  );
  assert.equal(result.latentDim, 8);
  assert.ok(Number.isFinite(result.meanSquaredError));
  assert.ok(result.maxStateNorm < 2);
});

test("discrete benchmark reports bounded task metrics", () => {
  const result = JSON.parse(execFileSync(process.execPath, ["dist/discrete.cjs", "300"], { encoding: "utf8" }));
  assert.equal(result.tasks.length, 3);
  for (const task of result.tasks) {
    assert.ok(task.exactMatchAccuracy >= 0 && task.exactMatchAccuracy <= 1);
    assert.ok(Number.isFinite(task.meanSquaredError));
    assert.ok(task.maxStateNorm < 2);
  }
});
