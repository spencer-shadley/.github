# Governed issue-intake single source of truth

Owner: `spencer-shadley/.github` · migration: [#13](https://github.com/spencer-shadley/.github/issues/13)

## End state

The GovernedIntakeBodyV1 semantic source/release and its live GitHub Issue Form are co-owned in this
repository. The form at `.github/ISSUE_TEMPLATE/task.yml` is a deterministic same-repository
projection of that source. GitHub distributes it through native account-wide inheritance to every
normal repository, including private repositories.

Normal repositories carry **no** local `.github/ISSUE_TEMPLATE/**` files and no local issue-template
`config.yml`. GitHub treats any valid local issue-template/config file as an override and then does
not use the account default.

## Authority

- **This repo:** governed-intake semantics, revision, evaluator/release identity, live account form.
- **Code:** fleet constitution, triage orchestration/skills, and consumers of the governed-intake
  release; no long-term template producer.
- **cli-wrappers / github-mcp-worker / other consumers:** consume producer-verified release/form
  identity and perform their owned transport/effect roles; no duplicate semantic parser/authority.
- **Repo Template:** enforces absence of local issue-template overrides and must not materialize one.
- **Leaf repos:** inherit the account default. A local override is exceptional, explicit, and
  separately justified.

## No-sync invariant

The desired path has no cross-repository content-copy step:

```text
governed-intake source
        ↓ generate in same repository
task.yml
        ↓ GitHub native inheritance
consumers
```

A consumer may keep a content-addressed cache for offline execution, but the cache must record the
producer repository/commit/payload digest, fail closed when unsupported, and be disposable. Human or
agent edits to a consumer cache are forbidden.

## Migration

Until #13 closes, Code's existing governed-intake bundle is compatibility producer state. During the
cutover:

1. do not add new references that make Code or a repo-local template future authority;
2. remove local issue-template overrides only after local validators/callers stop depending on them;
3. update active docs, skills, prompts, and tests when their ownership assumption changes;
4. preserve versioned/digest-verified compatibility for machine consumers;
5. verify native inheritance on at least one public and one private fleet repository before deleting
   the final compatibility path.

Historical plans/results may continue to describe the old topology as history; active guidance must
describe the current migration and terminal authority.
