# Security — secrets & leak playbook

This is the account-wide default. It applies to every `spencer-shadley` repository that does not
ship its own `SECURITY.md`.

1. **No secret is ever committed** — tokens, capability URLs (an ntfy topic IS a password), API
   keys, `.env`. Extend the repo's `.gitignore` for its specific secret shapes BEFORE the first
   secret exists.
2. **Secrets live in**: gitignored local files (`.***-token`, `.notify.json`-style) or the
   platform's secret store — never in code, config-committed, or logs. Verify-gate/log output must
   not echo env (tails get pushed to branches and job logs).
3. **Leak playbook** (evidence: a runner token was once committed plaintext — rotated same day):
   ROTATE immediately (the old value is dead the moment it touched a commit, even if scrubbed) →
   scrub the file (empty the value, keep the shape) → gitignore it → log the incident
   (`.ops/incidents.jsonl`, kind:`other`, plus severity) → check whether anything consumed the
   leaked value.
4. **Tools**: secret-scanning hooks/apps (gitleaks, GitGuardian) are advisory layers — the rule is
   the design (secrets structurally outside the repo), not the scanner.

## Reporting

There is no public bug bounty; every repository under this account is privately owned and
operated. To report a suspected leak or vulnerability, file an issue in the affected repository
using the [task form](.github/ISSUE_TEMPLATE/task.yml) with severity `P1` and no reproduction
detail that would itself leak the secret — describe the exposure class and where it was found
instead.
