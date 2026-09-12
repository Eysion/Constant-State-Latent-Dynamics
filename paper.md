# Constant-State Latent Dynamics: A Bounded Streaming State Formulation

## Abstract

This technical note studies a deterministic streaming update with a fixed-dimensional latent state. The method combines a context-conditioned vector field with a potential-based correction. We state the memory claim at the level it can support, derive a local boundedness condition under Lipschitz and strong-convexity assumptions, and provide a deterministic Node.js experiment. The result concerns active state allocation and synthetic drift; it does not establish task-level accuracy or constant total process memory.

## 1. Problem formulation

Let `h_t in R^d` denote the recurrent working state and `c_t` the context observed at step `t`. The implementation retains `h_t` and fixed parameters, but no sequence of previous states:

```text
h_(t+1) = h_t + eta [g_theta(h_t, c_t) - gamma grad V(h_t)] + xi_t
```

The dimension `d` is independent of stream length `T`. Under this storage policy, active state allocation is `O(d) = O(1)` with respect to `T`. This statement excludes parameter memory, the current input, output retention, allocator behavior, runtime stacks, and external logging. A streaming interface must consume or externalize outputs; retaining all outputs changes the memory bound.

## 2. Stability condition

Assume that `g_theta(., c)` is `L_g`-Lipschitz for each admissible context, `V` is `alpha`-strongly convex in the operating region, and the perturbation satisfies `||xi_t|| <= xi_max`. Let `h*_t` follow the same context sequence without perturbation and define `e_t = h_t - h*_t`. For `L_t = ||e_t||^2 / 2`, a first-order discrete analysis gives

```text
Delta L_t <= -eta (gamma alpha - L_g) ||e_t||^2
             + eta xi_max ||e_t|| + O(eta^2).
```

Consequently, `gamma alpha > L_g` is a sufficient local condition for contraction outside a perturbation-dependent neighborhood, provided `eta` is small enough for the discretization remainder. The resulting radius scales with `xi_max / (gamma alpha - L_g)` and the step-size error. This is a conditional boundedness statement, not a guarantee of faithful prediction.

## 3. Reproducible experiment

The Node.js implementation uses an 8-dimensional sinusoidal target and deterministic bounded perturbations. It compares the uncorrected update (`gamma = 0`) with a radial potential correction. The program retains one `Float64Array` state and reports:

- mean squared tracking error;
- maximum state norm;
- elapsed time; and
- the observed change in V8 heap usage.

The evaluation now uses a deterministic autoregressive stream with a fixed seed and chronological 60/20/20 train/validation/test partitions. The constant-state model is fit only on the training partition; validation and test use a forecast path that does not update readout parameters. Two task baselines are reported: persistence (`y_hat_t = x_t`) and an online one-lag linear model. State norm and task error are reported separately.

Run:

```bash
npm test
npm run experiment -- 128000
```

The test suite checks split accounting, finite metrics, and fixed-state bounds. Heap readings are diagnostic: garbage collection and runtime allocation make a single-process delta insufficient for a systems-memory claim. Baseline comparisons establish only whether this implementation predicts this synthetic stream better than simple alternatives; they do not establish general superiority.

## 4. Evidence and confidence

Current confidence is **moderate for the implementation claim** (fixed active latent state with no history buffer) and **low for the modeling claim** (useful long-context representation). In the 2,000-step seeded run, persistence reached test MSE `0.00105`, while the constant-state model reached `0.22561` (about 215x worse); this is a clear negative result for predictive quality under the current parameterization, not evidence of superiority. The implementation claim is directly inspectable and covered by executable tests. The modeling claim is supported only on one synthetic process and one latent dimension, with no multiple-seed intervals, public benchmark, tuned baselines, or statistical significance test. A future result should report repeated seeds, confidence intervals, parameter-matched GRU/AR baselines, and ablations over dimension, step size, correction strength, and context shift.

## 5. Limitations

The study does not train a representation, model text or video, compare against an implemented JEPA or Transformer, or use industrial data. It does not test context shifts, adversarial perturbations, non-convex potentials, or hardware-specific memory behavior. The method therefore remains a controlled streaming-state hypothesis.

## 6. Required extensions

A stronger empirical claim requires a public dataset and preprocessing pipeline, parameter-matched baselines, fixed hardware and numerical precision, repeated seeds with confidence intervals, an explicit profiler protocol, online-output accounting, and ablations over `eta`, `gamma`, latent dimension, and potential family. Task metrics should be reported separately from state-norm stability and memory measurements.

## 7. Conclusion

A fixed-dimensional recurrent state can be implemented without a history buffer, and a potential term can limit state-norm excursions in a synthetic stream. Whether the resulting representation is expressive enough for long-context applications remains an empirical question.

## 8. Discrete-mathematics probe

To test suitability for discrete structure, `src/discrete.ts` evaluates parity, modulo-5, and a three-state finite-cycle rule using chronological splits. Targets are normalized during optimization and scored by mean squared error and rounded exact-match accuracy. These tasks test finite-rule transition behavior only; they are not tests of theorem proving, proof search, or symbolic reasoning. Results should therefore be treated as a diagnostic of representation bias, not evidence for mathematical competence.
