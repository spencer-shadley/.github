---
name: pr-validation
description: >-
  Run merge-path validation for spencer-shadley/.github at the pull-request
  candidate SHA. The commands are the repository test suite and the
  triage-policy check.
---

# PR validation — .github

Fresh-read `AGENTS.md`, `local-ci.json`, and this skill at the candidate SHA. Fetch that SHA and
use a clean isolated checkout. Test the integration of the exact candidate onto the target base.
Do not edit templates, docs, tests, or fixtures to obtain green.

Before validating issue-intake changes, read the canonical
[ownership and migration guide](../../docs/governed-intake-ssot.md). This repository is the account
form producer, not a normal consumer: its own issue-template directory must exist. Do not copy that
directory into another repository to make a test pass.

## Commands

`local-ci.json` is the executable authority. It sets `prMergeProfileId` to `merge` and
`prBroaderFallback` to true, and it declares no path selector. The merge path therefore runs the
broader fallback at the candidate's integration SHA: every checked-in Node test (the contract's
`authoritative-gate`), plus the triage-policy check [full validation](../full-validation/SKILL.md)
already requires.

```text
node --experimental-strip-types --test test/*.test.ts
node --experimental-strip-types contracts/governed-intake-triage-policy.generate.ts --check
```

Read `local-ci.json` at the tested SHA before running. If its `authoritative-gate` differs from the
test command above, the contract wins and this skill is updated in the same change. If full
validation adds or removes an executable check, update this skill in that same change.

## Result

`PASS` means both commands exited 0 at the tested integration SHA. `FAIL` means a command ran and
failed. `UNABLE` means the checkout or tooling prevented execution; name the unblock.

Record the repository, candidate SHA, base SHA, integration SHA, both commands, their exit codes,
and the result. The receipt binds candidate, base, and integration, matching `local-ci.json`. A
focused or reconstructed-file run is not this gate. An older default-branch result does not prove
the candidate.

Asynchronous validation of a landed SHA stays in
[full validation](../full-validation/SKILL.md). The commands match. This skill binds them to the
pull-request candidate.
