---
name: full-validation
description: >-
  Run the complete executable validation for spencer-shadley/.github at an exact commit SHA for
  asynchronous post-land/default-branch health validation and red recovery.
---

# Full validation — .github

Fresh-read `AGENTS.md`, the repository test inventory, and this skill at the requested SHA. Fetch the
requested SHA and use a clean isolated checkout/worktree whose full HEAD SHA matches it. Do not edit
templates, docs, tests, or fixtures to obtain green.

## Authoritative suite

This policy repository currently has one executable test surface under `test/`. Run every checked-in
Node test, not an affected-files subset:

```text
node --experimental-strip-types --test test/*.test.ts
```

If executable tests/checks are added elsewhere, update this skill in the same change so full
validation continues to mean all repository-owned executable checks.

## Result

`PASS` = every executable repository check passed at the requested SHA. `FAIL` = an authoritative
check ran and failed. `UNABLE` = environment/tooling/checkout prevented execution; include the exact
unblock. An older-SHA result never proves a newer default tip green.

Emit `full-validation-result-v1` with repository, requested SHA, tested SHA, commands, result, exit
codes, elapsed time, environment/host identity, and diagnostic evidence.