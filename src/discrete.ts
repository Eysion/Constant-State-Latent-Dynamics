import { ConstantStateModel } from "./model.js";

type Sample = { input: number; target: number };
type Task = { name: string; alphabet: number; make: (i: number) => Sample };

const tasks: Task[] = [
  { name: "parity", alphabet: 2, make: (i) => ({ input: (i % 16) / 15, target: i % 2 }) },
  { name: "modulo-5", alphabet: 5, make: (i) => ({ input: (i % 20) / 19, target: (i + 2) % 5 }) },
  { name: "finite-state-cycle", alphabet: 3, make: (i) => ({ input: i % 3, target: (i * 2 + 1) % 3 }) },
];
const steps = Number(process.argv[2] ?? 3000);
if (!Number.isInteger(steps) || steps < 100) throw new Error("steps must be an integer >= 100");

function run(task: Task) {
  const split = Math.floor(steps * 0.7); const model = new ConstantStateModel();
  for (let i = 0; i < split; i += 1) { const s = task.make(i); model.step(s.input, s.target / Math.max(1, task.alphabet - 1)); }
  let squaredError = 0; let exact = 0;
  for (let i = split; i < steps; i += 1) {
    const s = task.make(i); const prediction = model.forecast(s.input); const target = s.target / Math.max(1, task.alphabet - 1);
    squaredError += (prediction - target) ** 2;
    const predictedClass = Math.max(0, Math.min(task.alphabet - 1, Math.round(prediction * (task.alphabet - 1))));
    if (predictedClass === s.target) exact += 1;
  }
  const count = steps - split;
  return { task: task.name, train: split, test: count, meanSquaredError: squaredError / count, exactMatchAccuracy: exact / count, maxStateNorm: model.stateNorm(), latentDim: model.dim };
}

console.log(JSON.stringify({ protocol: "deterministic discrete rule streams; chronological split; rounded exact-match metric", steps, tasks: tasks.map(run), interpretation: "This probes finite-rule memorization/transition behavior, not theorem proving or symbolic reasoning." }, null, 2));
