/** Producer-owned revision-23 taxonomy completion. Pure validation, never effects.
 * Vocabulary/cardinalities are adopted in the body contract from the accepted
 * Code work-spine contract; consumers execute this released validator.
 * Adapters authenticate timeline, acceptance, reference and decision observations.
 */
import contract from "./governed-intake-body.v1.json" with { type: "json" };

export interface TaxonomyObservation {
  repository: string;
  issueNumber: number;
  state: "open" | "closed";
  /** Exact latest state-transition identity from GitHub (creation initially).
   * A reopen has a new identity even when labels and body return to old bytes.
   */
  lifecycleId: string;
  /** Independently observed last actual progress before non-delivery closure. */
  previousProgress?: string;
}

export interface TaxonomyEvidence {
  workUnitKey: string;
  scopeFingerprint: string;
  revision: number;
  lifecycleId: string;
  regressionReference?: string;
  researchConclusion?: "positive" | "negative" | "inconclusive";
  acceptance?: { verified: boolean; headSha: string; receiptUrl: string };
  blockers?: { label: string; releasePredicate: string; humanInput?: string }[];
  supersededDestination?: string;
  obsoleteDecision?: { accepted: boolean; noRemainingValue: boolean; causingIssue: string; decisionUrl: string; backlinkUrl: string };
}

interface Dimension {
  labels: string[];
  dynamicPatterns?: string[];
  minimum?: number;
  minimumAfterTriage?: number;
  maximum: number | null;
  minimumWhileOpen?: number;
  maximumWhileOpen?: number;
  minimumWhenResolved?: number;
}
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const issueReference = (value: unknown): value is string => typeof value === "string"
  && /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:issues|pull)\/[1-9][0-9]*$/.test(value);
