/** Producer-owned semantic identities; no filesystem, network, clock, or model calls. */
import { createHash } from "node:crypto";
import policyJson from "./governed-intake-triage-policy.v1.json" with { type: "json" };
import contractJson from "./governed-intake-body.v1.json" with { type: "json" };
import { assertTriagePolicy, type BoundTriagePolicy, type TriagePolicy } from "./governed-intake-triage-policy.evaluate.ts";
import { CURRENT_TRIAGE_REVISION, renderTriageChecklistBlock } from "./governed-intake-triage-state.evaluate.ts";
import { normalizeLf, validateGovernedWorkUnitKey } from "./governed-intake-body.evaluate.ts";
import { stripDirectionReceiptMetadata } from "./governed-intake-receipt-metadata.ts";

/** Canonical JSON ignores object-key order, not array order or substantive values. */
export function canonicalPolicyJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalPolicyJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalPolicyJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new TypeError("policy identity requires finite plain JSON");
}
const digest = (value: unknown): string => `sha256:${createHash("sha256").update(canonicalPolicyJson(value), "utf8").digest("hex")}`;

/** File-integrity SHA-256 remains in the release manifest; these are semantic identities. */
export function bindTriagePolicy(policy: TriagePolicy): BoundTriagePolicy {
  assertTriagePolicy(policy);
  const immutableInput = JSON.parse(canonicalPolicyJson(policy)) as TriagePolicy;
  return { policy: immutableInput, policyIdentity: digest(immutableInput), rubricIdentity: digest(immutableInput.effortRubric) };
}
export function boundTriagePolicyFromProducer(): BoundTriagePolicy {
  return bindTriagePolicy(policyJson as TriagePolicy);
}

export interface IssueScopeSource {
  repository: string;
  issueNumber: number;
  title: string;
  body: string;
}

/** Independently fetched material facts; omit invocation times, labels and receipt comments.
 * The consumer adapter owns complete thread pagination and accepted-decision adjudication.
 * A receipt's matching caller assertions are never a substitute for this observation.
 */
export interface DirectionFacts {
  seed: { repository: string; issueNumber: number; /** Required for material-impact search cutoff. */ createdAt?: string };
  threads: { repository: string; issueNumber: number; materialFingerprint: string;
    decisions: { commentId: number; state: "proposed" | "accepted" | "reversed"; contentFingerprint: string }[] }[];
  sourceFingerprint: string;
  ownershipFingerprint: string;
  relatedWorkFingerprint: string;
}

export function fingerprintDirectionFacts(facts: DirectionFacts): string {
  const issue = (value: { repository: string; issueNumber: number }) => {
    if (!/^[^/\s]+\/[^/\s]+$/.test(value.repository) || !Number.isSafeInteger(value.issueNumber) || value.issueNumber < 1) {
      throw new TypeError("invalid direction issue identity");
    }
    return `${value.repository.toLowerCase()}#${value.issueNumber}`;
  };
  const sha = (value: string) => { if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new TypeError("invalid direction material fingerprint"); return value; };
  const threads = facts.threads.map(thread => {
    const decisions = thread.decisions.map(decision => {
      if (!Number.isSafeInteger(decision.commentId) || decision.commentId < 1
        || !["proposed", "accepted", "reversed"].includes(decision.state)) throw new TypeError("invalid direction decision");
      return { ...decision, contentFingerprint: sha(decision.contentFingerprint) };
    }).sort((a, b) => a.commentId - b.commentId);
    if (new Set(decisions.map(d => d.commentId)).size !== decisions.length) throw new TypeError("duplicate direction decision");
    return { issue: issue(thread), materialFingerprint: sha(thread.materialFingerprint), decisions };
  }).sort((a, b) => a.issue.localeCompare(b.issue));
  if (new Set(threads.map(t => t.issue)).size !== threads.length || !threads.some(t => t.issue === issue(facts.seed))) {
    throw new TypeError("missing seed or duplicate direction thread");
  }
  if (facts.seed.createdAt !== undefined && !Number.isFinite(Date.parse(facts.seed.createdAt))) {
    throw new TypeError("invalid direction seed creation time");
  }
  return digest({ seed: issue(facts.seed), ...(facts.seed.createdAt === undefined ? {} : { createdAt: facts.seed.createdAt }), threads, source: sha(facts.sourceFingerprint),
    ownership: sha(facts.ownershipFingerprint), relatedWork: sha(facts.relatedWorkFingerprint) });
}

