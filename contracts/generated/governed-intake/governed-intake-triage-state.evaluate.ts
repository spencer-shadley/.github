/**
 * Pure, portable state evaluator for the governed triage checklist.
 * Code #5487 / #5476. This module is the semantic implementation; adapters
 * consume it instead of re-authoring checklist-state rules.
 */
import governedIntakeContractJson from "./governed-intake-body.v1.json" with { type: "json" };
import {
  applicableTightenedOrNewItemIds,
  formatCompatibleRevisionWarning,
  isRevisionInAcceptedRange,
  itemsAtRevision,
  parseRevisionCompatibility,
  type ChecklistItemSnapshot,
  type RevisionCompatibility,
} from "./governed-intake-revision-compatibility.ts";

type TriageChecklistItem = {
  id: string;
  title: string;
  text: string;
};

type TriageChecklistContract = {
  heading: string;
  revisionSource: "version";
  sectionMarkerName: string;
  itemMarkerName: string;
  completionMarkerName: string;
  fingerprintAlgorithm: "sha256";
  fingerprintScope: string;
  pendingLabels: string[];
  triagedLabelPrefix: string;
  triageOwnedLabelPatterns: string[];
  executionSubstrateLabels: string[];
  retiredExecutionSubstrateLabels: string[];
  items: TriageChecklistItem[];
};

type GovernedIntakeContract = {
  schema: string;
  version: number;
  requiredHeadings: string[];
  taxonomyRanks: string[];
  causalClimbColumns: string[];
  workUnitKey: { heading: string; markerTemplate: string };
  triageChecklist: TriageChecklistContract;
  revisionCompatibility?: unknown;
  workTypes?: Array<{ id: string; label: string; recordKind?: string; description?: string; authority?: string }>;
  legacyWorkTypes?: string[];
};

export type TriageChecklistReason =
  | "missing_checklist"
  | "duplicate_checklist"
  | "malformed_checklist"
  | "checklist_revision_mismatch"
  | "checklist_item_set_mismatch"
  | "unchecked_checklist_item"
  | "missing_completion_marker"
  | "duplicate_completion_marker"
  | "completion_revision_mismatch"
  | "fingerprint_mismatch"
  | "missing_triaged_stamp"
  | "stale_triaged_stamp"
  | "duplicate_triaged_stamp"
  | "pending_marker_present"
  | "retired_execution_substrate_label"
  | "semantic_evidence_required"
  | "semantic_evaluation_pending";

export interface TriageChecklistState {
  needs_triage: boolean;
  current_revision: number;
  current_triaged_label: string;
  checklist_revision: number | null;
  checklist_count: number;
  expected_item_ids: string[];
  observed_item_ids: string[];
  unchecked_item_ids: string[];
  malformed_item_ids: string[];
  completion_count: number;
  completion_revision: number | null;
  completion_fingerprint: string | null;
  expected_fingerprint: string | null;
  triaged_labels: string[];
  pending_labels: string[];
  execution_substrate_labels: string[];
  reasons: TriageChecklistReason[];
  /** Accepted older revisions stay complete. A mismatch is a warning, not a refusal. */
  warnings: string[];
}

export interface TriageEvaluationContext {
  repository?: string;
  issueNumber?: number;
  /** Test and caller override. Production evaluation uses the published declaration. */
  compatibility?: RevisionCompatibility;
}

const CONTRACT = governedIntakeContractJson as GovernedIntakeContract;

