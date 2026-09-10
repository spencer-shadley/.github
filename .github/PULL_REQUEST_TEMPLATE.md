## External Side Effects

Does this PR add or change external side effects? If yes, describe the rate-limit/backoff/breaker
and reversibility story from ADR-0001 §2.

## User Surface Review

Every user-visible message/control is actionable by the user or clearly informational; disabled
controls self-explain.

## Agent Provenance Labels

Preserve implementation and review provenance as additive GitHub labels using the fleet's canonical
model/effort slug:

- After an agent performs material coding and reaches a durable source checkpoint, add
  `implementation-<model>-<effort>` to the governed linked issue (for example,
  `implementation-opus-5-high`). Dispatch-only, read-only, or no-source-change attempts do not count.
- After a reviewer APPROVES the exact current PR head, add `review-approved-<model>-<effort>` to this
  PR and, when the governed issue association is unambiguous, mirror it to that issue. Stale-head,
  rejected, change-requested, failed, or incomplete reviews do not count.
- Labels are additive and idempotent. Keep every distinct participating model/effort label across
  later repair rounds and issue close/reopen cycles; never replace or remove earlier provenance.
- Derive model/effort from authoritative execution/review receipts, not prompt prose or agent
  self-identification. Create missing repo-local labels idempotently through the canonical GitHub
  mutation path.
- These labels represent unique participating model/effort combinations, not attempt counts. Exact
  attempt count, timing, cost, and head identity remain in authoritative receipts.

## Agent Cost Summary

For the governed linked issue, maintain one machine-owned top-level comment identified by
`<!-- agent-cost-summary-v1 -->`. Create it after the first attributable model-usage receipt and then
update that same comment in place rather than appending one comment per attempt.

- Count actual issue-attributable model usage, including failed, timed-out, abandoned, superseded,
  implementation, repair, review, verification, and other model work when authoritative lineage ties
  it to the issue. A pre-dispatch zero-usage refusal contributes zero.
- Deduplicate by immutable usage/attempt receipt identity. GitHub is a projection; receipts remain the
  accounting source of truth.
- Show lifetime tokens/cost plus a current reopen-cycle subtotal. Lifetime totals and old provenance
  never reset when an issue closes and is later reopened/refixed; each `closed -> open` transition
  starts the next cycle subtotal.
- Preserve provider/metered billed cost separately from normalized estimated USD. Mark subscription,
  free, included, metered, or unknown billing basis honestly; never present an API-equivalent estimate
  as literal cash charged.
- If older receipts are unavailable, mark coverage partial with the earliest trustworthy timestamp.
- Cost-comment create/update and label mutations use the canonical durable GitHub-effect path so
  rate limits, retries, or concurrent workers cannot silently lose attribution or create duplicates.

## Post-Merge Obligations

What, if anything, must happen after merge for this to be truly done (deploy, sync, incident log,
docs/tutorial update, template anchors)?
