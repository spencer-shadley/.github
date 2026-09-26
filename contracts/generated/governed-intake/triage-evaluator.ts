/**
 * Pure, portable state evaluator for the governed triage checklist.
 * Code #5487 / #5476. This module is the semantic implementation; adapters
 * consume it instead of re-authoring checklist-state rules.
 */
import governedIntakeContractJson from "./governed-intake-body.v1.json" with { type: "json" };

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
  | "missing_execution_substrate_label"
  | "conflicting_execution_substrate_labels"
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
    || checklist.executionSubstrateLabels.length !== 2
    || new Set(checklist.executionSubstrateLabels).size !== 2
    || checklist.executionSubstrateLabels.some((label) => typeof label !== "string" || label.trim().length === 0)) {
    throw new Error("governed triage checklist requires exactly two distinct execution-substrate labels");
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
  return new RegExp(`^${escapeRegExp(GOVERNED_TRIAGE_CHECKLIST.triagedLabelPrefix)}(\\d+)$`, "i");
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

export function renderTriageChecklistBlock(options: { includeHeading?: boolean; checked?: boolean } = {}): string {
  const includeHeading = options.includeHeading !== false;
  const checkbox = options.checked === true ? "x" : " ";
  const lines = [
    ...(includeHeading ? [`## ${GOVERNED_TRIAGE_CHECKLIST.heading}`] : []),
    `<!-- ${GOVERNED_TRIAGE_CHECKLIST.sectionMarkerName}: revision=${String(CURRENT_TRIAGE_REVISION)} -->`,
    "<!-- This checkbox block is the current triage-state SSOT. Check an item only after current evidence satisfies it. Do not delete or rename item markers. -->",
  ];
  for (const item of GOVERNED_TRIAGE_CHECKLIST.items) {
    lines.push(`<!-- ${GOVERNED_TRIAGE_CHECKLIST.itemMarkerName}: ${item.id} -->`);
    lines.push(`- [${checkbox}] **${item.title}**: ${item.text}`);
  }
  lines.push(`<!-- /${GOVERNED_TRIAGE_CHECKLIST.sectionMarkerName} -->`);
  return lines.join("\n");
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

export async function evaluateTriageChecklistStructure(
  body: string | null | undefined,
  labels: readonly string[],
): Promise<TriageChecklistState> {
  const text = body ?? "";
  const expectedIds = GOVERNED_TRIAGE_CHECKLIST.items.map((item) => item.id);
  const sections = extractChecklistSections(text);
  const currentSections = sections.filter((section) => section.revision === CURRENT_TRIAGE_REVISION);
  const activeSection = currentSections.length === 1 ? currentSections[0] : null;
  const parsedItems = activeSection
    ? checklistItems(activeSection.content)
    : { observed: [], unchecked: [], malformed: [] };
  const reasons: TriageChecklistReason[] = [];

  if (sections.length === 0) reasons.push("missing_checklist");
  if (sections.length > 1) reasons.push("duplicate_checklist");
  if (sections.some((section) => !section.closed) || parsedItems.malformed.length > 0) {
    reasons.push("malformed_checklist");
  }
  if (sections.length > 0 && currentSections.length !== 1) reasons.push("checklist_revision_mismatch");

  const observedIds = parsedItems.observed;
  const itemSetMatches = observedIds.length === expectedIds.length
    && new Set(observedIds).size === observedIds.length
    && expectedIds.every((id) => observedIds.includes(id));
  if (activeSection && !itemSetMatches) reasons.push("checklist_item_set_mismatch");
  if (activeSection && parsedItems.unchecked.length > 0) reasons.push("unchecked_checklist_item");

  const completions = [...normalizeLf(text).matchAll(completionRegex("g"))];
  if (completions.length === 0) reasons.push("missing_completion_marker");
  if (completions.length > 1) reasons.push("duplicate_completion_marker");
  const completionRevision = completions.length === 1 ? Number(completions[0][1]) : null;
  const completionFingerprint = completions.length === 1 ? completions[0][2] : null;
  if (completionRevision !== null && completionRevision !== CURRENT_TRIAGE_REVISION) {
    reasons.push("completion_revision_mismatch");
  }

  const labelPattern = triagedLabelRegex();
  const triagedLabels = labels.filter((label) => labelPattern.test(label));
  const currentStampCount = triagedLabels.filter((label) => label === CURRENT_TRIAGED_LABEL).length;
  if (triagedLabels.length === 0) reasons.push("missing_triaged_stamp");
  if (triagedLabels.some((label) => label !== CURRENT_TRIAGED_LABEL)) reasons.push("stale_triaged_stamp");
  if (triagedLabels.length > 1 || currentStampCount > 1) reasons.push("duplicate_triaged_stamp");
  if (triagedLabels.length === 1 && currentStampCount !== 1 && !reasons.includes("stale_triaged_stamp")) {
    reasons.push("stale_triaged_stamp");
  }

  const pendingLabels = GOVERNED_TRIAGE_CHECKLIST.pendingLabels.filter((label) => labels.includes(label));
  if (pendingLabels.length > 0) reasons.push("pending_marker_present");

  const executionSubstrateLabels = [...new Set(
    labels.filter((label) => GOVERNED_TRIAGE_CHECKLIST.executionSubstrateLabels.includes(label)),
  )];
  if (executionSubstrateLabels.length === 0) reasons.push("missing_execution_substrate_label");
  if (executionSubstrateLabels.length > 1) reasons.push("conflicting_execution_substrate_labels");

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
  };
}

export function triageProjectionErrorMessage(state: TriageChecklistState): string {
  return `Refused triage completion projection: ${state.current_triaged_label} requires one current complete checklist and matching ${GOVERNED_TRIAGE_CHECKLIST.completionMarkerName} fingerprint; reasons=${state.reasons.join(",") || "unknown"}.`;
}


/** Public completion API: structural checks alone are not semantic triage completion. */
export async function evaluateTriageChecklistState(
  body: string,
  labels: readonly string[] = [],
  semanticInput?: Pick<import("./governed-intake-triage.compose.ts").ComposedTriageInput, "subject" | "evidence" | "priorChecklist" | "implementationReceiptId">,
): Promise<TriageChecklistState & { semantic_reasons?: string[]; scope_resolved?: boolean }> {
  const structure = await evaluateTriageChecklistStructure(body, labels);
  if (!semanticInput) return { ...structure, needs_triage: true,
    unchecked_item_ids: [...new Set([...structure.unchecked_item_ids, "scope-decomposition"])],
    reasons: [...new Set([...structure.reasons, "semantic_evidence_required" as const])],
    semantic_reasons: ["missing_semantic_evidence"], scope_resolved: false };
  const { evaluateGovernedIntakeTriage } = await import("./governed-intake-triage.compose.ts");
  const result = await evaluateGovernedIntakeTriage({ body, labels, ...semanticInput });
  return { ...structure, needs_triage: result.needsTriage,
    unchecked_item_ids: result.scopeResolved ? structure.unchecked_item_ids : [...new Set([...structure.unchecked_item_ids, "scope-decomposition"])],
    reasons: result.needsTriage ? [...new Set([...structure.reasons, "semantic_evaluation_pending" as const])] : structure.reasons,
    semantic_reasons: result.reasons, scope_resolved: result.scopeResolved };
}
