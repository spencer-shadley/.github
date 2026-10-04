/**
 * Pure composition of body, checklist/fingerprint, policy, and delta planning.
 * No network, clock, model invocation, GitHub effects, or custody acquisition.
 *
 * TRUST BOUNDARY: `kind: "adapter-verified"` evidence must be populated by a caller
 * adapter from verified Model Router, Gateway, and Code shared-decomposition receipts.
 * This module never treats checked boxes, issue prose, model names, or a caller-authored
 * `eligible` / `servingVerified` flag as qualified identity. Missing or unsupported
 * semantic evidence cannot produce a completed triage result.
 *
 * Consumer cutover is out of band: this producer exposes the typed API and portable
 * payloads; it does not claim deployed Code/CLI/worker activation.
 */
import { boundTriagePolicyFromProducer, fingerprintIssueScope, fingerprintDirectionFacts, canonicalPolicyJson, type DirectionFacts, type IssueScopeSource } from "./governed-intake-policy-binding.ts";
export { boundTriagePolicyFromProducer, bindTriagePolicy, fingerprintIssueScope, normalizeIssueScopeBody } from "./governed-intake-policy-binding.ts";
import { validateGovernedIntakeBody, validateGovernedWorkUnitKey, type IntakeValidationResult } from "./governed-intake-body.evaluate.ts";
import {
  evaluateTriageChecklistStructure,
  CURRENT_TRIAGE_REVISION,
  type TriageChecklistState,
} from "./governed-intake-triage-state.evaluate.ts";
import {
  assertTriagePolicy,
  evaluateTriagePolicy,
  evaluateImplementationCandidate,
  planRetiredProgressLabelCleanup,
  type Assessment,
  type BoundTriagePolicy,
  type PolicyEvaluation,
  type PolicySnapshot,
  type TriagePolicy,
} from "./governed-intake-triage-policy.evaluate.ts";
import {
  bindTaskProfileContract,
  deriveTaskLabels,
  evaluateTaskLabelProjection,
  resolveRuntimeTaskProfile,
  type TaskProfileContract,
  type TaskProfileRecord,
} from "./governed-intake-task-profile.evaluate.ts";
import taskProfileContractJson from "./governed-intake-task-profile.v1.json" with { type: "json" };
import {
  planChecklistDelta,
  validateChecklistRelease,
  type ChecklistDelta,
  type ChecklistItem,
  type ChecklistRelease,
  type PriorChecklistEvidence,
} from "./governed-intake-triage-state.migrate.ts";
import bodyContract from "./governed-intake-body.v1.json" with { type: "json" };


export const POLICY_PAYLOAD_NAME = "governed-intake-triage-policy.v1.json";
export const COMPOSE_CONSUMER_CUTOVER = false as const;

export interface DirectionImpactReceipt {
  workUnitKey: string;
  scopeFingerprint: string;
  factsFingerprint: string;
  revision: number;
  assessment: "no-impact" | "potential-impact";
  rationale: string;
  reconciliationReceiptId?: string;
}

/** Actual adapter readbacks, supplied separately from the assessment being checked.
 * Resolve and verify the authoritative release immediately before effects. The adapter
 * owns GitHub permission, accepted decision judgment and requested-post-state readback;
 * this pure composition neither authorizes effects nor trusts labels as decision evidence.
 */
export interface DirectionObservation {
  facts: DirectionFacts;
  coverage: "complete" | "incomplete" | "unknown";
  publication: { repository: string; sourceCommit: string; payloadDigest: string; revision: number };
  reconciliation?: {
    receiptId: string;
    factsFingerprint: string;
    scopeFingerprint: string;
    publication: DirectionObservation["publication"];
    status: "verified" | "launched" | "failed" | "incomplete" | "unknown" | "unsupported";
    /** Frozen selection read from the existing audit ledger; every selected issue needs a readback. */
    selectedSubjects: { repository: string; issueNumber: number }[];
    outcomes: {
      subject: { repository: string; issueNumber: number };
      disposition: "keep" | "obsolete" | "superseded" | "reshape";
      decision?: { repository: string; issueNumber: number; commentId: number };
      destination?: { repository: string; issueNumber: number };
      readbackFingerprint: string;
      conservationVerified: boolean;
      relationshipsVerified: boolean;
    }[];
  };
}

