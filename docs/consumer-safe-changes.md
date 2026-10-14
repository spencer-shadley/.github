# Consumer-safe changes

**Rule (PR checklist):** if a PR changes something other code depends on — a library, a shared
contract or schema, a published release or its file layout, a CLI's flags or output, a config format
— the author confirms before merge that either:

1. **No consumer breaks**, or
2. **A clear path for every consumer is already ready** — not "they'll notice and fix it".

"Ready" means one of the options below is actually done or lands in the same change. Pick whichever
fits; these are options, not a prescription.

## Options

- **Stay backward-compatible.** Additive changes only: keep the old field/file/flag alongside the new
  one until consumers have moved, then remove it in a later PR. Bump a contract/schema version when the
  shape changes so consumers can detect it instead of failing on a missing file.
- **Consumer first.** Land the consumer change that accepts both the old and new shape *before* the
  producer switches. Then the producer change is safe whenever it ships.
- **Same change / coordinated release.** When old and new can't coexist, ship producer and consumer
  together (linked PRs that merge back-to-back) and note the ordering in both PRs.
- **Prove it with a test.** A real or example integration test that exercises a consumer against the
  new output (e.g. run the consumer's verifier against the candidate release) is the strongest
  evidence that nothing breaks.

## What this does *not* require

- A producer repo is **not** required to enumerate, track, or test its consumers itself
  (see `.github#37`: `.github` must not enumerate or test its consumers; example or real integration
  tests are fine). The author's job is to check — or provide a path — not to make the producer own its
  consumers.
- Auto-pull does not cover this. Auto-pull only gets every repo to its *latest* commit; if the
  consumer's latest commit still expects the old shape, everyone pulls into the breakage together.

## In the PR

Under **Consumer Safety** in the PR template, write one line: who consumes what you changed, and which
option above makes it safe (or "no consumers affected" with the reason).

## Motivating incident (2026-10-14)

At 08:18 PT, `spencer-shadley/.github` released `ae06fc93`, which replaced `contract.json` with
`manifest.json` in the governed-intake producer release. `cli-wrappers`' fleet-cli release verifier
still required `contract.json`, so every governed fleet-cli GitHub write (issue create, label changes,
body edits) failed fleet-wide with `unverifiable_release: ENOENT .../contract.json`. Plain comments
still worked.

Auto-pull couldn't help: cli-wrappers' newest commit still had the old checker. The gap was ordering —
the producer changed format before the consumer could read it. Any one of the options above (keep
`contract.json` for a release, teach the verifier `manifest.json` first, ship both together, or run
fleet-cli's verifier against the candidate release) would have prevented it.

Tracking: [cli-wrappers#1739](https://github.com/spencer-shadley/cli-wrappers/issues/1739)
([impact comment](https://github.com/spencer-shadley/cli-wrappers/issues/1739#issuecomment-6172486434)).

## Second incident: a revision bump that the Worker could not follow (2026-10-14)

At 11:30 PT, `.github#82` (`7237be8`) published governed-intake **revision 26** for a wording-only
change (ladder A column `Preventive control` renamed `Class fix`). The PR's Consumer Safety line said
no consumer breaks because each keeps a pinned release. That was false for the GitHub MCP Worker: it
reads the live release (r26) but evaluates with the rules compiled into its last deployment (r25), and
its completion gate requires the two revisions to match. Every Worker triage completion was refused
with `direction_publication_mismatch` until the revert (`9b73d78`, PR #84) restored r25
([#83](https://github.com/spencer-shadley/.github/issues/83)). A new revision also moves the stamp to
`metadata:triage-v<N>`, so adopting it would have made every settled r25 stamp stale again.

What would have made it safe:

- **Deploy the admitting consumer first.** Stage the next release in the Worker's prepared slot, deploy
  the Worker, read back `GET /` (`checklist_revision`), then publish the producer
  (see "Stage the replacement fully" in [governed-intake-ssot.md](governed-intake-ssot.md)).
- **Do not bump for wording nothing validates.** A bump is for changes to checklist meaning. If the
  validator still has to accept both spellings, say which spelling an older evaluator rejects before
  claiming compatibility: r25 evaluators accept the `Fix the class` heading but reject the `Class fix`
  column, so that part is not backward-compatible for a consumer that has not loaded r26.
- **Check the live consumer, not the pin.** "Consumers keep a pinned release" is no longer a true
  statement (`.github#37`); read the consumer's health or loader output instead of assuming.
