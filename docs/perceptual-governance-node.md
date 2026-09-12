# Perceptual Governance Node: A Presemantic Control Layer for Text Interaction

## Abstract

Most text systems convert a user prompt into tokens before deciding how the input should be interpreted or processed. This paper proposes a preceding control layer, the **Perceptual Governance Node (PGN)**. The PGN preserves the raw prompt, creates multiple temporal slices, applies a persistent subject-specific bias, activates local reflex units, and allocates downstream memory, retrieval, reasoning, and action budgets. It does not generate an answer and is not a replacement tokenizer. Its purpose is to make input interpretation, resource allocation, and state-dependent modulation explicit and testable.

## 1. Motivation

A typed prompt is a convenient user interface, but it is not a neutral mathematical object. Before a biological system forms a stable interpretation, incoming signals are filtered by adaptation, salience, bodily state, prior experience, and fast protective responses. Conventional text models largely omit this presemantic governance step. They begin with a fixed segmentation and then apply a common sequence computation.

The proposal is deliberately narrow: retain the text interface while changing the internal order of operations.

```text
raw prompt -> governance -> temporal slices -> reflex units -> downstream processing
```

## 2. System definition

Let `x` be the raw prompt, `b` the current internal state, and `phi` a slowly changing individual bias. The PGN produces a set of time- and structure-dependent events:

```text
E = G(x, b, phi)
```

Each event contains its source span, temporal level, salience, novelty, confidence, and recommended resource allocation. The raw prompt remains addressable; derived events are not substitutes for it.

### 2.1 Temporal slices

The same prompt is inspected at several response horizons:

- **fast**: abrupt markers, negation, commands, risk, and novelty;
- **middle**: phrases, local intent, and compositional structure;
- **slow**: session theme, persistent goals, and long-range context.

The slices are not character or token windows. They are competing hypotheses about what deserves processing time.

### 2.2 Scent envelope

The term “scent” is used as a computational metaphor for subject-specific modulation. An envelope can include modality preference, memory affinity, uncertainty sensitivity, and risk bias. It is a persistent prior over processing, not output randomness and not a temperature parameter.

### 2.3 Reflex units

Reflex units are local detectors with bounded scope. Examples include command, question, novelty, conflict, risk, memory-cue, and emotion-salience units. They return activations, confidence, supporting spans, and inhibition candidates. They do not need to inspect the full prompt or share a single global representation.

### 2.4 Governance and dispatch

The PGN combines reflex results through competition, inhibition, and agreement across temporal levels. It emits a dispatch plan:

```text
D = { reflex, memory, retrieval, reasoning, action budgets }
```

The plan determines which downstream operations are permitted and how much work they may consume. It does not decide the final answer.

## 3. Relation to existing language systems

The PGN is not a tokenizer, embedding layer, attention block, router, or sampler. Those components may be used downstream. The distinction is causal and architectural:

```text
conventional: prompt -> tokens -> shared representation -> generation
PGN:          prompt -> state-dependent events -> governed allocation -> processing
```

A tokenizer answers “how can this input be segmented?” The PGN asks “what kind of event is this for this subject, at this moment, and what processing should it trigger?”

## 4. Minimal implementation

A first implementation can remain entirely symbolic:

1. Preserve the raw prompt and source spans.
2. Produce fast, middle, and slow event candidates.
3. Apply a configurable `BiasProfile` to gain, novelty, and risk.
4. Run local reflex units over relevant spans.
5. Resolve conflicts and emit a dispatch plan.
6. Log decisions without retaining an unbounded prompt history.

The prototype should stop at dispatch. Answer generation is intentionally outside the first experiment.

## 5. Evaluation

The first experiments should test the governance mechanism itself:

- detection latency for commands, questions, and risk markers;
- adaptation to repeated prompts;
- salience amplification for abrupt changes;
- consistency of source-span attribution;
- sensitivity to bias-profile changes;
- agreement and conflict across temporal slices;
- resource savings or reallocation under a fixed compute budget.

Baselines should include a static tokenizer pipeline, a rule-only classifier, and a conventional language-model front end. Evaluation must report false positives, false negatives, latency, memory use, and the effect of governance decisions on downstream task quality.

## 6. Claims and limitations

This proposal claims only that a presemantic, state-dependent governance layer can be specified as an explicit computational object. It does not claim to reproduce biological receptors, consciousness, personality, or human memory. “Scent” is an engineering metaphor for persistent modulation and must be operationalized through measurable parameters.

## 7. Open questions

- How should temporal slices be learned without collapsing into token windows?
- Which reflex units should be local, and which require cross-modal context?
- How can a bias profile adapt without becoming an unbounded parameter store?
- When should governance inhibit generation rather than request more evidence?
- Does explicit governance improve robustness enough to justify its latency and complexity?

## 8. Relation to the compositional-memory program

This paper is the governance layer referred to in [Compositional Discrete Memory](compositional-discrete-memory.md). The memory paper studies reusable fragments and relations; this paper studies how a typed prompt becomes a state-dependent event stream before memory or reasoning is invoked.
