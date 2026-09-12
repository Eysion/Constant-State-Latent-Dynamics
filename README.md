# Constant-State Latent Dynamics

**Reproducibility-oriented paper and Node.js MVP**

This repository studies a narrow claim: a deterministic streaming update can keep a fixed-dimensional latent working state and apply a potential-based correction under bounded perturbations. It does not establish production LLM quality, JEPA parity, hardware-level O(1) memory, or the original manuscript's 128K benchmark table.

## Abstract

Long-context systems often retain a history-dependent runtime state. We study a deterministic streaming alternative that keeps only a fixed-dimensional latent vector and applies a potential-based correction when its norm leaves a prescribed region. We define the state-memory claim precisely, derive a practical boundedness condition under Lipschitz dynamics and bounded perturbations, and provide a deterministic Node.js experiment. The experiment is a sanity check for state allocation and drift behavior, not evidence of language-model quality or constant total process memory.

## Defect analysis of the original manuscript

The source manuscript's hypotheses are useful, but its evidence did not support its strongest claims:

- O(1) was used ambiguously. Fixed active state storage is O(d) in stream length only when no history, output buffer, or unbounded log is retained; total process memory need not be constant.
- Exact memory and accuracy values had no dataset, task, model, hardware, precision, batch size, allocator, seed, or uncertainty protocol, so they are not reported as measurements here.
- The JEPA and Transformer baselines were undefined and not parameter- or protocol-matched.
- The stability theorem omitted context dependence, ideal-trajectory definitions, discrete-step conditions, and the distinction between global and local strong convexity.
- The algorithm stored `H={h_1,...,h_T}`, contradicting a streaming memory claim unless outputs are externalized.

## Model and boundedness condition

Let `h_t in R^d` be the only recurrent working state and `c_t` the current input:

```text
h_(t+1) = h_t + eta [g_theta(h_t, c_t) - gamma grad V(h_t)] + xi_t
```

Parameters are fixed during inference, `||xi_t|| <= xi_max`, and `d` is fixed. Therefore active state storage is O(d)=O(1) in stream length `T`, conditional on the implementation retaining no history. If `g_theta(., c)` is `L_g`-Lipschitz and `V` is `alpha`-strongly convex in the operating region, a sufficient local stability condition is `gamma alpha > L_g` with a sufficiently small step size. The perturbation-dependent invariant radius is proportional to `xi_max/(gamma alpha-L_g)` plus discretization error. This is not a task-accuracy theorem.

## Reproducible experiment

The Node.js program uses an 8-dimensional sinusoidal target stream and deterministic bounded perturbations. It compares an uncorrected update with a radial potential correction and reports mean squared tracking error, maximum state norm, elapsed time, and V8 heap delta. No history array is allocated; only a fixed `Float64Array` is retained.

```bash
npm test
npm run experiment -- 128000
```

The output is JSON. Heap deltas are diagnostic only because garbage collection and the JavaScript runtime make one-process readings unsuitable as publication-grade memory benchmarks.

## Limitations and next experiments

This MVP does not train slow or fast weights, encode text/video, compare against a real JEPA or Transformer, or use industrial data. A full study needs a public dataset, preprocessing, parameter-matched baselines, fixed hardware and precision, repeated seeds with confidence intervals, profiler traces, online-output accounting, and ablations over `gamma`, `eta`, latent dimension, and potential choice.

## Repository

- `src/experiment.mjs` - deterministic experiment implementation.
- `test/experiment.test.mjs` - executable smoke test.
- `paper.md` - source manuscript copy for offline reading.

## License and contributions

Released under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/). See [LICENSE](LICENSE). Commercial use is not permitted. This is a source-available non-commercial license, not an OSI-approved open-source license. Contributions should preserve reproducibility, document assumptions, and avoid presenting synthetic results as evidence for production systems; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Citation

```bibtex
@software{constant_state_latent_dynamics,
  title  = {Constant-State Latent Dynamics},
  author = {Anonymous Authors},
  year   = {2026},
  url    = {https://github.com/Eysion/Constant-State-Latent-Dynamics}
}
```