const unique = (values: readonly string[]): string[] => [...new Set(values)];
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function currentChecklistRelease(): ChecklistRelease {
  const items = (bodyContract as { triageChecklist: { items: ChecklistItem[] } }).triageChecklist.items;
  const release: ChecklistRelease = { revision: CURRENT_TRIAGE_REVISION, items };
  validateChecklistRelease(release);
  return release;
}

/** Adapter-verified semantic input. There is no `eligible` or `servingVerified` shortcut. */
export type SemanticEvidenceInput =
  | { kind: "missing" }
  | { kind: "unsupported"; consumer: string; reason: string }
  | {
      kind: "adapter-verified";
      workUnitKey: string;
      scopeFingerprint: string;
      state: PolicySnapshot["state"];
      repositoryActive: boolean;
      priorHighEffort: boolean;
      requiresQualifiedAssessment: boolean;
      assessment: Assessment | null;
      currentGraphFingerprint: string | null;
      hasExecutableChildGraph: boolean;
      finalAttributesScopeFingerprint: string | null;
      directionEvidenceFresh: boolean;
      trusted: PolicySnapshot["trusted"];
    };

/**
 * TaskProfileV1 is produced after scope-decomposition, on ordinary/atomic-high executable
 * leaves only. `record` is opaque (validated by `resolveRuntimeTaskProfile`); `required`
 * governs whether a missing/stale/invalid record blocks completion or degrades gracefully
 * to `legacy-unprofiled`. See spencer-shadley/code#6458 and .github#13 for the design record.
 */
export interface ComposedTriageInput {
  /** Actual server-fetched GitHub subject; never derived from the evidence being checked. */
  subject?: Omit<IssueScopeSource, "body">;
  body: string;
  labels: readonly string[];
  evidence: SemanticEvidenceInput;
  priorChecklist?: { previous: ChecklistRelease | null; evidence: PriorChecklistEvidence };
  implementationReceiptId?: string;
  taskProfile?: { record: TaskProfileRecord | null; required: boolean };
  directionImpact?: DirectionImpactReceipt;
  /** Fetched independently by the authoritative consumer adapter, never from directionImpact. */
  directionObservation?: DirectionObservation;
}

export interface ComposedTaskProfileResult {
  status: "profiled" | "legacy-unprofiled" | "not-applicable";
  labels: string[];
  contractIdentity: string;
}

export type ComposedTriageStatus = "complete" | "pending" | "unsupported" | "out_of_scope";

export interface ComposedTriageResult {
  status: ComposedTriageStatus;
  needsTriage: boolean;
  implementationCandidate: boolean;
  implementationEligible: boolean;
  scopeResolved: boolean;
  disposition: string | null;
  reasons: string[];
  legacyLabelsToRemove: string[];
  body: IntakeValidationResult;
  checklist: TriageChecklistState;
  policy: PolicyEvaluation | null;
  policyIdentity: string;
  rubricIdentity: string;
  checklistDelta: ChecklistDelta | null;
  consumerCutover: typeof COMPOSE_CONSUMER_CUTOVER;
  taskProfile: ComposedTaskProfileResult | null;
}

function asStatus(reasons: readonly string[], policy: PolicyEvaluation | null): ComposedTriageStatus {
  if (reasons.includes("unsupported_consumer") || reasons.includes("unsupported_policy_or_rubric_identity")) {
    return "unsupported";
  }
  if (policy && !policy.inScope) return "out_of_scope";
  if (reasons.length === 0 && policy && !policy.needsTriage) return "complete";
  return "pending";
}

