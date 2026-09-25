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
import { boundTriagePolicyFromProducer, fingerprintIssueScope, type IssueScopeSource } from "./governed-intake-policy-binding.ts";
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

export interface ComposedTriageInput {
  /** Actual server-fetched GitHub subject; never derived from the evidence being checked. */
  subject?: Omit<IssueScopeSource, "body">;
  body: string;
  labels: readonly string[];
  evidence: SemanticEvidenceInput;
  priorChecklist?: { previous: ChecklistRelease | null; evidence: PriorChecklistEvidence };
  implementationReceiptId?: string;
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
  const status = asStatus(unique(reasons), policy);
  return {
    status,
    needsTriage: status !== "complete",
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
  };
}