const receiptReference = (value: unknown): value is string => typeof value === "string"
  && /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:issues|pull)\/[1-9][0-9]*(?:#[a-zA-Z0-9_-]+)?$/.test(value);

export function evaluateTaxonomy(input: {
  labels: readonly string[];
  subject?: { repository: string; issueNumber: number };
  state: "open" | "closed";
  workUnitKey: string | null;
  scopeFingerprint: string;
  observation?: TaxonomyObservation;
  evidence?: TaxonomyEvidence;
}): string[] {
  const spec = contract.triageChecklist.taxonomy;
  const reasons: string[] = [];
  const observed = input.observation;
  const evidence = input.evidence;
  if (!observed || !input.subject || !nonempty(observed.lifecycleId)
    || !["open", "closed"].includes(observed.state)
    || typeof observed.repository !== "string"
    || observed.repository.toLowerCase() !== input.subject.repository.toLowerCase()
    || observed.issueNumber !== input.subject.issueNumber || observed.state !== input.state) {
    reasons.push("taxonomy_observation_missing_or_subject_mismatch");
  }
  if (!evidence || evidence.workUnitKey !== input.workUnitKey
    || evidence.scopeFingerprint !== input.scopeFingerprint || evidence.revision !== contract.version
    || !nonempty(evidence.lifecycleId) || evidence.lifecycleId !== observed?.lifecycleId) {
    reasons.push("taxonomy_evidence_missing_or_stale");
  }
  // Validate even unsupported spellings inside a known dimension; a valid sibling
  // must never hide an unknown value or conflicting second value.
  for (const [name, dimension] of Object.entries(spec.dimensions) as [string, Dimension][]) {
    const labels = input.labels.filter(label => label.startsWith(`${name}:`));
    if (labels.some(label => !dimension.labels.includes(label)
      && !(dimension.dynamicPatterns ?? []).some(pattern => new RegExp(pattern).test(label)))) {
      reasons.push(`taxonomy_${name}_unsupported_label`);
    }
    const minimum = name === "resolution"
      ? (observed?.state === "closed" ? dimension.minimumWhenResolved! : dimension.minimumWhileOpen!)
      : dimension.minimumAfterTriage ?? dimension.minimum ?? 0;
    const maximum = name === "resolution" && observed?.state !== "closed"
      ? dimension.maximumWhileOpen! : dimension.maximum;
    if (labels.length < minimum || (maximum !== null && labels.length > maximum)
      || new Set(labels).size !== labels.length) reasons.push(`taxonomy_${name}_cardinality`);
  }
  if (input.labels.includes("type:proposal") && !input.labels.some(label => label.startsWith("type:") && label !== "type:proposal")) {
    reasons.push("taxonomy_proposal_requires_primary_type");
  }
  if (input.labels.includes("type:regression") && !receiptReference(evidence?.regressionReference)) {
    reasons.push("taxonomy_regression_reference_required");
  }
  if (evidence?.researchConclusion !== undefined && (!input.labels.includes("type:research")
    || !["positive", "negative", "inconclusive"].includes(evidence.researchConclusion))) {
    reasons.push("taxonomy_research_conclusion_invalid");
  }
  if (observed?.state === "closed" && input.labels.includes("type:research") && !evidence?.researchConclusion) {
    reasons.push("taxonomy_research_conclusion_required");
  }
  if (input.labels.includes("resolution:delivered") && !input.labels.includes(spec.deliveredProgress)) {
    reasons.push("taxonomy_delivered_requires_verified_progress");
  }
  if (input.labels.includes(spec.deliveredProgress)) {
    const acceptance = evidence?.acceptance;
    if (!acceptance || acceptance.verified !== true || !/^(?!0{40}$)[0-9a-f]{40}$/.test(acceptance.headSha)
      || !receiptReference(acceptance.receiptUrl)) reasons.push("taxonomy_verified_acceptance_required");
  }
  if (observed?.state === "closed" && !input.labels.includes("resolution:delivered")
    && (!nonempty(observed.previousProgress) || !input.labels.includes(observed.previousProgress)
      || !spec.dimensions.progress.labels.includes(observed.previousProgress))) {
    reasons.push("taxonomy_non_delivery_progress_changed_or_unknown");
  }
  if (input.labels.includes("resolution:superseded") && !issueReference(evidence?.supersededDestination)) {
    reasons.push("taxonomy_superseded_destination_required");
  }
  if (input.labels.includes("resolution:obsolete")) {
    const decision = evidence?.obsoleteDecision;
    const decisionReference = (value: unknown) => typeof value === "string" && issueReference(decision?.causingIssue)
      && value.startsWith(`${decision.causingIssue}#issuecomment-`) && /#issuecomment-[1-9][0-9]*$/.test(value);
    if (!decision || decision.accepted !== true || decision.noRemainingValue !== true
      || !decisionReference(decision.decisionUrl) || !decisionReference(decision.backlinkUrl)) {
      reasons.push("taxonomy_obsolete_decision_required");
    }
  }
  const blockers = input.labels.filter(label => label.startsWith("blocked:"));
  const records = evidence?.blockers ?? [];
  if (!Array.isArray(records) || records.length !== blockers.length
    || new Set(records.map(record => record?.label)).size !== records.length
    || records.some(record => !record || !blockers.includes(record.label) || !nonempty(record.releasePredicate)
      || (record.label === "blocked:human-required" && !nonempty(record.humanInput)))) {
    reasons.push("taxonomy_blocker_evidence_required");
  }
  return [...new Set(reasons)];
}

/** Delivery is a separate result from triage. The independent evidence adapter
 * (Code#9381) reads and authenticates these records under the existing review
 * policy; this pure producer checks their current obligation/consumer binding.
 * Neither this shape nor a caller-authored `verified` flag authenticates a record.
 */
export interface DeliveryAcceptanceSubject {
  repository: string;
  issueNumber: number;
  workUnitKey: string;
  scopeFingerprint: string;
  lifecycleId: string;
}

export interface DeliveryAcceptanceApplicability {
  status: "required" | "not-applicable" | "unknown";
  reason: string;
}

export interface DeliveryAcceptanceConsumer {
  id: string;
  name: string;
  entrypoint: string;
  phase: "current" | "default" | "installed" | "recovery" | "future-install" | "future-update" | "future-repair";
  applicability: DeliveryAcceptanceApplicability;
}

export interface DeliveryAcceptanceObligation {
  id: string;
  parentId: string | null;
  owner: string;
  /** Exact UTF-16 span in the producer's preserved acceptance section. */
  original: { start: number; end: number; text: string };
  acceptedScope: { kind: "source-only" | "consumers"; description: string };
  evidenceKind: "source" | "behavior";
  applicability: DeliveryAcceptanceApplicability;
  /** A consumer scope requires a complete, explicitly sourced inventory. */
  consumerInventory?: { coverage: "complete" | "partial" | "unknown"; reference: string; identity: string };
  consumers: DeliveryAcceptanceConsumer[];
}

export interface DeliveryAcceptanceDraft {
  schema: "GovernedDeliveryAcceptanceDraftV1";
  acceptanceFingerprint: string;
  extraction: "complete" | "partial" | "unknown";
  changeKind: "ordinary" | "migration" | "deletion" | "new-owner" | "unknown";
  obligations: DeliveryAcceptanceObligation[];
}

export interface DeliveryAcceptanceNode {
  id: string;
  parentId: string | null;
  owner: string;
  original: DeliveryAcceptanceObligation["original"] & { reference: string };
  acceptedScope: DeliveryAcceptanceObligation["acceptedScope"];
  applicability: DeliveryAcceptanceApplicability;
  definition: { reference: string; requirement: string };
  evidenceKind: "source" | "behavior" | "runtime" | "lifecycle" | "applicability";
  consumer: DeliveryAcceptanceConsumer | null;
  consumerInventory: DeliveryAcceptanceObligation["consumerInventory"] | null;
  meaningFingerprint: string;
}

export interface DeliveryAcceptanceTree {
  schema: "GovernedDeliveryAcceptanceV1";
  subject: DeliveryAcceptanceSubject;
  originalAcceptance: string;
  acceptanceFingerprint: string;
  extraction: DeliveryAcceptanceDraft["extraction"];
  nodes: DeliveryAcceptanceNode[];
  unmapped: { start: number; end: number; text: string }[];
  pendingReasons: string[];
  fingerprint: string;
}

export interface DeliveryAcceptanceObservation {
  schema: "GovernedDeliveryAcceptanceObservationV1";
  subject: DeliveryAcceptanceSubject;
  treeFingerprint: string;
  coverage: "complete" | "incomplete" | "unknown";
  /** Actual independently read durable record and its revision/content identity. */
  record: { reference: string; identity: string };
  items: {
    id: string;
    meaningFingerprint: string;
    result: "verified" | "not-applicable" | "failed" | "unknown";
    /** The adapter maps the actual evidence; the producer does not fetch it. */
    evidence: { kind: DeliveryAcceptanceNode["evidenceKind"]; reference: string; identity: string }[];
    verifier: { actor: string; reference: string; identity: string };
  }[];
}

export interface DeliveryAcceptanceResult {
  status: "verified" | "pending";
  effectAuthority: false;
  treeFingerprint: string;
  reasons: string[];
  items: { id: string; status: "verified" | "not-applicable" | "failed" | "pending"; reasons: string[] }[];
}

const record = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === "object" && !Array.isArray(value);
const referenceIdentity = (value: unknown): boolean => record(value)
  && nonempty(value.reference) && nonempty(value.identity);

/** Extend the existing taxonomy owner for explicit delivery admission. Legacy
 * evaluateTaxonomy remains the triage/lifecycle compatibility surface; its coarse
 * acceptance field is deliberately not evidence for this delivery result. This
 * lower-level check assumes a fresh producer-composed tree; arbitrary shaped
 * caller data is not authenticated. Effect consumers use the public fresh
 * composition entrypoint with actual Code#9381 observations and their own
 * existing authority/readback checks, never this result alone.
 */
export function evaluateDeliveryAcceptance(
  tree: DeliveryAcceptanceTree,
  observation?: DeliveryAcceptanceObservation,
): DeliveryAcceptanceResult {
  const reasons = [...tree.pendingReasons];
  const observed = observation as unknown;
  const subject = record(observed) && record(observed.subject) ? observed.subject : null;
  const bound = record(observed) && observed.schema === "GovernedDeliveryAcceptanceObservationV1"
    && subject !== null
    && Object.entries(tree.subject).every(([key, value]) => subject[key] === value)
    && observed.treeFingerprint === tree.fingerprint && observed.coverage === "complete"
    && referenceIdentity(observed.record) && Array.isArray(observed.items);
  if (!bound) reasons.push("delivery_observation_missing_incomplete_or_stale");
  const facts = bound ? observed.items as unknown[] : [];
  const ids = facts.map(value => record(value) ? value.id : undefined);
  if (new Set(ids).size !== ids.length || ids.some(id => !tree.nodes.some(node => node.id === id))) {
    reasons.push("delivery_observation_duplicate_or_unknown_id");
  }
  const items = tree.nodes.map(node => {
    const errors: string[] = [];
    const matching = facts.filter(value => record(value) && value.id === node.id);
    const fact = matching[0];
    if (matching.length !== 1 || !record(fact) || fact.meaningFingerprint !== node.meaningFingerprint) {
      errors.push("delivery_item_observation_missing_or_meaning_changed");
    }
    if (node.applicability.status === "unknown") errors.push("delivery_applicability_unknown");
    const verifier = record(fact) ? fact.verifier : undefined;
    if (!referenceIdentity(verifier) || !record(verifier) || !nonempty(verifier.actor)) {
      errors.push("delivery_independent_verification_record_missing");
    }
    const evidence = record(fact) && Array.isArray(fact.evidence) ? fact.evidence : [];
    if (evidence.length === 0 || evidence.some(value => !record(value)
      || value.kind !== node.evidenceKind || !referenceIdentity(value))) {
      errors.push("delivery_required_evidence_missing_or_wrong_kind");
    }
    const expected = node.applicability.status === "not-applicable" ? "not-applicable" : "verified";
    const result = record(fact) ? fact.result : undefined;
    if (result !== expected) errors.push("delivery_item_unverified");
    const status: DeliveryAcceptanceResult["items"][number]["status"] = errors.length === 0 ? expected : result === "failed" ? "failed" : "pending";
    return { id: node.id, status, reasons: errors };
  });
  if (!tree.nodes.some(node => node.applicability.status === "required")) reasons.push("delivery_no_applicable_obligations");
  if (items.some(item => item.status === "pending" || item.status === "failed")) reasons.push("delivery_obligations_unmet");
  return { status: reasons.length === 0 ? "verified" : "pending", effectAuthority: false, treeFingerprint: tree.fingerprint,
    reasons: [...new Set(reasons)], items };
}
