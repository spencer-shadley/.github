# .github — Agent Rules

## Mission

Provide canonical account-wide GitHub community-health, issue-intake, pull-request, security,
support, and profile defaults for `spencer-shadley` repositories.

## Responsibilities

- Own canonical account-wide issue-template and pull-request-template content.
- Own the account profile, contribution guidance, support guidance, security defaults, and code of conduct.
- Keep account-wide defaults compatible with the fleet's governed intake law.

## Non-responsibilities

- Does not own repository-local workflows, CI execution, merge authority, or deployments.
- Does not own leaf-repository charters, product behavior, or local engineering policy.
- Does not enable account-wide GitHub Actions as a substitute for the fleet's local verification gates.
- Does not own issue-routing judgment merely because it supplies the form content.

## Current status / readiness

`README.md`, the live default-branch files, and Git history establish current readiness. This
charter states durable ownership, not completion. Fleet constitutional and issue-intake policy
remain owned by the Code repository.

> **Source of truth (workspace constitution):** `C:\code\AGENTS.md` — [Agent Constitution](../../../AGENTS.md).
> Fleet always-on law and progressive-disclosure index. Nested git roots may stop ancestral walk — resolve this path explicitly.
> Rules in *this* file win only for charter/stack/risk inside this directory tree.
> **Priorities / SLI / SLO:** [PRIORITIES.md](./PRIORITIES.md) (inherits fleet `C:\code\PRIORITIES.md`).

## Editing rules

- Treat paths under `.github/` and the root community-health files as account-wide public defaults.
- Keep `README.md` and `CONTRIBUTING.md` links synchronized with the live issue-form filenames.
- Preserve the account-wide agent-provenance labeling contract in the PR template: material coding
  adds additive `implementation-<model>-<effort>` provenance to the governed linked issue; exact-head
  approval adds additive `review-approved-<model>-<effort>` provenance to the PR and mirrors it to an
  unambiguous linked issue. Never replace prior provenance labels, including across close/reopen cycles,
  and never infer model/effort from free-form prose when authoritative execution/review receipts exist.
- Preserve the account-wide agent-resource/subscription-cost projection contract in the PR template:
  one `<!-- agent-cost-summary-v1 -->` issue comment is updated in place from authoritative execution,
  token, process, session, and subscription-usage receipts. Where available it reports active wall-
  clock, summed agent wall-clock, process-tree CPU time, token classes, attributable session identities,
  per-subscription billing-cycle identity and task consumption share, plus effective subscription cost.
  The fleet is subscription-funded rather than API-credit-funded: per-request billed USD is not a
  primary task metric, and optional API/list-price-equivalent values must never be described as actual
  spend. Subscription consumption percentages remain scoped to their specific subscription/pool and
  billing cycle; ambiguous/concurrent global-meter deltas remain provisional or unknown rather than
  guessed. Lifetime totals never reset across reopen/refix cycles.
- Do not add GitHub Actions without an explicit fleet policy decision and repository-local evidence.
- Verify referenced paths exist before publishing documentation changes.