/** Checklist checks and bound machine receipt envelopes do not change implementation scope.
 * Without subject context, direction receipts remain material rather than trusting
 * their own assertion of which issue they belong to.
 */
export function normalizeIssueScopeBody(body: string, identity?: Pick<IssueScopeSource, "repository" | "issueNumber">): string {
  const checklist = contractJson.triageChecklist;
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let text = identity ? stripDirectionReceiptMetadata(normalizeLf(body), identity) : normalizeLf(body);
  const block = new RegExp(`<!--\\s*${escape(checklist.sectionMarkerName)}: revision=([0-9]+)\\s*-->[\\s\\S]*?<!--\\s*\\/${escape(checklist.sectionMarkerName)}\\s*-->`, "g");
  const canonical = renderTriageChecklistBlock({ includeHeading: false, checked: false });
  text = text.replace(block, matched => {
    const normalized = matched.replace(/^([ \t]*[-*][ \t]+)\[[xX ]\]/gm, "$1[ ]");
    // Only the exact producer-authored block is metadata. Foreign prose and malformed
    // markers remain substantive scope, even if placed inside a checklist-shaped region.
    return normalized === canonical ? "" : matched;
  });
  text = text.replace(new RegExp(`<!--\\s*${escape(checklist.completionMarkerName)}:[\\s\\S]*?-->`, "g"), "");
  text = text.replace(/^<!--\s*(?:Generated (?:against|from)|Intake form observed:)[^\n]*-->\s*$/gm, "");
  // Remove only an empty canonical checklist heading left by the delimited block.
  text = text.replace(new RegExp(`^##\\s+${escape(checklist.heading)}\\s*\\n(?=\\s*(?:## |$))`, "gm"), "");
  return text.trim();
}

/** Bind an assessment to the actual GitHub subject, not a caller-supplied matching pair. */
export function fingerprintIssueScope(source: IssueScopeSource): string {
  if (!/^[^/\s]+\/[^/\s]+$/.test(source.repository) || !Number.isSafeInteger(source.issueNumber) || source.issueNumber < 1 || !source.title.trim()) {
    throw new TypeError("invalid issue scope source identity");
  }
  const key = validateGovernedWorkUnitKey(source.body);
  if (!key.ok || !key.key) throw new TypeError(`invalid issue work-unit key:${key.reason}`);
  return digest({ repository: source.repository.toLowerCase(), issueNumber: source.issueNumber, title: source.title.trim(), workUnitKey: key.key, body: normalizeIssueScopeBody(source.body, source) });
}

/** OWN-DELIVERY (.github#92). The authenticated owner (Code Worker) observes complete material
 * before and current; this pure evaluator decides only whether the related-work delta is exactly
 * the attempt's own PR and its own commits. It cannot authenticate caller objects: every
 * observation must come from the owner's verified timeline and git readbacks.
 * The semantic guard (fingerprintDirectionFacts / triage compose) is unchanged; this is an
 * opt-in typed proof that the consumer evaluates alongside it.
 */
