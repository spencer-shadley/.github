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
