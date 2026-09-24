# spencer-shadley

Private autonomous engineering fleet: a queue-driven discover → triage → plan → implement →
verify → review → merge → observe loop running across a set of infrastructure and product
repositories, operated by one human (Spencer) plus a fleet of autonomous coding agents. Nothing
here is a public open-source project soliciting outside contributors.

## What this repository is

`spencer-shadley/.github` supplies account-wide GitHub defaults for repositories without local
overrides. It owns the live issue forms; Repo Template owns bootstrap/no-local-override conformance,
not an issue-template copying channel.

- [Task issue form](https://github.com/spencer-shadley/.github/blob/main/.github/ISSUE_TEMPLATE/task.yml)
  and [feature-request form](https://github.com/spencer-shadley/.github/blob/main/.github/ISSUE_TEMPLATE/feature.yml)
  are selected through GitHub's inherited web chooser.
- [Pull-request template](https://github.com/spencer-shadley/.github/blob/main/.github/PULL_REQUEST_TEMPLATE.md)
  supplies the default PR contract.
- [Security](https://github.com/spencer-shadley/.github/blob/main/SECURITY.md),
  [support](https://github.com/spencer-shadley/.github/blob/main/SUPPORT.md),
  [contribution guidance](https://github.com/spencer-shadley/.github/blob/main/CONTRIBUTING.md), and
  [code of conduct](https://github.com/spencer-shadley/.github/blob/main/CODE_OF_CONDUCT.md)
  supply account-wide community-health defaults.

The [canonical intake guide](https://github.com/spencer-shadley/.github/blob/main/docs/governed-intake-ssot.md)
distinguishes the live form from the still-in-progress semantic producer and consumer cutover.
Machine intake verifies its admitted release and rendered body; this page does not certify that
all adapters have migrated. Do not copy a form into a leaf repository to make it locally visible.

This repository intentionally carries **no GitHub Actions workflows**. The merge-blocking gate is
local CI in each repository, and this account does not fund Actions spend. Workflow reuse is explicit,
not automatic community-health inheritance.

## Where the real work lives

Individual repositories (`agent-orchestrator`, `code`, `repo-template`, `repo-factory`,
`fleet-registry`, product repos, etc.) own their source, plans, and `AGENTS.md` within their charters.
This repository owns account defaults and the commissioned intake producer boundary, not product
behavior or another repository's runtime.
