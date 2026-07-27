# spencer-shadley

Private autonomous engineering fleet: a queue-driven discover → triage → plan → implement →
verify → review → merge → observe loop running across a set of infrastructure and product
repositories, operated by one human (Spencer) plus a fleet of autonomous coding agents. Nothing
here is a public open-source project soliciting outside contributors.

## What this repository is

`spencer-shadley/.github` supplies account-wide GitHub defaults that apply to every repository
that does not override them:

- [`.github/ISSUE_TEMPLATE/task.md`](.github/ISSUE_TEMPLATE/task.md) — the sole canonical issue
  template content authority for the fleet's issue-intake law. Every repository's fail-closed
  intake resolves this file's exact commit/tree/blob before filing.
- [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) — default PR template.
- [`SECURITY.md`](SECURITY.md), [`SUPPORT.md`](SUPPORT.md), [`CONTRIBUTING.md`](CONTRIBUTING.md),
  [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — account-wide community-health defaults.

It intentionally carries **no GitHub Actions workflows** — the fleet's merge-blocking gate is
local CI in each repository, not GitHub-hosted Actions, and this account does not fund Actions
spend.

## Where the real work lives

Individual repositories (`agent-orchestrator`, `code`, `repo-template`, `repo-factory`,
`fleet-registry`, product repos, etc.) each own their own source, plans, and `AGENTS.md`. This
repository does not implement product behavior — it only provides the shared defaults GitHub reads
from a repository literally named `.github`.
