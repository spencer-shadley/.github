# .github

Account-wide GitHub defaults for `spencer-shadley`. This repository is read literally by GitHub
from paths under `.github/` and from files at its own root — see
[`profile/README.md`](profile/README.md) for the account profile and
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the conventions these defaults encode.

## Contents

| Path | Purpose |
|---|---|
| `.github/ISSUE_TEMPLATE/task.yml` | Only live account-wide task issue form; normal repos inherit it natively |
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

## Governed issue-intake SSOT

[Issue #13](https://github.com/spencer-shadley/.github/issues/13) is the active cutover to one
account-wide source of truth. The terminal shape is:

```text
this repository
  governed-intake semantic source/release
            ↓ same-repository deterministic projection
  .github/ISSUE_TEMPLATE/task.yml
            ↓ GitHub native inheritance
  every normal public/private fleet repository
```

There is no Code→.github publish copy and no Repo Template→fleet issue-template copy in the terminal
architecture. Consumer caches are allowed only when they identify this producer by commit/digest and
are mechanically replaceable; they are never editable authority. Any repository-local
`.github/ISSUE_TEMPLATE/**` or issue-template `config.yml` is an override and therefore requires
an explicit durable exception.

See [docs/governed-intake-ssot.md](docs/governed-intake-ssot.md) for the migration and invariants.

`SECURITY.md` and the PR-template shape originate from Repo Template; account-specific
community-health files are owned here.