export const OWN_DELIVERY_PROOF_SCHEMA = "OwnDeliveryDirectionProofV1" as const;
export interface DirectionPublication { repository: string; sourceCommit: string; payloadDigest: string; revision: number }
export interface RelatedWorkEntry {
  kind: "pull_request" | "issue" | "commit";
  repository: string;
  /** pull_request and issue. */
  number?: number;
  /** commit (full 40-hex). */
  sha?: string;
  /** Owner-observed per-entry material digest (state, title, body and similar). */
  materialFingerprint: string;
}
export interface RelatedWorkMaterial {
  coverage: "complete" | "incomplete" | "unknown";
  /** Must equal DirectionFacts.relatedWorkFingerprint of the same observation. */
  relatedWorkFingerprint: string;
  entries: RelatedWorkEntry[];
}
export interface DirectionSideObservation {
  facts: DirectionFacts;
  /** Coverage of the thread, decision, source and ownership facts. */
  coverage: "complete" | "incomplete" | "unknown";
  relatedWork: RelatedWorkMaterial;
  /** Owner-computed normalized issue scope for the observed subject (fingerprintIssueScope). */
  scopeFingerprint: string;
  publication: DirectionPublication;
}
export interface OwnDeliveryProof {
  schema: typeof OWN_DELIVERY_PROOF_SCHEMA;
  version: 1;
  subject: { repository: string; issueNumber: number };
  workUnitKey: string;
  attempt: { id: string; fence: number };
  pullRequest: { repository: string; number: number; headSha: string; reviewedHeadSha: string; mergedSha: string };
  /** Commits of the attempt's own delivery; must include headSha and mergedSha. */
  ownCommitShas: string[];
}
export interface OwnDeliveryObservation {
  proof: OwnDeliveryProof;
  before: DirectionSideObservation;
  current: DirectionSideObservation;
}
export interface OwnDeliveryExpectation {
  subject: { repository: string; issueNumber: number };
  workUnitKey: string;
  scopeFingerprint: string;
  attempt: { id: string; fence: number };
  /** The current published release the consumer is settling against. */
  publication: DirectionPublication;
}
export interface OwnDeliveryEquivalence {
  status: "own-delivery-only" | "refused";
  reasons: string[];
  /** Identities of own references that were added or whose material changed. */
  ownReferences: string[];
}