export async function evaluateGovernedIntakeTriage(input: ComposedTriageInput): Promise<ComposedTriageResult> {
  const bound = boundTriagePolicyFromProducer();
  const body = validateGovernedIntakeBody(input.body);
  const checklist = await evaluateTriageChecklistStructure(input.body, input.labels);
  const reasons: string[] = [];
  if (!body.ok) reasons.push("body_invalid");
  if (checklist.needs_triage) reasons.push("checklist_incomplete");

  let checklistDelta: ChecklistDelta | null = null;
  if (input.priorChecklist) {
    checklistDelta = planChecklistDelta(
      input.priorChecklist.previous,
      currentChecklistRelease(),
      input.priorChecklist.evidence,
    );
  }

  const evidence = input.evidence;
  if (!evidence || evidence.kind === "missing") {
    reasons.push("missing_semantic_evidence");
    const legacyLabelsToRemove = planRetiredProgressLabelCleanup(bound.policy, input.labels);
    return {
      status: "pending",
      needsTriage: true,
      implementationCandidate: false,
      implementationEligible: false,
      scopeResolved: false,
      disposition: null,
      reasons: unique(reasons),
      legacyLabelsToRemove,
      body,
      checklist,
      policy: null,
      policyIdentity: bound.policyIdentity,
      rubricIdentity: bound.rubricIdentity,
      checklistDelta,
      consumerCutover: COMPOSE_CONSUMER_CUTOVER,
      taskProfile: null,
    };
  }
  if (evidence.kind === "unsupported") {
    reasons.push("unsupported_consumer");
    if (nonempty(evidence.reason)) reasons.push(evidence.reason);
    const legacyLabelsToRemove = planRetiredProgressLabelCleanup(bound.policy, input.labels);
    return {
      status: "unsupported",
      needsTriage: true,
      implementationCandidate: false,
      implementationEligible: false,
      scopeResolved: false,
      disposition: null,
      reasons: unique(reasons),
      legacyLabelsToRemove,
      body,
      checklist,
      policy: null,
      policyIdentity: bound.policyIdentity,
      rubricIdentity: bound.rubricIdentity,
      checklistDelta,
      consumerCutover: COMPOSE_CONSUMER_CUTOVER,
      taskProfile: null,
    };
  }
  if (evidence.kind !== "adapter-verified") {
    reasons.push("unsupported_consumer");
    const legacyLabelsToRemove = planRetiredProgressLabelCleanup(bound.policy, input.labels);
    return {
      status: "unsupported",
      needsTriage: true,
      implementationCandidate: false,
      implementationEligible: false,
      scopeResolved: false,
      disposition: null,
      reasons: unique(reasons),
      legacyLabelsToRemove,
      body,
      checklist,
      policy: null,
      policyIdentity: bound.policyIdentity,
      rubricIdentity: bound.rubricIdentity,
      checklistDelta,
      consumerCutover: COMPOSE_CONSUMER_CUTOVER,
      taskProfile: null,
    };
  }

  const actualKey = validateGovernedWorkUnitKey(input.body);
  let actualScope = "invalid:missing_subject_identity";
  try {
    if (!input.subject) throw new TypeError("missing actual GitHub subject");
    actualScope = fingerprintIssueScope({ ...input.subject, body: input.body });
  } catch { reasons.push("missing_or_invalid_subject_identity"); }
  if (!actualKey.ok || actualKey.key !== evidence.workUnitKey) reasons.push("work_unit_evidence_subject_mismatch");
  if (actualScope !== evidence.scopeFingerprint) reasons.push("scope_evidence_subject_mismatch");

  // Existing semantic composition consumes audit evidence; it does not add an audit evaluator
  // or a second journal. Unknown effects stay with the caller's existing settlement identity.
  const direction = input.directionImpact;
  const observed = input.directionObservation;
  if (!direction || !observed) reasons.push("direction_impact_evidence_required");
  else {
    try {
      const factsFingerprint = fingerprintDirectionFacts(observed.facts);
      const publication = observed.publication;
      if (observed.coverage !== "complete") reasons.push("direction_thread_coverage_incomplete");
      if (!input.subject || observed.facts.seed.repository.toLowerCase() !== input.subject.repository.toLowerCase()
        || observed.facts.seed.issueNumber !== input.subject.issueNumber
        || direction.workUnitKey !== actualKey.key || direction.scopeFingerprint !== actualScope
        || direction.factsFingerprint !== factsFingerprint || direction.revision !== CURRENT_TRIAGE_REVISION) {
        reasons.push("direction_impact_subject_or_facts_mismatch");
      }
      if (publication.repository !== "spencer-shadley/.github" || publication.revision !== CURRENT_TRIAGE_REVISION
        || !/^(?!0{40}$)[0-9a-f]{40}$/.test(publication.sourceCommit)
        || !/^[0-9a-f]{64}$/.test(publication.payloadDigest)) reasons.push("direction_publication_mismatch");
      if (!nonempty(direction.rationale)) reasons.push("direction_impact_rationale_required");
      if (direction.assessment === "no-impact") {
        // Empty outcome rows do not prove an existing unknown audit had no effects.
        // Settle that exact audit first; a no-impact shortcut cannot erase its ledger.
        if (observed.reconciliation || direction.reconciliationReceiptId) reasons.push("no_impact_has_cohort_effects");
      } else if (direction.assessment === "potential-impact") {
        const audit = observed.reconciliation;
        if (!audit || audit.status !== "verified") reasons.push(`direction_reconciliation_${audit?.status ?? "missing"}`);
        else {
          if (!nonempty(audit.receiptId) || audit.receiptId !== direction.reconciliationReceiptId
            || audit.factsFingerprint !== factsFingerprint || audit.scopeFingerprint !== actualScope
            || canonicalPolicyJson(audit.publication) !== canonicalPolicyJson(publication)) reasons.push("direction_reconciliation_binding_mismatch");
          const identities = new Set<string>();
          for (const outcome of audit.outcomes) {
            const subject = observed.facts.threads.find(t => t.repository.toLowerCase() === outcome.subject.repository.toLowerCase()
              && t.issueNumber === outcome.subject.issueNumber);
            const identity = `${outcome.subject.repository.toLowerCase()}#${outcome.subject.issueNumber}`;
            if (!subject || identities.has(identity) || !/^sha256:[0-9a-f]{64}$/.test(outcome.readbackFingerprint)
              || outcome.conservationVerified !== true || outcome.relationshipsVerified !== true
              || !["keep", "obsolete", "superseded", "reshape"].includes(outcome.disposition)) reasons.push("direction_reconciliation_readback_incomplete");
            identities.add(identity);
            if (outcome.disposition !== "keep") {
              const decision = outcome.decision;
              const thread = observed.facts.threads.find(t => decision && t.repository.toLowerCase() === decision.repository.toLowerCase()
                && t.issueNumber === decision.issueNumber);
              if (!thread?.decisions.some(d => d.commentId === decision?.commentId && d.state === "accepted")) {
                reasons.push("direction_accepted_decision_required");
              }
            }
            if (outcome.disposition === "superseded") {
              const destination = outcome.destination;
              if (!destination || !observed.facts.threads.some(t => t.repository.toLowerCase() === destination.repository.toLowerCase()
                && t.issueNumber === destination.issueNumber)
                || `${destination.repository.toLowerCase()}#${destination.issueNumber}` === identity) reasons.push("direction_conservation_destination_required");
            }
          }
          const selected = audit.selectedSubjects.map(s => `${s.repository.toLowerCase()}#${s.issueNumber}`);
          if (new Set(selected).size !== selected.length || selected.length !== identities.size
            || selected.some(id => !identities.has(id))) reasons.push("direction_reconciliation_selection_incomplete");
        }
      } else reasons.push("direction_impact_assessment_invalid");
    } catch { reasons.push("direction_impact_evidence_invalid"); }
  }

  const snapshot: PolicySnapshot = {
    workUnitKey: actualKey.key ?? "invalid:work_unit_key",
    scopeFingerprint: actualScope,
    policyIdentity: bound.policyIdentity,
    rubricIdentity: bound.rubricIdentity,
    state: evidence.state,
    repositoryActive: evidence.repositoryActive,
    labels: [...input.labels],
    priorHighEffort: evidence.priorHighEffort,
    requiresQualifiedAssessment: evidence.requiresQualifiedAssessment,
    assessment: evidence.assessment,
    currentGraphFingerprint: evidence.currentGraphFingerprint,
    hasExecutableChildGraph: evidence.hasExecutableChildGraph,
    finalAttributesScopeFingerprint: evidence.finalAttributesScopeFingerprint,
    checklistCurrentAndComplete: !checklist.needs_triage,
    directionEvidenceFresh: evidence.directionEvidenceFresh,
    trusted: evidence.trusted,
  };
  const policy = await evaluateTriagePolicy(bound, snapshot);
  reasons.push(...policy.reasons);
  const implementation = await evaluateImplementationCandidate(bound, snapshot, input.implementationReceiptId);

  // TaskProfileV1 applies only to executable leaves (ordinary/atomic-high), never a tracking
  // parent. It is evaluated whenever a disposition resolved, independent of otherwise-pending
  // policy reasons, so a profile mismatch reports its own typed reason rather than hiding
  // behind an unrelated checklist/effort gap.
  const taskProfileInput = input.taskProfile ?? null;
  let taskProfile: ComposedTaskProfileResult | null = null;
  if (policy.disposition) {
    const taskProfileBound = await bindTaskProfileContract(taskProfileContractJson as TaskProfileContract);
    if (policy.disposition === "parent") {
      if (taskProfileInput?.record) reasons.push("tracking_parent_task_profile");
      taskProfile = { status: "not-applicable", labels: [], contractIdentity: taskProfileBound.contractIdentity };
    } else {
      const runtime = resolveRuntimeTaskProfile(
        taskProfileBound, taskProfileInput?.record ?? null,
        { workUnitKey: snapshot.workUnitKey, scopeFingerprint: snapshot.scopeFingerprint },
      );
      if (runtime.kind === "legacy-unprofiled") {
        if (taskProfileInput?.required) reasons.push(`task_profile_${runtime.reason}`);
        taskProfile = { status: "legacy-unprofiled", labels: [], contractIdentity: taskProfileBound.contractIdentity };
      } else {
        const labels = deriveTaskLabels(taskProfileBound, runtime.profile);
        const projection = evaluateTaskLabelProjection(taskProfileBound, runtime.profile, input.labels);
        reasons.push(...projection.reasons);
        taskProfile = { status: "profiled", labels, contractIdentity: taskProfileBound.contractIdentity };
      }
    }
  }

  const status = asStatus(unique(reasons), policy);
  return {
    status,
    needsTriage: status === "out_of_scope" ? policy.needsTriage : status !== "complete",
    implementationCandidate: status === "complete" && policy.implementationCandidate,
    implementationEligible: status === "complete" && implementation.eligible,
    scopeResolved: policy.scopeResolved,
    disposition: policy.disposition,
    reasons: unique(reasons),
    legacyLabelsToRemove: policy.legacyLabelsToRemove,
    body,
    checklist,
    policy,
    policyIdentity: bound.policyIdentity,
    rubricIdentity: bound.rubricIdentity,
    checklistDelta,
    consumerCutover: COMPOSE_CONSUMER_CUTOVER,
    taskProfile,
  };
}
