This is the single combined revision-23 governed-intake candidate for #32, #35, #45 and #48. **DO NOT merge or publish this PR. Keep revision 22 live until the coordinator verifies the refreshed Code consumer and lifts the consumer-readiness hold.** Source-only PRs #36, #38 and #51 remain superseded; this PR closes no issue yet.

The producer now asks every triaged issue the open-ended direction-change question. Yes/potential material impact requires `metadata:direction-change`, an exhaustive search of all open issues and PRs created before the causing issue across every repository (bodies, acceptance criteria and all comments), same-step rescope/closure of every conflict citing the causing issue and accepted decision, and exhaustive post-reconciliation readback showing zero unresolved conflicts. This carries **#35 comment 5984926005's full rescope**, not just neighborhood reconciliation.

`directionImpact` and independently fetched `directionObservation` retain their meanings. The added `exhaustiveSearch` observation binds the causing issue's creation cutoff, complete repository inventory, per-repository coverage, initial conflict subjects, final zero counts, publication identity and the existing audit settlement. Missing/inaccessible/truncated coverage, unreconciled conflicts, mismatched settlements and unknown effects stay pending. The pure producer validates adapter evidence; consumer adapters own actual GitHub enumeration, adjudication and effects. No new effect authority or audit ledger is introduced. The canonical label participates in the completion fingerprint; no alias is emitted.

The combined source also preserves #32's taxonomy/completion stamp, #45's `proposal-classification`, and #48's optional second opinion and `agent_unattested` provenance rules. `planChecklistDelta` remains authoritative: the captured real r22 -> r23 regression re-evaluates `value-direction`, `dedup-queue-synergy`, `scope-decomposition`, `higher-intelligence-handoff`, `confirm-receipt`, and new `proposal-classification`; all other valid item evidence carries forward. A revision bump does not force full backlog re-triage. The SSOT guide now describes that combined delta correctly.

Exact candidate identity:

- Current main incorporated: `d67bfba1f9b7ff3df0333d39b7bec541ec74dda2` (#58/#59 and #60 worker dual-accept fix).
- Final source commit: `50d7a802889eaba2814bbf53d74b1f3b7e97e84f`.
- Final release carrier: `71821a6639f274d9d90a0c050873147337d80513`.
- Final PR head: `67f0c9b1641d1885f6c92b04f16f3ac06ff26d3b` (test-only bearer-fixture correction after the release carrier; release payload identity unchanged).
- Manifest revision: **23**; producer: `spencer-shadley/.github@50d7a802889eaba2814bbf53d74b1f3b7e97e84f`.
- Payload digest: `sha256:6ca0de6f3ecf3364ce7c2485670906171811543fecf79b7b7a29d3626a2c7d66`.

All producer-owned form, policy and task-profile projections were regenerated; the portable TS/JS release was built from the committed combined source. GitGuardian's Basic Auth String at `ac886d5a` is a synthetic credential-removal fixture (also documented by main's narrow allowlist). The fixture now constructs userinfo with `URL` at runtime and preserves all HTTPS/SSH stripping and redaction assertions; no credential was rotated or coverage removed. The additional synthetic bearer-token fixture from main is also constructed at runtime, retaining its redaction assertion. GitGuardian still reports historical occurrences at `ac886d5a` and `dbb5a792`; source remediation does not erase historical bot findings, and history was not rewritten.

Verification at the final candidate: full `node --experimental-strip-types --test test/*.test.ts`, focused direction-impact and delta regressions (including portable JavaScript), `triage-policy:check`, `task-profile:check`, body `generate --check`, `release:check`, and release `--verify`. The full suite passes 321/321 tests. The delivery receipt records the independent review custody blocker and the expected consumer-gate refusal; no independent approval or live publication is claimed.

Consumer-readiness hold:

Code #7969 was merged/deployed for the **superseded** source `ac886d5a96ac06cfaa54ada31ab791c6e47d5c50` / digest `sha256:d29a9bd604b9dcb7d090414f8279217458f0bff9b6e34dff989e88762aec5d9d`. It does **not** admit this candidate. The parent coordinator must prepare and deploy a new Code consumer for the exact final identity above, including the exhaustive-search adapter evidence. No Code pins were changed by this implementation. There is intentionally no stale `Consumer-Pin-Pair` trailer.

Before eventual publication, Code #7625 and the owners on #32/#35/#48 must read back consumer compatibility, deployment and stock re-stamp readiness; then the exact-head consumer-pin gate must admit both Code master and the deployed worker. This assignment does not lift that hold or perform a land attempt. After an independently reviewed eventual merge, verify main's manifest, inherited task form and resolved worker revision/digest. Retain the r22 admission path for rollback.

External effects: only this existing PR branch and PR evidence were updated. Live r22 and Code consumer state remain unchanged. Preserve additive implementation/review provenance labels and the canonical `<!-- agent-cost-summary-v1 -->` accounting contract; derive attribution only from authoritative receipts, never inferred model names.

