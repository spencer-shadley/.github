# Security

The fleet security policy is the root [code SECURITY.md](https://github.com/spencer-shadley/code/blob/master/SECURITY.md): what counts as a secret, where secrets live, the leak playbook (rule 3, including when to rotate) and scanner enforcement. It applies here unchanged. This file adds only rules specific to this repo and never restates the root.

## Repo-specific rules

- This is the account-wide default. It applies to every `spencer-shadley` repository that does not ship its own `SECURITY.md`; such a repository follows the root policy linked above.

## Reporting

There is no public bug bounty; every repository under this account is privately owned and
operated. To report a suspected leak or vulnerability, file an issue in the affected repository
using the [task form](.github/ISSUE_TEMPLATE/task.yml) with severity `P1` and no reproduction
detail that would itself leak the secret - describe the exposure class and where it was found
instead.
