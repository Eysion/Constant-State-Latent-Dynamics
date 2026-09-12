<!-- local-ai-workflow:start -->
## Local AI Workflow

This repository uses the local state machine in `tooling/ai-workflow/`. Before starting work, inspect the current run:

```bash
node tooling/ai-workflow/cli/workflow.mjs status
```

For fast context discovery, run `index` and then `search`. The lexical index only narrows candidates; always verify results with `rg` and source review. Rebuild the index when results are marked `stale`.

When no reusable Run exists, use `start` with the request and at least one exact `--changed-file` path. Add `--commit` only when the user explicitly authorizes a local commit. Runtime state belongs in `.workflow/state/` and must remain ignored by Git.

- Project: `constant-state-latent-dynamics`
- Detected stacks: `Node.js, React`
- Detection manifests: `package.json`
- Default verification: `npm run test`

Detection initializes the base configuration only. Business rules, architecture boundaries, and sensitive contracts come from the rest of this file and the repository source. Update `.workflow/config.yaml` when the repository changes.

### Planning gate

Every task completes `context-review` before `planning`; OpenSpec is required only for contract signals. Use `tooling/ai-workflow/templates/planning/context-review-evidence.json` to record reviewed repository guidance, at least one source reference with a line and purpose, and the exact test/lint/build/check verification command. The mode comes from boolean signals in `.workflow/config.yaml`; do not use scores or weights, and do not silently downgrade a recorded mode.

The Run context records `planningMode` and `executionMode`; later nodes must follow those recorded decisions.

- `inline`: a clear, small change; record goal, owned paths, steps, acceptance, and verification with `inline-plan.json`.
- `structured`: multi-step, multi-component, recoverable, or long work; use `structured-plan.json`.
- `openspec`: cross-repository work or API, data, authentication, security, public-behavior, or long-term contract changes; complete `openspec-contract` first and write the proposal under `openspec/changes/<task-id>/`.

The `intake`, `context-review`, `planning`, `implementation`, and `atomic-commit-plan` nodes require their JSON evidence templates. `request` and `ownedPaths` must match the Run exactly. Planning must include implementation steps and an actionable verification command; implementation must cover every non-generated owned path and record an actionable verification scope. Run creation records Git identity, HEAD, and the workspace snapshot; configured remote patterns must match exactly.

`--changed-file` must be repository-relative, cannot escape the repository, and cannot name an existing symbolic link. Verification fingerprints controlled paths; later changes invalidate that evidence. A skipped verification never authorizes a local commit.

### Bounded Loop Engineering

Unattended work requires an eligibility check for exact scope, automated verification, and risk signals. The host Agent writes code and reviews results; the state machine controls order, budget, evidence, and stop conditions. It never authorizes commit, push, release, or production writes by itself.

Long work alone does not trigger a loop. A loop requires `LOOP_REQUESTED`, `ITERATIVE_ACCEPTANCE`, or `EXPECTED_MULTIPLE_ITERATIONS`, an automated verification command, and no unclear-requirement, external-side-effect, or sensitive-operation signal. The default limit is six rounds, two consecutive no-progress rounds, and 60 minutes. Record final evidence with `loop-checkpoint.json`.

### Quality gate

Initialization creates a `qualityPolicy` from detected verification capabilities. High-risk or negative-feedback signals add `quality-assessment`, which requires independent candidates and evidence from retrieval, source review, verification, or independent review. A result below the configured threshold cannot be marked successful.

Run Shadow Mode before committing. Only `workflow commit --yes` may stage and create a local commit. This workflow never pushes, opens pull requests, or publishes releases.
<!-- local-ai-workflow:end -->
