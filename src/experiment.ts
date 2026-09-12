import { performance } from "node:perf_hooks";
import { ConstantStateModel } from "./model.js";

const steps = Number(process.argv[2] ?? 12_000);
if (!Number.isInteger(steps) || steps < 30) throw new Error("steps must be an integer >= 30");
type Sample = { input: number; target: number };
function stream(length: number, seed = 7): Sample[] {
  let state = seed >>> 0; let previous = 0;
  const values = Array.from({ length }, (_, t) => { state = (1664525 * state + 1013904223) >>> 0; const noise = ((state / 2 ** 32) - 0.5) * 0.08; const value = 0.72 * previous + 0.22 * Math.sin(t * 0.035) + noise; previous = value; return value; });
  return values.map((input, i) => ({ input, target: values[i + 1] ?? input }));
}
function mse(values: number[]): number { return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length); }
function evaluate(data: Sample[], predictor: (sample: Sample) => number) { return { meanSquaredError: mse(data.map((sample) => (predictor(sample) - sample.target) ** 2)), count: data.length }; }
const data = stream(steps); const trainEnd = Math.floor(steps * 0.6); const validationEnd = Math.floor(steps * 0.8);
const train = data.slice(0, trainEnd); const validation = data.slice(trainEnd, validationEnd); const test = data.slice(validationEnd);
const persistence = evaluate(test, (sample) => sample.input);
let arWeight = 0; let arBias = 0;
for (const sample of train) { const error = arBias + arWeight * sample.input - sample.target; arWeight -= 0.03 * error * sample.input; arBias -= 0.03 * error; }
const linearAr = evaluate(test, (sample) => arBias + arWeight * sample.input);
const model = new ConstantStateModel(); for (const sample of train) model.step(sample.input, sample.target);
const validationMetrics = evaluate(validation, (sample) => model.forecast(sample.input));
const stateNorms: number[] = []; const start = performance.now(); const heapBefore = process.memoryUsage().heapUsed;
const predictions = evaluate(test, (sample) => { const prediction = model.forecast(sample.input); stateNorms.push(model.stateNorm()); return prediction; });
const bestBaseline = Math.min(persistence.meanSquaredError, linearAr.meanSquaredError);
console.log(JSON.stringify({ protocol: "deterministic autoregressive stream; chronological train/validation/test split; no history buffer", dataset: { total: steps, train: train.length, validation: validation.length, test: test.length, seed: 7 }, baselines: { persistence, linearAr }, constantState: { validation: validationMetrics, test: predictions, latentDim: model.dim, maxStateNorm: Math.max(...stateNorms) }, comparison: { bestBaselineTestMse: bestBaseline, constantStateToBestBaselineMseRatio: predictions.meanSquaredError / bestBaseline }, resources: { elapsedMs: performance.now() - start, heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore, memoryNote: "diagnostic V8 heap delta; not total process memory" } }, null, 2));
