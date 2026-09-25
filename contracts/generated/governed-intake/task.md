---
name: Task / bug / feature
about: Triage-ready issue — the autonomous pipeline authors a plan from this
labels: agent-review, priority:triage-tbd, work:untriaged
---

<!-- Generated from contracts/governed-intake-body.v1.json (GovernedIntakeBodyV1 version 19). Do not hand-edit; run: node --experimental-strip-types contracts/governed-intake-body.generate.ts -->

## Work type
<!-- Defect | Task | Risk reduction | Exploration / design research | Experiment / evidence test | Feature | Mixed -->

## Governed work-unit key
<!-- Derive SHA-256 from the normalized tuple `fixOwnerGitHubSlug + workType + canonicalWorkUnitIdentity`. Apply ECMAScript String.prototype.trim(), then String.prototype.normalize('NFC'), then the field-specific case rule. Apply locale-independent String.prototype.toLowerCase() to the normalized owner/repository GitHub slug. Apply locale-independent String.prototype.toLowerCase() to the normalized work type. Preserve the normalized UTF-8 bytes exactly after trim and NFC; do not lowercase, collapse internal whitespace, or rewrite punctuation. In identityTuple order, frame each normalized value as its UTF-8 byte length in unpadded ASCII decimal, then ASCII ':' (0x3a), then its exact UTF-8 bytes. Join the three framed values with ASCII LF (0x0a), with no trailing LF. SHA-256 hashes these serialized bytes; render the digest as 64 lowercase hexadecimal characters. Choose the smallest durable mechanism or outcome seam that names the work unit. Keep it unchanged when evidence, priority, wording, or comments change. The same key means the same work unit. If distinct semantics would map to one key, resolve the canonical identities before create; never add randomness, a UUID, or mutable evidence to escape the collision. Before governed create, replace the placeholder digest below and leave exactly one marker in the body. -->
<!-- governed-work-unit-key: sha256:<64 lowercase hex> -->

## What happened or what is needed?
<!-- One paragraph. For bugs: symptom + repro. For features: the user-visible outcome. -->

## Initial priority guess
<!-- P0 candidate | P1 | P2 | P3 | P4 | P5.
     Triage TODO: Consult docs/guides/issue-priority.md (Defect Evidence Scale / Economic Case) before selection.
     Key rule: Non-crashing defects, performance debt, and resource leaks are capped at <= P2.
     P0 candidate is strictly reserved for actively blocked critical paths without safe workarounds. -->

## Why this initial priority?
<!-- One short reason: current harm, urgency, expected value, or time saved (cite docs/guides/issue-priority.md defect scale: frequency x severity x urgency). -->