const OWN_SHA = /^(?!0{40}$)[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REPOSITORY = /^[^/\s]+\/[^/\s]+$/;
const RELATED_WORK_SENTINEL = `sha256:${"0".repeat(64)}`;
const ENTRY_KINDS = ["pull_request", "issue", "commit"] as const;

/** Refuses every observation that is not an exact, complete, own-only delta. Never throws. */
export function evaluateOwnDeliveryDirectionEquivalence(
  observation: OwnDeliveryObservation,
  expected: OwnDeliveryExpectation,
): OwnDeliveryEquivalence {
  const reasons = new Set<string>();
  const ownReferences = new Set<string>();
  try {
    const { proof, before, current } = observation;
    const sameRepository = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    const sameSubject = (a: { repository: string; issueNumber: number }, b: { repository: string; issueNumber: number }) =>
      sameRepository(a.repository, b.repository) && a.issueNumber === b.issueNumber;
    const validSubject = (v: unknown): v is { repository: string; issueNumber: number } =>
      !!v && typeof v === "object" && REPOSITORY.test((v as { repository: string }).repository)
      && Number.isSafeInteger((v as { issueNumber: number }).issueNumber) && (v as { issueNumber: number }).issueNumber >= 1;
    const canonicalEqual = (a: unknown, b: unknown) => canonicalPolicyJson(a) === canonicalPolicyJson(b);

    // Proof: typed, schema-versioned, and bound to the expected subject, work unit and attempt fence.
    const pr = proof?.pullRequest;
    const commits = proof?.ownCommitShas;
    const proofValid = proof?.schema === OWN_DELIVERY_PROOF_SCHEMA && proof.version === 1 && validSubject(proof.subject)
      && DIGEST.test(proof.workUnitKey) && !!proof.attempt && typeof proof.attempt.id === "string" && proof.attempt.id.trim().length > 0
      && Number.isSafeInteger(proof.attempt.fence) && proof.attempt.fence >= 1
      && !!pr && REPOSITORY.test(pr.repository) && Number.isSafeInteger(pr.number) && pr.number >= 1
      && OWN_SHA.test(pr.headSha) && OWN_SHA.test(pr.reviewedHeadSha) && OWN_SHA.test(pr.mergedSha)
      && Array.isArray(commits) && commits.every(sha => OWN_SHA.test(sha)) && new Set(commits).size === commits.length
      && commits.includes(pr.headSha) && commits.includes(pr.mergedSha);
    if (!proofValid) reasons.add("own_delivery_proof_invalid");
    if (proofValid) {
      if (pr.reviewedHeadSha !== pr.headSha) reasons.add("own_delivery_review_head_mismatch");
      if (!sameSubject(proof.subject, expected.subject) || proof.workUnitKey !== expected.workUnitKey) reasons.add("own_delivery_subject_mismatch");
      if (proof.attempt.id !== expected.attempt.id || proof.attempt.fence !== expected.attempt.fence) reasons.add("own_delivery_attempt_mismatch");
    }
    if (!canonicalEqual(current.publication, expected.publication)
      || expected.publication.revision !== CURRENT_TRIAGE_REVISION || expected.publication.repository !== "spencer-shadley/.github") {
      reasons.add("own_delivery_publication_mismatch");
    }

    const isOwn = (entry: RelatedWorkEntry) => proofValid && sameRepository(entry.repository, pr.repository)
      && (entry.kind === "pull_request" ? entry.number === pr.number
        : entry.kind === "commit" ? commits.includes(entry.sha ?? "") : false);
    const identity = (entry: RelatedWorkEntry) => `${entry.kind}:${entry.repository.toLowerCase()}#${entry.kind === "commit" ? entry.sha : entry.number}`;
    const indexed = (side: DirectionSideObservation): Map<string, RelatedWorkEntry> | null => {
      const map = new Map<string, RelatedWorkEntry>();
      for (const entry of side.relatedWork.entries) {
        const valid = ENTRY_KINDS.includes(entry.kind) && REPOSITORY.test(entry.repository) && DIGEST.test(entry.materialFingerprint)
          && (entry.kind === "commit" ? OWN_SHA.test(entry.sha ?? "") : Number.isSafeInteger(entry.number) && (entry.number as number) >= 1);
        if (!valid) { reasons.add("related_work_entries_invalid"); return null; }
        if (map.has(identity(entry))) { reasons.add("related_work_entries_invalid"); return null; }
        map.set(identity(entry), entry);
      }
      return map;
    };

    let entriesChanged = false;
    let opaqueChanged = before.facts.relatedWorkFingerprint !== current.facts.relatedWorkFingerprint;
    for (const side of [before, current]) {
      if (!validSubject(side.facts?.seed) || !sameSubject(side.facts.seed, expected.subject)) reasons.add("own_delivery_subject_mismatch");
      if (side.coverage !== "complete") reasons.add("direction_thread_coverage_incomplete");
      if (side.relatedWork?.coverage !== "complete") reasons.add("related_work_coverage_incomplete");
      if (side.relatedWork?.relatedWorkFingerprint !== side.facts?.relatedWorkFingerprint) reasons.add("related_work_binding_mismatch");
      // Title, body and normalized scope are substantive: both sides must equal the expected subject scope.
      if (side.scopeFingerprint !== expected.scopeFingerprint) reasons.add("scope_changed");
    }
    const beforeMap = indexed(before);
    const currentMap = indexed(current);
    if (beforeMap && currentMap) {
      for (const [id] of beforeMap) if (!currentMap.has(id)) reasons.add("related_work_removed");
      for (const [id, entry] of currentMap) {
        const prior = beforeMap.get(id);
        if (!prior) {
          entriesChanged = true;
          if (isOwn(entry)) ownReferences.add(id); else reasons.add("related_work_foreign_change");
        } else if (prior.materialFingerprint !== entry.materialFingerprint) {
          entriesChanged = true;
          // Own references may change state (open to merged); foreign references may not.
          if (isOwn(entry)) ownReferences.add(id); else reasons.add("related_work_foreign_change");
        }
      }
      if (entriesChanged !== opaqueChanged) reasons.add("related_work_unexplained_drift");
      if (opaqueChanged && ownReferences.size === 0) reasons.add("related_work_unexplained_drift");
    }
    // Everything except related-work fingerprint (seed, thread material and decisions,
    // source, ownership, creation cutoff) must be identical. Sentinel substitution reuses the
    // one canonical facts hash, so no second direction hashing path exists.
    const nonRelated = (facts: DirectionFacts) => fingerprintDirectionFacts({ ...facts, relatedWorkFingerprint: RELATED_WORK_SENTINEL });
    if (nonRelated(before.facts) !== nonRelated(current.facts)) reasons.add("non_related_direction_changed");
  } catch {
    reasons.add("own_delivery_observation_invalid");
  }
  return {
    status: reasons.size === 0 ? "own-delivery-only" : "refused",
    reasons: [...reasons].sort(),
    ownReferences: [...ownReferences].sort(),
  };
}
