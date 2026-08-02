# Contributing

This account runs a single-operator autonomous engineering fleet (see [profile/README.md](profile/README.md)).
Most changes are authored by agents against a queue, not by pull requests from outside
contributors. These are the conventions that apply when a human or an agent opens work here.

## Issues

- File findings using the [task form](.github/ISSUE_TEMPLATE/task.yml): `What`, `Why /
  evidence`, `Acceptance`, `Severity / tier hints`.
- Search for an existing same-class issue before opening a new one; update and conserve the
  occurrence instead of duplicating it.
- Every agent-created issue is assigned `--assignee spencer-shadley`.

## Pull requests

- Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md): external side effects, user-surface
  review, post-merge obligations.
- The merge-blocking gate is each repository's local CI (`local-ci.json` / the orchestrator's
  worktree verify run) — **not** GitHub Actions. This account does not fund GitHub Actions
  minutes; do not add `.github/workflows/` expecting it to gate merges.
- One writer per repository at a time. See the repository's own `AGENTS.md` for its queue/direct-L0
  rules before pushing.

## Repository defaults

New repositories are provisioned from [`spencer-shadley/repo-template`](https://github.com/spencer-shadley/repo-template),
which is the source of truth for the file conventions this `.github` repository mirrors at
account scope (issue/PR templates, `SECURITY.md` shape). Report drift between the two as an issue
in `repo-template`.