function assertContract(): TriageChecklistContract {
  if (CONTRACT.schema !== "GovernedIntakeBodyV1") {
    throw new Error(`unsupported governed intake schema: ${String(CONTRACT.schema)}`);
  }
  if (!Number.isInteger(CONTRACT.version) || CONTRACT.version < 1) {
    throw new Error(`invalid governed intake revision: ${String(CONTRACT.version)}`);
  }
  const checklist = CONTRACT.triageChecklist;
  if (!checklist || checklist.revisionSource !== "version" || checklist.fingerprintAlgorithm !== "sha256") {
    throw new Error("invalid governed triage checklist contract");
  }
  if (!Array.isArray(checklist.executionSubstrateLabels)
    || checklist.executionSubstrateLabels.length !== 0
    || !Array.isArray(checklist.retiredExecutionSubstrateLabels)) {
    throw new Error("governed triage checklist requires structured execution evidence, not substrate labels");
  }
  if (!Array.isArray(checklist.items) || checklist.items.length === 0) {
    throw new Error("governed triage checklist requires at least one item");
  }
  const ids = checklist.items.map((item) => item.id);
  if (ids.some((id) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("governed triage checklist item ids must be unique kebab-case strings");
  }
  return checklist;
}

export const GOVERNED_TRIAGE_CHECKLIST = assertContract();
export const CURRENT_TRIAGE_REVISION = CONTRACT.version;
export const CURRENT_TRIAGED_LABEL = `${GOVERNED_TRIAGE_CHECKLIST.triagedLabelPrefix}${String(CURRENT_TRIAGE_REVISION)}`;
const parsedCompatibility = parseRevisionCompatibility(CONTRACT);
if (!parsedCompatibility.ok) throw new Error(parsedCompatibility.messages.join("; "));
const PUBLISHED_COMPATIBILITY: RevisionCompatibility = parsedCompatibility.compatibility;

export function isAcceptedTriageRevision(revision: number, compatibility: RevisionCompatibility = PUBLISHED_COMPATIBILITY): boolean {
  return isRevisionInAcceptedRange(revision, CURRENT_TRIAGE_REVISION, compatibility);
}

function checklistSnapshots(): ChecklistItemSnapshot[] {
  return GOVERNED_TRIAGE_CHECKLIST.items.map((item) => ({ id: item.id, title: item.title, text: item.text }));
}
export const GOVERNED_INTAKE_REQUIRED_HEADINGS: readonly string[] = CONTRACT.requiredHeadings;
export const GOVERNED_TAXONOMY_RANKS: readonly string[] = CONTRACT.taxonomyRanks;
export const GOVERNED_CAUSAL_COLUMNS: readonly string[] = CONTRACT.causalClimbColumns;
export const GOVERNED_WORK_UNIT_HEADING = CONTRACT.workUnitKey.heading;
export const GOVERNED_WORK_UNIT_MARKER_TEMPLATE = CONTRACT.workUnitKey.markerTemplate;
export const GOVERNED_WORK_TYPES = (CONTRACT.workTypes ?? []) as readonly { id: string; label: string; recordKind?: string; description?: string; authority?: string }[];
export const GOVERNED_WORK_TYPE_LABELS: readonly string[] = GOVERNED_WORK_TYPES.map((wt) => wt.label);
export const GOVERNED_LEGACY_WORK_TYPES: readonly string[] = (CONTRACT.legacyWorkTypes ?? []) as readonly string[];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLf(value: string): string {
  return value.replaceAll("\r\n", "\n").replace(/^\uFEFF/, "");
}

function sectionStartRegex(flags = "g"): RegExp {
  return new RegExp(
    `<!--\\s*${escapeRegExp(GOVERNED_TRIAGE_CHECKLIST.sectionMarkerName)}:\\s*revision=(\\d+)\\s*-->`,
    flags,
  );
}

function sectionEndRegex(flags = "g"): RegExp {
  return new RegExp(
    `<!--\\s*\\/${escapeRegExp(GOVERNED_TRIAGE_CHECKLIST.sectionMarkerName)}\\s*-->`,
    flags,
  );
}

function itemMarkerRegex(flags = "g"): RegExp {
  return new RegExp(
    `<!--\\s*${escapeRegExp(GOVERNED_TRIAGE_CHECKLIST.itemMarkerName)}:\\s*([a-z0-9]+(?:-[a-z0-9]+)*)\\s*-->`,
    flags,
  );
}

function completionRegex(flags = "g"): RegExp {
  return new RegExp(
    `<!--\\s*${escapeRegExp(GOVERNED_TRIAGE_CHECKLIST.completionMarkerName)}:\\s*revision=(\\d+)\\s+fingerprint=(sha256:[0-9a-f]{64})\\s*-->`,
    flags,
  );
}

function triagedLabelRegex(): RegExp {
  return new RegExp(`^(?:${escapeRegExp(GOVERNED_TRIAGE_CHECKLIST.triagedLabelPrefix)}|triaged:v)(\\d+)$`, "i");
}

const TRIAGE_OWNED_LABEL_REGEXES = GOVERNED_TRIAGE_CHECKLIST.triageOwnedLabelPatterns.map(
  (pattern) => new RegExp(pattern, "i"),
);

export function isTriagedChecklistLabel(label: string): boolean {
  return triagedLabelRegex().test(label);
}

export function isTriageOwnedChecklistLabel(label: string): boolean {
  return isTriagedChecklistLabel(label) || TRIAGE_OWNED_LABEL_REGEXES.some((pattern) => pattern.test(label));
}

export function renderTriageChecklistBlock(options: { includeHeading?: boolean; checked?: boolean; revision?: number } = {}): string {
  const includeHeading = options.includeHeading !== false;
  const checkbox = options.checked === true ? "x" : " ";
  const revision = options.revision ?? CURRENT_TRIAGE_REVISION;
  if (!isAcceptedTriageRevision(revision)) {
    throw new Error(`cannot render triage checklist for unaccepted revision ${revision}`);
  }
  const items = itemsAtRevision(checklistSnapshots(), revision, CURRENT_TRIAGE_REVISION, PUBLISHED_COMPATIBILITY);
  const lines = [
    ...(includeHeading ? [`## ${GOVERNED_TRIAGE_CHECKLIST.heading}`] : []),
    `<!-- ${GOVERNED_TRIAGE_CHECKLIST.sectionMarkerName}: revision=${String(revision)} -->`,
    "<!-- This checkbox block is the current triage-state SSOT. Check an item only after current evidence satisfies it. Do not delete or rename item markers. -->",
  ];
  for (const item of items) {
    lines.push(`<!-- ${GOVERNED_TRIAGE_CHECKLIST.itemMarkerName}: ${item.id} -->`);
    lines.push(`- [${checkbox}] **${item.title}**: ${item.text}`);
  }
  lines.push(`<!-- /${GOVERNED_TRIAGE_CHECKLIST.sectionMarkerName} -->`);
  return lines.join("\n");
}

/** Unchecked canonical blocks for every accepted revision, used to strip scope metadata. */
export function acceptedChecklistBlocks(): string[] {
  const blocks: string[] = [];
  for (let revision = PUBLISHED_COMPATIBILITY.oldestAcceptedRevision; revision <= CURRENT_TRIAGE_REVISION; revision += 1) {
    blocks.push(renderTriageChecklistBlock({ includeHeading: false, checked: false, revision }));
  }
  return blocks;
}

export function renderTriageCompletionMarker(fingerprint: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(fingerprint)) {
    throw new Error(`invalid triage completion fingerprint: ${fingerprint}`);
  }
  return `<!-- ${GOVERNED_TRIAGE_CHECKLIST.completionMarkerName}: revision=${String(CURRENT_TRIAGE_REVISION)} fingerprint=${fingerprint} -->`;
}

