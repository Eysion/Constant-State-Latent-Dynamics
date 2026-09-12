#!/usr/bin/env node

import { performance } from 'node:perf_hooks';

const steps = Number(process.argv[2] ?? 128_000);
const dim = 8;
const gamma = 0.18;
const driftNoise = 0.012;

function target(t, i) {
  return Math.sin(t * 0.002 + i * 0.7);
}

function run({ corrected }) {
  const state = new Float64Array(dim);
  let squaredError = 0;
  let maxNorm = 0;
  const start = performance.now();
  const heapBefore = process.memoryUsage().heapUsed;

  for (let t = 0; t < steps; t += 1) {
    let norm = 0;
    for (let i = 0; i < dim; i += 1) {
      const desired = target(t, i);
      const update = 0.015 * (desired - state[i]) + driftNoise * Math.sin(t * 0.17 + i);
      state[i] += update;
      norm += state[i] * state[i];
    }
    if (corrected) {
      const radius = Math.sqrt(norm);
      if (radius > 1) {
        const scale = 1 - gamma * (radius - 1) / radius;
        for (let i = 0; i < dim; i += 1) state[i] *= scale;
      }
    }
    let error = 0;
    for (let i = 0; i < dim; i += 1) error += (state[i] - target(t, i)) ** 2;
    squaredError += error / dim;
    maxNorm = Math.max(maxNorm, Math.sqrt(norm));
  }

  const heapAfter = process.memoryUsage().heapUsed;
  return {
    corrected,
    steps,
    dim,
    meanSquaredError: squaredError / steps,
    maxStateNorm: maxNorm,
    heapDeltaBytes: heapAfter - heapBefore,
    elapsedMs: performance.now() - start
  };
}

if (!Number.isInteger(steps) || steps < 1) throw new Error('steps must be a positive integer');
console.log(JSON.stringify({
  protocol: 'synthetic sinusoidal stream; one Float64Array state; no history buffer',
  baseline: run({ corrected: false }),
  o1Len: run({ corrected: true })
}, null, 2));
