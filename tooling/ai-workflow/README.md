# Local AI Workflow

Local, evidence-driven workflow orchestration for AI-assisted software development.

It gives an AI coding session a small, recoverable state machine for planning, implementation, verification, and optional local commits. It does not push branches, open pull requests, publish releases, or write to production systems.

> Non-commercial use only. See [LICENSE](./LICENSE).

## Usage

The normal workflow is AI-driven. Install it into your repository, open the repository in an AI coding agent (for example Claude Code or another agent that reads `AGENTS.md`), and describe the task in natural language. The generated `AGENTS.md` and optional Claude hooks tell the agent when to inspect status, create a Run, collect evidence, and verify changes.

```bash
./install.sh /absolute/path/to/your-repository --apply
cd /absolute/path/to/your-repository
# Start your AI coding agent here and describe the task.
```

The underlying CLI can also be called directly for scripting, debugging, or agents that do not load repository instructions:

```bash
workflow start \
  --task-id example-task \
  --request "update the login page" \
  --changed-file src/pages/LoginPage.vue

workflow status
workflow explain
workflow timeline
```

`start` creates a local Run. The workflow then guides the task through planning, implementation, verification, and (when explicitly requested) a local commit. Developers normally only need to prompt the AI agent; direct CLI commands are an advanced interface. Use `workflow --help` for context indexing, sediment, shadow mode, and resume commands.

## Requirements

- Node.js 20.19+
- pnpm (recommended) or npm

## Install

```bash
git clone https://github.com/your-name/local-ai-workflow.git
cd local-ai-workflow
pnpm install
pnpm link --global
workflow --help
```

To install the workflow into another repository:

```bash
./install.sh /absolute/path/to/target
./install.sh /absolute/path/to/target --apply
```

The first command previews changes. The second applies them. The installer does not stage, commit, or push files.

## How it works

Runs move through a finite state machine backed by a workflow DAG: `intake → context-review → planning → implementation → verification → sediment`. The context-review gate records repository guidance, line-addressed source references, and an actionable verification command before planning. Structured events record transitions and evidence; leases and journals make interruption and commit reconciliation recoverable. Planning, quality, loop, and evidence-routing policies are deterministic and testable. The local context index narrows search results but never replaces source review or verification.

The detailed design and implementation notes are in [docs/README.zh-CN.md](./docs/README.zh-CN.md).

## Repository layout

```text
cli/       Command-line entry point
src/       Workflow engine and adapters
scripts/   Installer and demos
templates/ Planning, context-review, and evidence templates
workflows/ Built-in workflow definitions
test/      Node.js test suite
```

## Development

```bash
pnpm install
pnpm test
pnpm workflow -- help
```

## Sponsor

If this project helps your work, you can support its maintenance through Alipay:

![Alipay sponsor QR code](./assets/alipay-sponsor.png)

Sponsorship is voluntary and does not grant commercial-use rights.

## License

PolyForm Noncommercial 1.0.0. Commercial use, paid services, advertising, and use in commercial products or workflows are not permitted. See [LICENSE](./LICENSE) for the terms.