function triageOwnedLabels(labels: readonly string[]): string[] {
  return [...new Set(labels.filter(
    (label) => !isTriagedChecklistLabel(label) && TRIAGE_OWNED_LABEL_REGEXES.some((pattern) => pattern.test(label)),
  ))].sort((left, right) => left.localeCompare(right));
}

export async function computeTriageStateFingerprint(body: string, labels: readonly string[]): Promise<string> {
  const withoutCompletion = normalizeLf(body || "").replace(completionRegex("g"), "");
  const normalizedBody = withoutCompletion
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .trim();
  const payload = JSON.stringify({ body: normalizedBody, labels: triageOwnedLabels(labels) });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

type ChecklistSection = { revision: number; content: string; closed: boolean };

function extractChecklistSections(body: string): ChecklistSection[] {
  const text = normalizeLf(body || "");
  const starts = [...text.matchAll(sectionStartRegex("g"))];
  const out: ChecklistSection[] = [];
  for (const start of starts) {
    const startIndex = start.index ?? 0;
    const contentStart = startIndex + start[0].length;
    const tail = text.slice(contentStart);
    const end = sectionEndRegex("").exec(tail);
    if (!end) {
      out.push({ revision: Number(start[1]), content: tail, closed: false });
      continue;
    }
    out.push({ revision: Number(start[1]), content: tail.slice(0, end.index), closed: true });
  }
  return out;
}

function checklistItems(section: string): {
  observed: string[];
  unchecked: string[];
  malformed: string[];
} {
  const lines = normalizeLf(section).split("\n");
  const observed: string[] = [];
  const unchecked: string[] = [];
  const malformed: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const marker = itemMarkerRegex("").exec(lines[index] ?? "");
    if (!marker?.[1]) continue;
    const id = marker[1];
    observed.push(id);
    const box = /^\s*-\s*\[([ xX])\]\s+/.exec(lines[index + 1] ?? "");
    if (!box) {
      malformed.push(id);
      continue;
    }
    if (box[1].toLowerCase() !== "x") unchecked.push(id);
  }
  return { observed, unchecked, malformed };
}

function canonicalStamp(revision: number): string {
  return `${GOVERNED_TRIAGE_CHECKLIST.triagedLabelPrefix}${String(revision)}`;
}

