Correct account-default links to the live `master` branch and verify that linked producer paths exist. Document simultaneous published/prepared full identities, deployment order and fail-closed selection, while preserving floating-latest direction. Mark the old rollout plan and linked DAG as historical rather than current dispatch authority.

Fixes #15 within the commissioned `spencer-shadley/.github` scope. The original issue also tracks a fleet-wide sweep; this PR does not certify other repositories or live public/private inheritance. Preserve that broader acceptance under #15 until independently verified.

Validation: focused issue-template/PR-template/intake-guidance tests passed (9 tests); `npm test` passed (392 tests); `git diff --check` passed. The final guide wording was additionally checked by the focused suite. No semantic contract, generated payload, live form, or deployment changes.

External side effects: account-default guidance changes on merge; reversible by reverting this commit. No runtime or transport changes.

User surface: links point to the current account defaults. Post-merge: read back the merged files and rerun affected checks; fleet-wide acceptance remains separate.

process-identity: job-1791879630689-c6it34

Signature: codex (implement) | model: gpt-6.1-sol | effort: medium | runner: job-1791879630689-c6it34
