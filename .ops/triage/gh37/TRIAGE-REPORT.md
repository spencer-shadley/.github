# Triage report: spencer-shadley/.github#37 (seat job-1792613448590-kpidzt)

## Outcome

- **Not completed.** This seat made no GitHub write. Body, labels and comments are unchanged by it.
- **`metadata:triage-v25` preserved untouched.** This seat did not re-verify it. Its body checklist and
  completion marker still read revision 22, while the binding reports revision 25.
- **`updated_at` moved to 2026-10-21T20:23:18Z** because of comment `6325732412`, the Deletion Bot custody
  record for this worktree. Body and labels are unchanged since the first read.
- **Direction receipt not published.** The canonical AO publisher refused at preflight with
  `direction_publish_provenance_invalid` (`mutation: not-applied`, `semanticVerification: not-reached`).
  The refusal was reproduced after the evidence draft was corrected.
- **Evidence draft written** to `C:\Users\Spencer\AppData\Local\Temp\intake-repair-zUo0E0\TRIAGE_EVIDENCE.json`.
  Its provenance is a null-identifier draft, which the publisher refuses.
- **No `triaged-by-*` label added.** The seat has an admitted model and effort, but no server-side route receipt.

## Why the body and labels were not written

1. `## Exact leases` and `## Verify` are absent. Adding them changes the producer scope fingerprint:
   `normalizeIssueScopeBody` (`contracts/governed-intake-policy-binding.ts`) does not strip either section.
   A body edit that changes scope strips the current stamp (`triage-stale-stamp` rule). The brief forbids
   removing `metadata:triage-v25` unless a newer receipt and stamp land in the same step.
2. Only a Worker completion re-stamps in the same step, and it cannot pass yet. Direction is potential-impact
   (below), which stays pending until the exhaustive audit settlement is readable. The stale-stamp rule also
   requires one complete current checklist, and the body's checklist is revision 22. So even a receipt-only
   append risks the stamp.
3. The canonical publisher needs a completed provenance receipt. For an unattested agent that is a
   server-side `routeReceiptId` and `authenticatedPrincipal` (`docs/contracts/issue-triage-provenance.md` §7).
   This seat has neither. It also needs a Worker-verified semantic record for the body, which does not exist.
   A hand-written receipt would be a non-canonical freshness claim and would not clear `direction_semantic_missing`.

## Direction re-check (answer: potential-impact)

- The issue decides that consumers read floating latest and removes pins, vendored copies and the repin flow.
  It supersedes the pinned-consumption criterion in .github#13 and reshapes .github#33. That is a material reshape
  of earlier work, so the answer is not "no-impact".
- The exhaustive direction-coherence audit has not been done (comment 6169155402, 2026-10-14).
- Open overlaps read on 2026-10-21, all created after #37 and all open: code#8535, code#8013, code#8036, code#8070.
- Linked leaves read on 2026-10-21, all **closed** (close reasons not read): .github#33, .github#13,
  code#7658, cli-wrappers#1402, cli-wrappers#1404, agent-orchestrator#9569.
- Custody comment `6325732412` reports that AO `vendor/governed-intake/` is now only a hermetic fixture, and that
  the code, AO and cli-wrappers default branches no longer carry pin or vendored paths. This seat did not verify
  those claims independently. An earlier local observation of AO `vendor/governed-intake/` in a stale checkout is
  consistent with a fixture and is not evidence of residue.
- `.github`-side residue on origin/main: the consumer-pin diagnostic is retired (`docs/governed-intake-ssot.md`,
  Consumer compatibility, lines 137-141), but `plans/gh13-account-intake-ssot.md` and
  `plans/gh13-account-intake-ssot.dag.json` remain. They are a historical rollout snapshot that names retired pin
  paths and self-declares as "not current intake or dispatch authority". No references to either file exist on
  origin/main outside `plans/gh13-*`.

## Proposed body repair (apply only together with the completion)

### Exact leases

```
- plans/gh13-account-intake-ssot.md (delete)
- plans/gh13-account-intake-ssot.dag.json (delete)
```

### Verify

```bash
node --experimental-strip-types --test test/intake-guidance.test.ts test/published-release.test.ts
test ! -e plans/gh13-account-intake-ssot.md && test ! -e plans/gh13-account-intake-ssot.dag.json
```

Validated on a full `git archive origin/main` export (commit `44c35af`). With the two plan files removed in
that scratch copy, the node run is 7 tests, 7 pass, exit 0, and the negative checks exit 0. Outputs:
`.ops/triage/gh37/verify-main-full.txt` and `.ops/triage/gh37/verify-after-plan-removal.txt`.

## Owner next steps

1. Run the exhaustive direction-coherence audit for #37 through gh-issue-audit / direction-coherence-audit.
   Settle code#8535, #8013, #8036, #8070 and any other open item created before #37. Publish the reconciliation receipt.
2. Confirm the custody comment's closure claims against origin/main for code, AO and cli-wrappers.
3. Decide whether the `plans/gh13-*` deletion is in #37's scope. Then apply the body sections, deletions and
   verification in one PR or Worker-completed step. The `plans/` files are the only `.github`-side residue found.
4. After the audit settles: obtain a server-issued authenticated request or route receipt, publish
   `TRIAGE_EVIDENCE.json` through the AO command, read back the receipt, then apply the stamp last.
5. Apply the body sections with the Worker completion (`get_issue` binding, then `update_issue` with
   `triage_assessment` and the current stamp in `add_labels`).

## Defects for intake (not filed by this seat)

- **Worker declaration gap.** The installed `get_issue` and `update_issue` declarations have no
  `observation_window` or `continuation` argument, and `get_issue` has no `body` argument for the transport
  marker. The Worker's own `continuation_required` result requires them. `get_issue(include_triage_binding: true)` on #37 returns `observation_window_required`
  with no way to supply it. Owner: spencer-shadley/code `tools/github-mcp-worker`.
- **Stale stamp.** `metadata:triage-v25` sits on #37 while the body checklist is revision 22 and no receipt is present.

## Evidence files (seat worktree `.ops/triage/gh37/`, not committed)

- `get-issue.out.json`: first binding read, returned `continuation_required`.
- `get-issue-plain.out.json` and `get-issue-after.out.json`: issue read before and after; labels, body and title are identical.
- `links/`: Worker reads of the linked and overlap issues.
- `publish-attempt.stdout.txt` and `publish-attempt.stderr.txt`: the refusal.
- `verify-main-full.txt` and `verify-after-plan-removal.txt`: the proposed Verify on origin/main.
