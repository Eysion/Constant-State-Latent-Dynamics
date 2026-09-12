# Compositional Discrete Memory

## Research question

Can a streaming system retain useful knowledge as a bounded collection of discrete, reusable fragments and relations, rather than as a single continuous summary or a complete history buffer?

This is a separate research direction from the constant-state dynamics paper. The existing model provides a possible stable substrate; it does not implement or validate the memory hypothesis described here.

## Working hypothesis

Human recollection appears to preserve combinations: phrases, motifs, scenes, transitions, and salient relations. A fragment has little value in isolation; its activation depends on context, order, repetition, affect, and links to other fragments. Recall is therefore treated as cue-driven reconstruction:

```text
partial cue -> activate fragment cluster -> follow relations -> reconstruct combination
```

The proposed memory object is:

```text
M = (C, R, A, P)
```

where `C` is a set of discrete fragments, `R` is a relation graph, `A` is the activation policy, and `P` is the transition/completion rule. Continuous vectors may support perception or similarity, but they are not the memory unit itself.

## Relation to this repository

The current constant-state model tests bounded continuous state and online prediction. This topic would add a separate layer:

- continuous dynamics for input encoding and stability;
- discrete fragments for reusable memory units;
- relations for order, causality, similarity, and co-occurrence;
- cue-driven activation and partial completion;
- salience and repetition for consolidation or forgetting.

No claim is made that this is equivalent to biological memory or that labels alone reproduce human recall.

## Falsifiable experiments

1. **Delayed fragment recall**: learn a fragment once, insert distractors, and test cue-based reconstruction.
2. **Composition transfer**: recombine known fragments in a novel order and measure whether the system preserves valid relations.
3. **Interference**: introduce similar fragments and measure selective retrieval and catastrophic overwriting.
4. **Compression**: compare explicit fragment storage with a continuous summary under the same memory budget.
5. **Salience and repetition**: vary repetition and structural boundaries, then measure retention and forgetting curves.

The primary metrics should be exact fragment recovery, relation accuracy, composition validity, memory footprint, retrieval latency, and performance under distractors. Mean squared error alone is not sufficient.

## Scope boundary

This document is a research proposal, not an implemented result. It does not claim theorem proving, general symbolic reasoning, or a neuroscientifically faithful brain model. Any future implementation should report failures and compare against sequence models and explicit symbolic baselines under matched memory budgets.

## Research outline

The presemantic input and resource-allocation layer is developed separately in [Perceptual Governance Node](perceptual-governance-node.md). This document should be read as the memory and composition track after governance, not as a specification of prompt parsing.

### 1. Problem definition

- Define a memory unit as a reusable event fragment, not an isolated token or a full-sequence summary.
- Define a composition as an ordered, contextual, or causal arrangement of fragments.
- State the resource constraint: bounded active memory, bounded write rate, and bounded retrieval work.

### 2. Biological motivation

- Treat reflex and sensory pathways as pre-cortical signal transformation, not raw input transport.
- Treat hippocampal circuitry as fast binding, indexing, and pattern completion.
- Treat cortical systems as slower abstraction and consolidation mechanisms.
- Treat brainstem, basal forebrain, thalamic, hypothalamic, and prefrontal systems as distributed state and retrieval schedulers.
- Treat individual learning bias as a persistent modulation of encoding, retrieval, and action selection, not as output temperature.

### 3. Formal system

Specify the state as:

```text
S_t = (W_t, C_t, R_t, Q_t, Phi_t, B_t)
```

where `W` is the active working set, `C` the discrete fragment collection, `R` the relation graph, `Q` the scheduler state, `Phi` the individual bias, and `B` the resource budget. Define transitions for sensing, reflex modulation, write, retrieve, compose, consolidate, and forget.

### 4. Scheduler design

- `write_scheduler`: decide whether an event is novel or salient enough to store.
- `retrieval_scheduler`: select fragments from partial cues and current goals.
- `composition_scheduler`: choose compatible orderings and relation paths.
- `consolidation_scheduler`: replay repeated or high-value combinations into slower memory.
- `forgetting_scheduler`: decay, merge, or evict low-value fragments.
- `state_scheduler`: adapt exploration and action policy from uncertainty, body state, and `Phi`.

### 5. Individual bias

Model `Phi` as a slowly changing prior over modalities, structures, risk, repetition, and abstraction. Separate the stable component from short-term state so that personality-like behavior is an emergent long-horizon property, not a random output perturbation.

### 6. Minimal implementation

Start with a symbolic benchmark before adding continuous encoders:

1. Detect fragment boundaries in a discrete stream.
2. Store fragments and typed relations under a fixed budget.
3. Retrieve from partial cues.
4. Recompose familiar fragments in unseen combinations.
5. Add a small continuous front-end only where sensory noise requires it.

### 7. Evaluation and falsification

Compare against persistence, n-gram/Markov memory, nearest-neighbor retrieval, a continuous fixed-state model, and a parameter-matched recurrent baseline. Report exact recovery, relation accuracy, composition validity, interference, forgetting curves, memory bytes, write count, and retrieval latency across multiple seeds. A failure to beat simple symbolic baselines on held-out compositions should narrow or reject the hypothesis.

### 8. Claims policy

The first paper should claim only an explicit, bounded, cue-driven composition mechanism if the experiments support it. Biological similarity, personality, consciousness, and general reasoning remain interpretation layers and require separate evidence.