function stampRevision(label: string): { revision: number; canonical: boolean } | null {
  const match = triagedLabelRegex().exec(label);
  if (!match?.[1]) return null;
  const revision = Number(match[1]);
  return { revision, canonical: label === canonicalStamp(revision) };
}

export async function evaluateTriageChecklistStructure(
  body: string | null | undefined,
  labels: readonly string[],
  context?: TriageEvaluationContext,
): Promise<TriageChecklistState> {
  const text = body ?? "";
  const compatibility = context?.compatibility ?? PUBLISHED_COMPATIBILITY;
  const sections = extractChecklistSections(text);
  const sectionRevision = sections.length === 1 ? sections[0].revision : null;
  const sectionAccepted = sectionRevision !== null && isAcceptedTriageRevision(sectionRevision, compatibility);
  const activeSection = sectionAccepted ? sections[0] : null;
  const expectedItems = itemsAtRevision(
    checklistSnapshots(),
    activeSection ? sectionRevision! : CURRENT_TRIAGE_REVISION,
    CURRENT_TRIAGE_REVISION,
    compatibility,
  );
  const expectedIds = expectedItems.map((item) => item.id);
  const parsedItems = activeSection
    ? checklistItems(activeSection.content)
    : { observed: [], unchecked: [], malformed: [] };
  const reasons: TriageChecklistReason[] = [];

  if (sections.length === 0) reasons.push("missing_checklist");
  if (sections.length > 1) reasons.push("duplicate_checklist");
  if (sections.some((section) => !section.closed) || parsedItems.malformed.length > 0) {
    reasons.push("malformed_checklist");
  }
  if (sections.length > 0 && !sectionAccepted) reasons.push("checklist_revision_mismatch");

  const observedIds = parsedItems.observed;
  const itemSetMatches = observedIds.length === expectedIds.length
    && new Set(observedIds).size === observedIds.length
    && expectedIds.every((id) => observedIds.includes(id));
  if (activeSection && sectionRevision !== null && sectionRevision < CURRENT_TRIAGE_REVISION) {
    for (const id of applicableTightenedOrNewItemIds(compatibility, { labels, body: text })) {
      if (!parsedItems.unchecked.includes(id)) parsedItems.unchecked.push(id);
    }
  }
  if (activeSection && !itemSetMatches) reasons.push("checklist_item_set_mismatch");
  if (activeSection && parsedItems.unchecked.length > 0) reasons.push("unchecked_checklist_item");

  const completions = [...normalizeLf(text).matchAll(completionRegex("g"))];
  if (completions.length === 0) reasons.push("missing_completion_marker");
  if (completions.length > 1) reasons.push("duplicate_completion_marker");
  const completionRevision = completions.length === 1 ? Number(completions[0][1]) : null;
  const completionFingerprint = completions.length === 1 ? completions[0][2] : null;
  if (completionRevision !== null && (!isAcceptedTriageRevision(completionRevision, compatibility)
    || (sectionRevision !== null && completionRevision !== sectionRevision))) {
    reasons.push("completion_revision_mismatch");
  }

  const labelPattern = triagedLabelRegex();
  const triagedLabels = labels.filter((label) => labelPattern.test(label));
  const stamps = triagedLabels.map((label) => stampRevision(label));
  const stamp = stamps.length === 1 ? stamps[0] : null;
  if (triagedLabels.length === 0) reasons.push("missing_triaged_stamp");
  if (triagedLabels.length > 1) reasons.push("duplicate_triaged_stamp");
  if (stamps.some((parsed) => !parsed?.canonical || !isAcceptedTriageRevision(parsed.revision, compatibility)
    || (sectionRevision !== null && parsed.revision !== sectionRevision))) {
    reasons.push("stale_triaged_stamp");
  }

  const warnings: string[] = [];
  const revisionRefused = reasons.includes("checklist_revision_mismatch")
    || reasons.includes("completion_revision_mismatch")
    || reasons.includes("stale_triaged_stamp");
  const evaluatedRevisions = [sectionRevision, completionRevision, stamp?.canonical ? stamp.revision : null]
    .filter((revision): revision is number => revision !== null && isAcceptedTriageRevision(revision, compatibility));
  const uniqueEvaluated = [...new Set(evaluatedRevisions)];
  if (!revisionRefused && uniqueEvaluated.length === 1 && uniqueEvaluated[0] !== CURRENT_TRIAGE_REVISION) {
    warnings.push(formatCompatibleRevisionWarning(uniqueEvaluated[0], CURRENT_TRIAGE_REVISION, context ?? null));
  }

  const pendingLabels = GOVERNED_TRIAGE_CHECKLIST.pendingLabels.filter((label) => labels.includes(label));
  if (pendingLabels.length > 0) reasons.push("pending_marker_present");

  const executionSubstrateLabels = labels.filter((label) =>
    GOVERNED_TRIAGE_CHECKLIST.retiredExecutionSubstrateLabels.includes(label));
  if (executionSubstrateLabels.length) reasons.push("retired_execution_substrate_label");

  let expectedFingerprint: string | null = null;
  const structurallyComplete = Boolean(
    activeSection?.closed
    && itemSetMatches
    && parsedItems.unchecked.length === 0
    && parsedItems.malformed.length === 0,
  );
  if (structurallyComplete) {
    expectedFingerprint = await computeTriageStateFingerprint(text, labels);
    if (completionFingerprint !== null && completionFingerprint !== expectedFingerprint) {
      reasons.push("fingerprint_mismatch");
    }
  }

  return {
    needs_triage: reasons.length > 0,
    current_revision: CURRENT_TRIAGE_REVISION,
    current_triaged_label: CURRENT_TRIAGED_LABEL,
    checklist_revision: sections.length === 1 ? sections[0].revision : null,
    checklist_count: sections.length,
    expected_item_ids: expectedIds,
    observed_item_ids: observedIds,
    unchecked_item_ids: parsedItems.unchecked,
    malformed_item_ids: parsedItems.malformed,
    completion_count: completions.length,
    completion_revision: completionRevision,
    completion_fingerprint: completionFingerprint,
    expected_fingerprint: expectedFingerprint,
    triaged_labels: triagedLabels,
    pending_labels: pendingLabels,
    execution_substrate_labels: executionSubstrateLabels,
    reasons: [...new Set(reasons)],
    warnings,
  };
}

