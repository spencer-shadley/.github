# Governed issue-intake single source of truth

Owner: `spencer-shadley/.github` · migration: [#13](https://github.com/spencer-shadley/.github/issues/13)

## Current state and completion evidence

The live account-wide task form is `.github/ISSUE_TEMPLATE/task.yml` in this repository.
This producer now composes the merged triage-policy evaluator, delta planner, and body/checklist
fingerprint checks into the verified portable release, including an early `scope-decomposition`
checklist item. That is source activation of the producer API. It is not proof that Code, CLI, or
worker consumers have bound adapter-verified Router/Gateway/graph receipts, and it does not close
[#13](https://github.com/spencer-shadley/.github/issues/13) or
[code#6458](https://github.com/spencer-shadley/code/issues/6458). Consumer cutover remains a separate
readback. Do not relabel a Code payload as produced by `.github`, fabricate a producer commit/digest,
or delete the compatibility producer before its consumers have a verified replacement.

Read current default-branch source and producer manifests before acting. Do not relabel a Code
payload as produced by `.github`, fabricate a producer commit/digest, or delete the compatibility
producer before its consumers have a verified replacement. Completion requires the implementation
and consumer evidence in #13, not merely closure of a documentation PR.

## Adopted triage-policy source

The approved scope/decomposition policy and effort rubric are authored once in
[`contracts/governed-intake-triage-policy.v1.json`](../contracts/governed-intake-triage-policy.v1.json).
Read its [generated guide](triage-policy.md) for the policy, examples and trust boundary; do not
copy definitions into this guide or provider skills. The pure policy evaluator and delta planner
beside that source are tested producer constituents, not a second workflow service or a new release
builder. This source revision is distinct from the live issue-form checklist revision.

The portable release now includes the policy JSON, pure policy evaluator, delta planner, composition
API, and their executable JavaScript. Consumers must still bind adapter-verified Router/Gateway/graph
evidence; a legacy caller with only checked boxes cannot report completed triage.
[code#6458](https://github.com/spencer-shadley/code/issues/6458) remains the end-to-end adoption owner.
Source tests do not prove deployed model eligibility, generic custody recovery, label cleanup, or
live form inheritance on public and private repositories.

## End state

The GovernedIntakeBodyV1 semantic source/release and its live GitHub Issue Form belong in this
repository. `.github/ISSUE_TEMPLATE/task.yml` is generated deterministically from that source in
the same source change. GitHub distributes the form through native account-wide inheritance to
normal public and private repositories; no per-repository template publication is needed.

Normal repositories carry **no** local `.github/ISSUE_TEMPLATE/**` files and no local issue-template
`config.yml`, except a durable, explicitly owned override exception. The `.github` producer itself
is not a consumer and necessarily contains the account forms and chooser.

## Authority

- **This repo:** live account forms and target owner of governed-intake semantics, revision,
  evaluator/release identity, and deterministic projections.
- **Code:** fleet constitution, triage orchestration/skills, and consumers of the governed-intake
  release; compatibility producer only until the verified cutover.
- **cli-wrappers / github-mcp-worker / other consumers:** verify admitted release/form identity and
  perform their owned transport/effect roles; do not re-author the semantic parser or checklist.
- **Repo Template:** enforce absence of local issue-template overrides; do not materialize one.
- **Leaf repos:** inherit the account defaults. Preserve a genuine specialized use case through
  an upstream form or an explicitly approved exception, not an undocumented copied template.

## Web forms versus machine intake

GitHub web users select the inherited form in the destination repository. GitHub does not put
inherited defaults into that repository's clone, file browser, package, or Git history. Therefore
an absent local template is expected, and a local `readFile` is not proof that web intake is absent.

Machine writers resolve the admitted semantic release, verify producer repository, exact source
commit, supported revision, and payload/file digests, then render and validate a Markdown issue
body using that release. A YAML Issue Form definition is not that rendered body. Passing raw YAML
to a body-text API or `gh issue create --body-file` does not execute the form. Transport adapters
must prove their actual behavior and read back the resulting body and provenance independently
of the web chooser. Neither a Contents API 404 nor a successful CLI issue creation alone proves
that the web chooser inherited the form.

A generated Markdown payload inside an immutable release is allowed. A normal repository-local
GitHub issue template is not an interchangeable cache location: it changes GitHub's selection.

## No-sync invariant

```text
.github semantic source
        ↓ same-repository deterministic generation
.github live task form
        ↓ GitHub native inheritance
normal public/private repositories
```

Consumer caches are disposable, non-authoritative dependencies, identified by producer repository,
commit, and payload digest. Unsupported, stale-under-the-admission-policy, or corrupt releases fail
closed; preserve the complete pending draft and resolution evidence instead of falling back to an
editable local template. Do not hand-edit cached payloads, add cross-repository copy jobs, or use
GitHub Actions to keep duplicate authorities synchronized.

Active docs and skills should link to this guide rather than duplicate ownership rules or a
checklist. Historical plans/results remain history; label their old topology as historical when
referenced from active guidance. Test fixtures for old formats or override rejection are not live
authority and must remain distinguishable from production inputs.

## Revision and delta-only re-triage

The contract family name is not the checklist revision. Read the numeric revision and stable item
identities from the admitted semantic contract; do not pin a revision number in ordinary guidance.
A location/ownership documentation change does not itself change checklist meaning. Preserve the
current revision when semantics and generated bytes are unchanged; changes to semantic contract or
projection content must follow the producer's version-transition guard.

A new semantic revision requires current-revision triage evidence, not automatic re-execution of
all prior reasoning. The implementation tracked by
[code#6449](https://github.com/spencer-shadley/code/issues/6449) must carry forward unchanged valid
item evidence and re-evaluate only added/changed items, affected dependents, or independently stale
evidence. Do not claim delta-only re-triage is deployed until the evaluator/worker tests and release
readback prove it. Moving producer ownership does not justify silently changing this requirement.

## Cutover and verification

1. Land source, generator, evaluators, and a deterministic form check together in `.github`.
   Preserve actual source commit and digest identity in the release.
2. Rebind consumers to that verified release; remove their dependencies on local GitHub templates.
   Only then retire Code's producer and cross-repository publish/copy machinery.
3. Remove normal consumer overrides, including chooser configuration. Repo Template must reject
   their materialization, and active tests/manifests must no longer demand the removed files.
4. Resolve the active FleetRegistry cohort, check each default branch for unexplained overrides,
   and check that form-requested labels exist in the producer and each destination.
5. Prove the current inherited chooser/form on at least one public and one private repository,
   plus the programmatic body/provenance path. Record exact SHAs and distinguish source checks,
   local tests, and observed GitHub behavior. An inaccessible repository is unknown, not clean.
6. Finish the [active guidance sweep](https://github.com/spencer-shadley/.github/issues/15), including
   entrypoint docs, skills, prompts, validators, release metadata, manifests, and regression tests.

## External behavior references

- [GitHub default community-health files](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)
  documents visibility, override behavior, clone absence, and required destination labels.
- [GitHub CLI issue creation](https://cli.github.com/manual/gh_issue_create) documents body-text input.
- [Reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
  require an explicit caller; Actions workflows do not inherit as community-health files.
