# Constant-State Latent Dynamics

This repository provides a small, reproducible study of streaming latent-state updates. The implementation is written in TypeScript, bundled for Node.js with Rsbuild, and keeps a fixed-dimensional working state while applying a potential-based correction under bounded perturbations. The code is a research baseline, not a production language model or a proof of constant total process memory.

## Research question

Can a streaming system limit active state storage independently of sequence length while keeping latent dynamics bounded? The claim is deliberately narrow: if the latent dimension `d` is fixed and no history or output buffer is retained, active state storage is `O(d) = O(1)` in stream length. Runtime overhead, parameters, inputs, outputs, and logging remain outside this claim.

## Update rule

For latent state `h_t` and current context `c_t`:

```text
h_(t+1) = h_t + eta [g_theta(h_t, c_t) - gamma grad V(h_t)] + xi_t
```

Here `eta` is the step size, `gamma` controls correction strength, and `xi_t` is bounded perturbation. If `g_theta(., c)` is `L_g`-Lipschitz and `V` is `alpha`-strongly convex in the operating region, `gamma alpha > L_g` is a sufficient local condition for bounded error, subject to a sufficiently small discrete step. This condition does not imply task accuracy.

## Reproduce

Requires Node.js 20 or newer.

```bash
npm test
npm run experiment -- 128000
npm run train -- 20000
npm run dev:web
```

The experiment uses an 8-dimensional sinusoidal stream with deterministic perturbations. It compares an uncorrected update with a radial correction and emits JSON containing mean squared tracking error, maximum state norm, elapsed time, and V8 heap delta. Heap deltas are diagnostic only; garbage collection makes single-process readings unsuitable for publication-grade memory measurements.

`npm run train` runs the learnable minimal model: a fixed-dimensional latent state, linear input projection, stable linear dynamics, quadratic correction, and online-trained linear readout. It predicts the next value of a generated sinusoid without retaining the sample history.

## Scope and limitations

The repository does not train slow or fast weights, encode text or video, implement a JEPA or Transformer baseline, or evaluate industrial diagnostic data. A stronger evaluation requires public data and preprocessing, matched baselines, fixed hardware and precision, repeated seeds with uncertainty intervals, profiler traces, online-output accounting, and parameter ablations.

## Files

- `src/experiment.ts` - deterministic state-scaling experiment.
- `src/experiment.ts` - deterministic state-scaling experiment.
- `src/model.ts` - fixed-state streaming predictor.
- `src/train.ts` - online training entry point.
- `rsbuild.config.mjs` - Node.js bundle configuration.
- `rsbuild.web.mjs` - React web bundle configuration.
- `src/web/` - training and model-testing interface.
- `test/experiment.test.mjs` - executable smoke test.
- `paper.md` - expanded technical note.

## License

PolyForm Noncommercial License 1.0.0. Commercial use is not permitted. This is a source-available non-commercial license, not an OSI-approved open-source license. See [LICENSE](LICENSE).
