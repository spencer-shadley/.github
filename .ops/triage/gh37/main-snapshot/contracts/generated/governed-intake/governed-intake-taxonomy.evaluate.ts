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
