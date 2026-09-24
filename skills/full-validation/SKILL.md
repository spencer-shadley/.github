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

Before validating issue-intake changes, read the canonical
[ownership and migration guide](../../docs/governed-intake-ssot.md). This repository is the account
form producer, not a normal consumer: its own issue-template directory must exist. Do not copy that
directory into another repository to make a test pass, and do not confuse an offline documentation
check with a live public/private GitHub inheritance test.

## Authoritative suite

This policy repository currently has one executable test surface under `test/`. Run every checked-in
Node test, not an affected-files subset:

```text
node --experimental-strip-types --test test/*.test.ts
```

The suite includes template-link checks, PR-contract checks, and intake-guidance regression checks.
The guidance checks enforce canonical links and known retired instructions; they are not a semantic
review of every sentence and do not prove that the producer or worker cutover has completed.

If executable tests/checks are added elsewhere, update this skill in the same change so full
validation continues to mean all repository-owned executable checks. In particular, the producer
cutover must add deterministic generation/release/evaluator checks; do not report those checks as
present until their executable implementations are checked in.

## Result

`PASS` = every executable repository check passed at the requested SHA. `FAIL` = an authoritative
check ran and failed. `UNABLE` = environment/tooling/checkout prevented execution; include the exact
unblock. An older-SHA result never proves a newer default tip green. A focused or reconstructed-file
run must be reported as such, not as full exact-checkout validation.

Emit `full-validation-result-v1` with repository, requested SHA, tested SHA, commands, result, exit
codes, elapsed time, environment/host identity, and diagnostic evidence. Report live inheritance,
consumer release admission, and worker deployment separately from local test results.
