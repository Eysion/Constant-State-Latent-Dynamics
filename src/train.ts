import { ConstantStateModel } from './model.js';

const steps = Number(process.argv[2] ?? 20_000);
if (!Number.isInteger(steps) || steps < 1) throw new Error('steps must be a positive integer');
const model = new ConstantStateModel();
let loss = 0;
let maxStateNorm = 0;
for (let t = 0; t < steps; t += 1) {
  const result = model.step(Math.sin(t * 0.02), Math.sin((t + 1) * 0.02));
  loss += result.squaredError;
  maxStateNorm = Math.max(maxStateNorm, model.stateNorm());
}
console.log(JSON.stringify({ protocol: 'online one-step prediction; fixed latent state; no sample history', steps, latentDim: model.dim, meanSquaredError: loss / steps, maxStateNorm, finalPrediction: model.predict() }, null, 2));
