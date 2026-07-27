# .github

Account-wide GitHub defaults for `spencer-shadley`. This repository is read literally by GitHub
from paths under `.github/` and from files at its own root — see
[`profile/README.md`](profile/README.md) for the account profile and
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the conventions these defaults encode.

## Contents

| Path | Purpose |
|---|---|
| `.github/ISSUE_TEMPLATE/task.md` | Canonical issue-template content authority for the fleet's issue-intake law |
| `.github/PULL_REQUEST_TEMPLATE.md` | Default PR template |
| `profile/README.md` | Org profile page |
| `SECURITY.md` | Secrets / leak playbook, account default |
| `SUPPORT.md` | Where to file issues, account default |
| `CONTRIBUTING.md` | Issue/PR conventions, account default |
| `CODE_OF_CONDUCT.md` | Short honest default for a single-operator account |

## What is deliberately absent

No `.github/workflows/`. This account's merge-blocking gate is local CI
(`local-ci.json` / the orchestrator's worktree verify run) in each repository, not GitHub Actions,
and GitHub Actions spend is not funded here. `spencer-shadley/repo-template` ships an advisory
`ci.yml` for repos that opt into it locally; that file is not carried into this repository because
a workflow file living in `.github` would apply account-wide by default.

## Source

Templates and `SECURITY.md` are sourced from [`spencer-shadley/repo-template`](https://github.com/spencer-shadley/repo-template)
(its `.github/ISSUE_TEMPLATE/task.md`, `.github/pull_request_template.md`, and `SECURITY.md`),
which is the fleet's canonical per-repo template. This repository carries forward what genuinely
belongs at account scope. `CONTRIBUTING.md`, `SUPPORT.md`, and `CODE_OF_CONDUCT.md` did not exist
in `repo-template` and were written fresh for this account.
