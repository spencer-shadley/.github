# .github

Account-wide GitHub defaults for `spencer-shadley`. This repository is read literally by GitHub
from paths under `.github/` and from files at its own root — see
[`profile/README.md`](profile/README.md) for the account profile and
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the conventions these defaults encode.

## Contents

| Path | Purpose |
|---|---|
| `.github/ISSUE_TEMPLATE/task.yml` | Canonical task issue-form content authority for the fleet's issue-intake law |
| `.github/ISSUE_TEMPLATE/feature.yml` | Canonical feature-request issue form |
| `.github/ISSUE_TEMPLATE/config.yml` | Account issue-form chooser and routing configuration |
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

This repository is the content authority for account-wide issue forms. Repo Template separately
owns portable per-repository structure and currently retains a legacy local `task.md` compatibility
artifact pending its governed migration. `SECURITY.md` and the PR-template shape originate from
Repo Template; account-specific community-health files are owned here.