export function triageProjectionErrorMessage(state: TriageChecklistState): string {
  return `Refused triage completion projection: ${state.current_triaged_label} requires one current complete checklist and matching ${GOVERNED_TRIAGE_CHECKLIST.completionMarkerName} fingerprint; reasons=${state.reasons.join(",") || "unknown"}.`;
}


/** Public completion API: structural checks alone are not semantic triage completion. */
export async function evaluateTriageChecklistState(
  body: string,
  labels: readonly string[] = [],
  semanticInput?: Pick<import("./governed-intake-triage.compose.ts").ComposedTriageInput, "subject" | "evidence" | "priorChecklist" | "implementationReceiptId" | "directionImpact" | "directionObservation" | "taxonomyObservation" | "taskProfile">,
): Promise<TriageChecklistState & { semantic_reasons?: string[]; scope_resolved?: boolean }> {
  const structure = await evaluateTriageChecklistStructure(body, labels, semanticInput?.subject
    ? { repository: semanticInput.subject.repository, issueNumber: semanticInput.subject.issueNumber }
    : undefined);
  if (!semanticInput) return { ...structure, needs_triage: true,
    unchecked_item_ids: [...new Set([...structure.unchecked_item_ids, "scope-decomposition"])],
    reasons: [...new Set([...structure.reasons, "semantic_evidence_required" as const])],
    semantic_reasons: ["missing_semantic_evidence"], scope_resolved: false };
  const { evaluateGovernedIntakeTriage } = await import("./governed-intake-triage.compose.ts");
  const result = await evaluateGovernedIntakeTriage({ body, labels, ...semanticInput });
  const directionPending = result.reasons.some(reason => reason.startsWith("direction_") || reason === "no_impact_has_cohort_effects");
  const taxonomyPending = result.reasons.some(reason => reason.startsWith("taxonomy_"));
  const executionPending = result.reasons.some(reason => reason.startsWith("execution_"));
  const taskProfilePending = result.reasons.some(reason => reason.startsWith("task_profile_") || reason === "tracking_parent_task_profile" || reason === "task_label_projection_mismatch" || reason === "task_labels_without_profile");
  return { ...structure, needs_triage: result.needsTriage,
    unchecked_item_ids: [...new Set([...structure.unchecked_item_ids,
      ...(result.scopeResolved ? [] : ["scope-decomposition"]),
      ...(taskProfilePending ? ["task-profile"] : []),
      ...(executionPending ? ["cloud-runnable"] : []),
      ...(taxonomyPending ? ["priority-work-dimensions"] : []),
      ...(directionPending ? ["value-direction", "dedup-queue-synergy"] : [])])],
    reasons: result.needsTriage ? [...new Set([...structure.reasons, "semantic_evaluation_pending" as const])] : structure.reasons,
    semantic_reasons: result.reasons, scope_resolved: result.scopeResolved };
}
