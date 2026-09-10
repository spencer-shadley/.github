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
- Labels are additive and idempotent. Keep every distinct participating model/effort label; never
  replace or remove earlier provenance because another implementation or review occurs.
- Derive model/effort from authoritative execution/review receipts, not prompt prose or agent
  self-identification. Create missing repo-local labels idempotently through the canonical GitHub
  mutation path.
- These labels represent unique participating model/effort combinations, not attempt counts. Exact
  attempt count, timing, cost, and head identity remain in authoritative receipts.

## Post-Merge Obligations

What, if anything, must happen after merge for this to be truly done (deploy, sync, incident log,
docs/tutorial update, template anchors)?
