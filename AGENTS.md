# .github — Agent Rules

## Mission

Provide canonical account-wide GitHub community-health, issue-intake, pull-request, security,
support, and profile defaults for `spencer-shadley` repositories.

## Responsibilities

- Own canonical account-wide issue-template and pull-request-template content.
- Own the canonical GovernedIntakeBodyV1 semantic source/release and its deterministic issue-form projection after the .github#13 cutover; semantic source and live `task.yml` must live in this repository so no cross-repository publish/sync step exists.
- Own the account profile, contribution guidance, support guidance, security defaults, and code of conduct.
- Enforce native GitHub inheritance: normal fleet repositories must not carry local `.github/ISSUE_TEMPLATE/**` or local issue-template `config.yml` overrides.

## Non-responsibilities

- Does not own repository-local workflows, CI execution, merge authority, or deployments.
- Does not own leaf-repository charters, product behavior, or local engineering policy.
- Does not enable account-wide GitHub Actions as a substitute for the fleet's local verification gates.
- Does not own issue-routing judgment merely because it supplies the form/contract content.
- Does not copy governed-intake bytes into consumer repositories as editable policy. Consumers may cache a producer-verified release by commit/digest, but caches are disposable and non-authoritative.

## Current status / readiness

`README.md`, the live default-branch files, and Git history establish current readiness. This
charter states durable ownership, not completion. Fleet constitution remains owned by Code.
Governed issue-intake semantic ownership is migrating here under
[.github#13](https://github.com/spencer-shadley/.github/issues/13); until that cutover closes, Code's
current governed-intake bundle is compatibility producer state, not the desired long-term owner.

> **Source of truth (workspace constitution):** `C:\code\AGENTS.md` — [Agent Constitution](../../../AGENTS.md).
> Fleet always-on law and progressive-disclosure index. Nested git roots may stop ancestral walk — resolve this path explicitly.
> Rules in *this* file win only for charter/stack/risk inside this directory tree.
> **Priorities / SLI / SLO:** [PRIORITIES.md](./PRIORITIES.md) (inherits fleet `C:\code\PRIORITIES.md`).

## Editing rules

- Treat paths under `.github/` and the root community-health files as account-wide public defaults.
- Treat `.github/ISSUE_TEMPLATE/task.yml` as the only live fleet task form. Do not create a repo-local copy as a compatibility mechanism.
- Keep `README.md`, `CONTRIBUTING.md`, governed-intake docs, release metadata, and consumer guidance synchronized with the live issue-form filenames and ownership boundary.
- Preserve the canonical `Agent Provenance Labels` and `Agent Cost Summary` (`<!-- agent-cost-summary-v1 -->`)
  contract in `.github/PULL_REQUEST_TEMPLATE.md`; do not redefine those field, metric, or accounting
  semantics in `AGENTS.md`.
- Do not add GitHub Actions without an explicit fleet policy decision and repository-local evidence.
- Verify referenced paths exist before publishing documentation changes.
