# Contributing

This account runs a single-operator autonomous engineering fleet (see [profile/README.md](profile/README.md)).
Most changes are authored by agents against a queue, not by pull requests from outside
contributors. These are the conventions that apply when a human or an agent opens work here.

## Issues

- Use the current account-wide [task form](https://github.com/spencer-shadley/.github/blob/main/.github/ISSUE_TEMPLATE/task.yml)
  and fill its sections rather than maintaining a separate checklist in this guide.
- Read the canonical [governed-intake ownership and migration guide](https://github.com/spencer-shadley/.github/blob/main/docs/governed-intake-ssot.md)
  before changing intake, filing adapters, validators, templates, or related agent guidance.
- Search for an existing same-class issue before opening a new one; update and conserve the
  occurrence instead of duplicating it.
- Every agent-created issue is assigned `--assignee spencer-shadley`.
- The web Issue Form definition is YAML, not a ready-to-file issue body. Programmatic writers use
  the admitted release's rendered Markdown body and evaluator, record its actual producer identity,
  then read back the created issue. Do not submit the YAML definition as `--body-file` or recreate
  a destination-repository template to make filing work.

## Pull requests

- Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md): external side effects, user-surface
  review, post-merge obligations.
- The merge-blocking gate is each repository's local CI (`local-ci.json` / the orchestrator's
  worktree verify run) — **not** GitHub Actions. This account does not fund GitHub Actions
  minutes; do not add `.github/workflows/` expecting it to gate merges.
- Acquire an issue attempt and exact path/resource leases before writes. Non-overlapping writers
  may work concurrently; serialize overlapping leases and shared landing resources. Read the
  destination repository's `AGENTS.md` before pushing.

## Repository defaults

`spencer-shadley/.github` owns the live account-wide issue forms. Normal public and private
repositories inherit them through GitHub; they do not copy template bytes into their checkouts.
A local issue-template directory, including a local chooser `config.yml`, can suppress the account
defaults. An intentional override requires a durable exception, not a silent fallback.

[`spencer-shadley/repo-template`](https://github.com/spencer-shadley/repo-template) owns repository
bootstrap conventions and no-local-override conformance, not issue-form content or a template-sync
channel. File issue-intake ownership/content defects in `.github`; file bootstrap/materialization
defects in `repo-template`. Other community-health conventions retain their separately documented
owners; this migration is not a blanket transfer of all repository policy.

The semantic producer cutover is still tracked by [.github#13](https://github.com/spencer-shadley/.github/issues/13).
Until verified consumer cutover, Code's admitted bundle is compatibility state. Do not relabel its
manifest as a `.github` release or describe the source migration as completed merely because local
templates were deleted.