## Triage checklist
<!-- governed-triage-checklist: revision=19 -->
<!-- This checkbox block is the current triage-state SSOT. Check an item only after current evidence satisfies it. Do not delete or rename item markers. -->
<!-- governed-triage-item: canonical-flow -->
- [ ] **Canonical flow**: Use `skills/gh-issue-triage-sweep/SKILL.md`. Keep discovery/orchestration in that skill and selected-collection adjudication in `gh-issue-audit`; do not recreate either procedure in issue prose.
<!-- governed-triage-item: value-direction -->
- [ ] **Value + direction evidence**: Decide current value and direction from live sources. Record `direction-checked-at: <ISO-8601 UTC>` in the idempotent triage receipt, bound to the issue's governed work-unit key and current checklist revision. Direction evidence expires after 3 days. AO #8570 owns runtime stale-evidence re-pend / pickup refusal; Code records the contract and evidence but does not pretend its docs are the actuator.
<!-- governed-triage-item: fix-owner-responsibility -->
- [ ] **Fix-owner + responsibility**: Verify with `fleet-repo-responsibility-routing`, the target repo's current `AGENTS.md`, and `repos/infra/fleet-registry/dist/fleet-registry-release.json` (`FleetRegistryReleaseV1`). Never substitute retired registry markdown for that release.
<!-- governed-triage-item: dedup-queue-synergy -->
- [ ] **Dedup + queue synergy**: Search related open/closed work and apply `docs/guides/queue-synergy.md`. Reuse or strengthen the canonical owner instead of creating a parallel implementation track.
<!-- governed-triage-item: scope-decomposition -->
- [ ] **Scope + decomposition**: Resolve work shape before assigning final attributes. Record exactly one current disposition from the canonical triage policy: ordinary leaf (`decomp-not-needed`, low/medium), qualified atomic-high leaf (`decomp-atomic` + `effort:high` with independent confirmation), or tracking parent (`decomp` + `epic` with a validated child graph). Unresolved, unknown, or unqualified evidence stays pending. Child triage does not wait for a parent completion stamp. Do not require `decomp-in-progress`. Reuse `evaluateTriagePolicy` and the effort rubric in `contracts/governed-intake-triage-policy.v1.json`; do not copy a second rubric or treat checked boxes as qualified identity.
<!-- governed-triage-item: priority-work-dimensions -->
- [ ] **Priority + work dimensions**: Apply the complete priority triplet, exactly one honest effort, and exactly one lawful tier from the live priority/work-spine policies. Effort definitions and examples come from the canonical governed-intake triage policy, not private calibration caps. Missing or unclear effort is unknown, not low. Certified atomic-high remains high. Never self-admit P0.
<!-- governed-triage-item: verify-human-required -->
- [ ] **Verify + human-required fences**: `tier:auto` executable leaves require the current scoped named-file `## Verify` fence, including ordinary `effort:low|medium` leaves and qualified `effort:high` atomic leaves. Repair that narrow fence only when the current actor is allowed to edit it; otherwise hand off the repair. Tracking parents do not inherit child Verify, host, or substrate requirements. `human-required` is adjudicated through `stamp-human-required` and requires the current tradeoffs contract. A fence-edit allowance is never blanket body-rewrite authority.
<!-- governed-triage-item: cloud-runnable -->
- [ ] **Cloud vs local execution**: Assess the implementation stage using the [cloud-readiness criteria](https://github.com/spencer-shadley/code/blob/master/docs/architecture/cloud-local-executor-routing.md#cloud-ready-issue-triage). Before triage can complete, apply exactly one execution-substrate label: `cloud-ready` when implementation can run in an authorized provider-hosted environment, or `local-required` when implementation needs a fleet/local machine. Never leave both or neither on a completed triage. Record `ready` or `not-ready`, a short reason, and any separately required local verification/rollout in the existing triage receipt; an unresolved or `unknown` assessment stays untriaged. If one exact host is required, also apply its machine label. Tracking parents do not inherit every child host or substrate requirement.
<!-- governed-triage-item: disposition-effect-authority -->
- [ ] **Disposition != effect authority**: Adjudicate close / keep / strengthen / residualize / consolidate / move semantics from evidence. Execute close, move, substantive rewrite, or another restricted GitHub effect only when the current role is authorized; otherwise hand the adjudicated effect to the authorized executor with a durable receipt. Do not keep zombie work alive merely because the current seat cannot execute the terminal effect.
<!-- governed-triage-item: higher-intelligence-handoff -->
- [ ] **Higher-intelligence handoff**: `effort:high`, unclear effort, `human-required`, material remaining uncertainty, or programme-shaped work uses qualified higher-intelligence assessment inside triage. Scope and decomposition are the earlier `scope-decomposition` obligation. Confirmed tracking parents stay tracking-only. Unresolved delegation is not completed triage. The triage role does not mint implementation plans or commission implementation writers.
<!-- governed-triage-item: github-effects-quota -->
- [ ] **GitHub effects + quota**: Use the governed GitHub mutation/read path and preserve typed rate-limit defer such as `deferred_rate_limited`; rate-limit or transport failure is not an empty candidate set or successful sweep.
<!-- governed-triage-item: confirm-receipt -->
- [ ] **Confirm + receipt**: Clear pending/legacy triage labels only after the contract is satisfied, then apply the current `triaged:vN` stamp last when authorized and read it back. In addition, every substantive model-triaged run records additive model provenance using `triaged-by-<model>-<effort>` derived from authoritative execution receipts (never stripped on re-triage or correction). The single idempotent receipt records checklist completion, direction evidence, disposition, priority/effort/tier, actor-permission outcome, and any handoff. Pickup additionally requires fresh direction evidence. Cosmetic removal of `decomp-in-progress` never gates discovery or reuse.
<!-- governed-triage-item: taxonomy -->
- [ ] **Taxonomy**: Validate the current DOCTRINE §14 causal taxonomy and, for defects, distinct prevention and detect/self-heal/recover ladders; conserve new actionable findings as durable work.
<!-- /governed-triage-checklist -->

## Relevant details
<!-- Evidence, links, impact. When filing via cli-wrappers, fill provenance exactly: -->
- repository: spencer-shadley/.github
- commit: <!-- exact 40-character source commit from the admitted release -->
- path: .github/ISSUE_TEMPLATE/task.yml

## Exact leases
<!-- Exact directories, files, and resources this change may mutate. If no lease applies, write an explicit N/A — <reason>. -->
N/A — <reason>

## Root-cause taxonomy and disposition
<!-- Required by fleet DOCTRINE.md §14 / governed-intake-body-v1. Climb all nine ranks.
     Use honest TBD — triage when a rank is not yet known — TBD is an open triage
     obligation, not decoration. Cite §14; do not restate doctrine.
     Causal climb columns are Rank, Finding, Disposition, Reified as.
     Defects MUST complete ladders A (Prevention / never again) and B (Detect/heal/recover / §18)
     as distinct structures. Do not keep a single Fix or next action column as the only action.
     Legal status tokens: `landed` | `assigned-issue` | `already-owned` | `inherited` | `N/A` | `evidence-ceiling` | `TBD — triage`. Every rank requires a real disposition; use `evidence-ceiling` only when evidence is genuinely unobtainable, never as a default terminator. -->

| Rank | Finding | Disposition | Reified as |
|---|---|---|---|
| Subspecies | <!-- this exact symptom --> | <!-- disposition --> | this issue |
| Species | <!-- same mode + proximate cause elsewhere --> | <!-- disposition --> | issue/plan or TBD — triage |
| Genus | <!-- shared mechanism --> | <!-- disposition --> | issue/plan or TBD — triage |
| Family | <!-- subsystem invariant --> | <!-- disposition --> | issue/plan or TBD — triage |
| Order | <!-- architectural pattern --> | <!-- disposition --> | issue/plan or TBD — triage |
| Class | <!-- standard/tool/prompt producing it --> | <!-- disposition --> | issue/plan or TBD — triage |
| Phylum | <!-- ownership/lifecycle structure --> | <!-- disposition --> | issue/plan or TBD — triage |
| Kingdom | <!-- incentive / reward shape --> | <!-- disposition --> | issue/plan or TBD — triage |
| Domain | <!-- optimization model --> | <!-- disposition --> | CEO / terminal stop reason |

### A. Prevention — never again
<!-- Required for Defects. Other work types may use N/A per row. Preventive control at each §14 rank. -->

| Rank | Preventive control | Status |
|---|---|---|
| Subspecies | <!-- control so this occurrence cannot recur --> | TBD — triage |
| Species | <!-- class control across the same mode --> | TBD — triage |
| Genus | <!-- mechanism cannot produce this species --> | TBD — triage |
| Family | <!-- contract/boundary that forbids the mechanism --> | TBD — triage |
| Order | <!-- architecture that does not share the weakness --> | TBD — triage |
| Class | <!-- engineering-system change so tools cannot emit it --> | TBD — triage |
| Phylum | <!-- org/process that owns the class --> | TBD — triage |
| Kingdom | <!-- governance that does not reward this mode --> | TBD — triage |
| Domain | <!-- objective that does not select for this class --> | TBD — triage |

### B. Detect / self-heal / recover — if it still happens
<!-- Required for Defects. Other work types may use N/A per row. If it still happens: notice, heal, restore, escalate. -->

| Rank | Notice | Self-heal / contain | Restore | Escalate if no progress | Status |
|---|---|---|---|---|---|
| Subspecies | <!-- how this occurrence is noticed --> | <!-- heal/contain --> | <!-- restore --> | <!-- escalate if no progress --> | TBD — triage |
| Species | <!-- how the class is detected --> | <!-- heal/contain --> | <!-- restore --> | <!-- escalate if no progress --> | TBD — triage |
| Genus | <!-- how the mechanism is detected --> | <!-- heal/contain --> | <!-- restore --> | <!-- escalate if no progress --> | TBD — triage |
| Family | <!-- how the invariant breach is noticed --> | <!-- heal/contain --> | <!-- restore --> | <!-- escalate if no progress --> | TBD — triage |
| Order | <!-- how the pattern failure is noticed --> | <!-- heal/contain --> | <!-- restore --> | <!-- escalate if no progress --> | TBD — triage |
| Class | <!-- how the producing standard is detected --> | <!-- heal/contain --> | <!-- restore --> | <!-- escalate if no progress --> | TBD — triage |
| Phylum | <!-- how ownership/lifecycle miss is noticed --> | <!-- heal/contain --> | <!-- restore --> | <!-- escalate if no progress --> | TBD — triage |
| Kingdom | <!-- how the incentive failure is noticed --> | <!-- heal/contain --> | <!-- restore --> | <!-- escalate if no progress --> | TBD — triage |
| Domain | <!-- how objective-model failure is noticed --> | <!-- heal/contain --> | <!-- restore --> | <!-- escalate if no progress --> | TBD — triage |

At planning/closure, every rank requires a real disposition and an acted-on artifact or an explicit evidence-backed reason for delegation, non-action, unsupported scope, or evidence ceiling. Evidence ceiling is reserved for genuinely unobtainable evidence, not a default terminator. Defects also require both ladders at each rank.

## Durable fix and acceptance
<!-- Bullet list the loop's verify gate can check. The better this is, the likelier a clean
     autonomous fix. -->

## Human-decision state
<!-- No human decision required | Decision needed: <exact question for Spencer> -->
