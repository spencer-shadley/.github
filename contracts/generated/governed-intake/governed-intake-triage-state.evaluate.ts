/**
 * Pure, portable state evaluator for the governed triage checklist.
 * Code #5487 / #5476. This module is the semantic implementation; adapters
 * consume it instead of re-authoring checklist-state rules.
 */
import governedIntakeContractJson from "./governed-intake-body.v1.json" with { type: "json" };
import { stripDirectionReceiptMetadata, stripTrailingActorSignatures } from "./governed-intake-receipt-metadata.ts";

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
  fingerprintScopeV2?: string;
  completedState?: TriageChecklistCompletedStateContract;
  pendingLabels: string[];
  triagedLabelPrefix: string;
  triageOwnedLabelPatterns: string[];
  executionSubstrateLabels: string[];
  retiredExecutionSubstrateLabels: string[];
  items: TriageChecklistItem[];
};

export type TriageChecklistCompletedStateContract = {
  schema: "TriageChecklistCompletedStateV1";
  stateAttribute: string;
  obligationsMarkerName: string;
  linkLineTemplate: string;
  checklistUrlTemplate: string;
  checklistUrlFallback: string;
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
  /** "v1" (legacy full-body scope) or "v2" (checklist-canonical scope, code#7594). */
  completion_fingerprint_scope: "v1" | "v2" | null;
  expected_fingerprint: string | null;
  /** "open" (full checkbox block) or "complete" (TriageChecklistCompletedStateV1 link line). */
  checklist_state: "open" | "complete" | null;
  /** Per-obligation state of the active section, in either body state. */
  obligations: Record<string, "checked" | "unchecked">;
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
    `<!--\\s*${escapeRegExp(GOVERNED_TRIAGE_CHECKLIST.sectionMarkerName)}:\\s*revision=(\\d+)(?:\\s+state=(complete))?\\s*-->`,
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
    `<!--\\s*${escapeRegExp(GOVERNED_TRIAGE_CHECKLIST.completionMarkerName)}:\\s*revision=(\\d+)\\s+fingerprint=(sha256:[0-9a-f]{64})(?:\\s+scope=(v2))?\\s*-->`,
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

/** `scope: "v2"` marks a fingerprint from {@link computeTriageStateFingerprintV2} (code#7594). */
export function renderTriageCompletionMarker(fingerprint: string, options: { scope?: "v1" | "v2" } = {}): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(fingerprint)) {
    throw new Error(`invalid triage completion fingerprint: ${fingerprint}`);
  }
  const scope = options.scope === "v2" ? " scope=v2" : "";
  return `<!-- ${GOVERNED_TRIAGE_CHECKLIST.completionMarkerName}: revision=${String(CURRENT_TRIAGE_REVISION)} fingerprint=${fingerprint}${scope} -->`;
}

const COMPLETED_STATE: TriageChecklistCompletedStateContract = GOVERNED_TRIAGE_CHECKLIST.completedState ?? {
  schema: "TriageChecklistCompletedStateV1",
  stateAttribute: "state=complete",
  obligationsMarkerName: "governed-triage-obligations",
  linkLineTemplate: "Triage checklist done as of triage version {revision} at {completedAt}: [canonical checklist]({checklistUrl})",
  checklistUrlTemplate: "https://github.com/spencer-shadley/.github/blob/{sourceCommit}/contracts/governed-intake-body.v1.json",
  checklistUrlFallback: "https://github.com/spencer-shadley/.github/blob/master/contracts/governed-intake-body.v1.json",
};
export const TRIAGE_CHECKLIST_COMPLETED_STATE: Readonly<TriageChecklistCompletedStateContract> = COMPLETED_STATE;

export type TriageObligationState = "checked" | "unchecked";

/** Exact producer rendering only: fixed literals around one character class keep matching linear. */
function obligationsMarkerRegex(flags = ""): RegExp {
  return new RegExp(`^<!-- ${escapeRegExp(COMPLETED_STATE.obligationsMarkerName)}: ([a-z0-9=,-]+) -->$`, flags);
}

const CHECKLIST_URL_SHAPE = new RegExp(
  `^${escapeRegExp(COMPLETED_STATE.checklistUrlTemplate).replace(escapeRegExp("{sourceCommit}"), "[0-9a-f]{7,40}")}$`,
);

/** Only the producer contract URL (commit-pinned or the master fallback) is a canonical checklist link. */
const COMPLETED_LINK_PREFIX = COMPLETED_STATE.linkLineTemplate.slice(0, COMPLETED_STATE.linkLineTemplate.indexOf("{revision}"));

function isProducerChecklistUrl(url: string): boolean {
  return url === COMPLETED_STATE.checklistUrlFallback || CHECKLIST_URL_SHAPE.test(url);
}

/** Parses `id=checked,id=unchecked`; returns null for any malformed token or duplicate id. */
export function parseTriageObligations(value: string): Record<string, TriageObligationState> | null {
  const out: Record<string, TriageObligationState> = {};
  const tokens = value.split(",").map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) return null;
  for (const token of tokens) {
    const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)=(checked|unchecked)$/.exec(token);
    if (!match || match[1] in out) return null;
    out[match[1]] = match[2] as TriageObligationState;
  }
  return out;
}

/** Commit-pinned link to the producer contract that defines the revision; master when the commit is unknown. */
export function triageChecklistUrl(sourceCommit?: string | null): string {
  return sourceCommit && /^[0-9a-f]{7,40}$/.test(sourceCommit)
    ? COMPLETED_STATE.checklistUrlTemplate.replace("{sourceCommit}", sourceCommit)
    : COMPLETED_STATE.checklistUrlFallback;
}

function isoUtcSeconds(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid triage completion timestamp: ${String(value)}`);
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Renders the TriageChecklistCompletedStateV1 block (Spencer, Oct 30 2026; code#7594). */
export function renderCompletedTriageChecklistBlock(options: {
  completedAt: string | Date;
  checklistUrl?: string;
  revision?: number;
  obligations?: Readonly<Record<string, TriageObligationState>>;
  includeHeading?: boolean;
}): string {
  const revision = options.revision ?? CURRENT_TRIAGE_REVISION;
  const obligations = options.obligations
    ?? Object.fromEntries(GOVERNED_TRIAGE_CHECKLIST.items.map((item) => [item.id, "checked" as const]));
  const tokens = Object.entries(obligations).map(([id, state]) => `${id}=${state}`).join(",");
  const link = COMPLETED_STATE.linkLineTemplate
    .replace("{revision}", String(revision))
    .replace("{completedAt}", isoUtcSeconds(options.completedAt))
    .replace("{checklistUrl}", options.checklistUrl ?? triageChecklistUrl());
  return [
    ...(options.includeHeading === false ? [] : [`## ${GOVERNED_TRIAGE_CHECKLIST.heading}`]),
    `<!-- ${GOVERNED_TRIAGE_CHECKLIST.sectionMarkerName}: revision=${String(revision)} ${COMPLETED_STATE.stateAttribute} -->`,
    `<!-- ${COMPLETED_STATE.obligationsMarkerName}: ${tokens} -->`,
    link,
    `<!-- /${GOVERNED_TRIAGE_CHECKLIST.sectionMarkerName} -->`,
  ].join("\n");
}

function triageOwnedLabels(labels: readonly string[]): string[] {
  return [...new Set(labels.filter(
    (label) => !isTriagedChecklistLabel(label) && TRIAGE_OWNED_LABEL_REGEXES.some((pattern) => pattern.test(label)),
  ))].sort((left, right) => left.localeCompare(right));
}

async function hashTriageStateBody(body: string, labels: readonly string[]): Promise<string> {
  const normalizedBody = body
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .trim();
  const payload = JSON.stringify({ body: normalizedBody, labels: triageOwnedLabels(labels) });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

/** v1 (legacy) scope: the full body, including the checklist text. */
export async function computeTriageStateFingerprint(body: string, labels: readonly string[]): Promise<string> {
  // This checksum is structural integrity, not semantic subject authority. The
  // scope fingerprint separately binds receipt identity to the observed issue.
  const withoutCompletion = stripDirectionReceiptMetadata(normalizeLf(body || "")).replace(completionRegex("g"), "");
  return hashTriageStateBody(withoutCompletion, labels);
}

/**
 * v2 scope (code#7594): each checklist section, open or complete, is replaced by one canonical
 * revision + per-obligation line before hashing, so collapsing a fully checked checklist to its
 * completed-state link line keeps the same fingerprint.
 */
export async function computeTriageStateFingerprintV2(body: string, labels: readonly string[]): Promise<string> {
  const withoutCompletion = stripDirectionReceiptMetadata(normalizeLf(body || "")).replace(completionRegex("g"), "");
  return hashTriageStateBody(canonicalizeTriageChecklistSections(withoutCompletion), labels);
}

/** Replaces every closed checklist section with `governed-triage-checklist revision=N obligations=...`. */
export function canonicalizeTriageChecklistSections(body: string): string {
  const text = normalizeLf(body || "");
  let out = "";
  let cursor = 0;
  for (const section of extractChecklistSections(text)) {
    if (!section.closed) continue;
    const obligations = sectionObligations(section);
    const tokens = Object.keys(obligations).sort().map((id) => `${id}=${obligations[id]}`).join(",");
    out += text.slice(cursor, section.start)
      + `${GOVERNED_TRIAGE_CHECKLIST.sectionMarkerName} revision=${String(section.revision)} obligations=${tokens}`;
    cursor = section.end;
  }
  return out + text.slice(cursor);
}

/** A stamp also matches when the only change since it is a trailing run of structured actor-signature
 * paragraphs after the completion marker, with direction receipts ignored as usual (.github#108). Stamp writers
 * keep rendering the full-body digest, so stamps made before this tolerance keep their verdict. Any other text
 * change, including one before a trailing signature, still mismatches.
 */
async function signatureTolerantFingerprint(text: string, labels: readonly string[], scope: "v1" | "v2" = "v1"): Promise<string | null> {
  const unreceipted = stripDirectionReceiptMetadata(normalizeLf(text));
  const marker = completionRegex("").exec(unreceipted);
  if (!marker) return null;
  const tailStart = marker.index + marker[0].length;
  const tail = stripTrailingActorSignatures(unreceipted.slice(tailStart));
  if (tail === unreceipted.slice(tailStart)) return null;
  const candidate = unreceipted.slice(0, tailStart) + tail;
  return scope === "v2" ? computeTriageStateFingerprintV2(candidate, labels) : computeTriageStateFingerprint(candidate, labels);
}

type ChecklistSection = {
  revision: number;
  state: "open" | "complete";
  content: string;
  closed: boolean;
  /** Offsets of the start marker and of the end of the end marker in the LF-normalized body. */
  start: number;
  end: number;
};

function extractChecklistSections(body: string): ChecklistSection[] {
  const text = normalizeLf(body || "");
  const starts = [...text.matchAll(sectionStartRegex("g"))];
  const out: ChecklistSection[] = [];
  for (const start of starts) {
    const startIndex = start.index ?? 0;
    const contentStart = startIndex + start[0].length;
    const tail = text.slice(contentStart);
    const end = sectionEndRegex("").exec(tail);
    const state = start[2] === "complete" ? "complete" as const : "open" as const;
    if (!end) {
      out.push({ revision: Number(start[1]), state, content: tail, closed: false, start: startIndex, end: text.length });
      continue;
    }
    out.push({
      revision: Number(start[1]),
      state,
      content: tail.slice(0, end.index),
      closed: true,
      start: startIndex,
      end: contentStart + end.index + end[0].length,
    });
  }
  return out;
}

function sectionObligations(section: Pick<ChecklistSection, "content" | "state" | "revision">): Record<string, TriageObligationState> {
  const parsed = checklistItems(section);
  return Object.fromEntries(parsed.observed.map((id) => [
    id,
    parsed.unchecked.includes(id) || parsed.malformed.includes(id) ? "unchecked" as const : "checked" as const,
  ]));
}

/**
 * A completed-state section is valid only when it is byte-identical to the producer rendering of its own
 * parsed revision, obligations, timestamp and producer URL. Any other text inside it (prose, edited link
 * text, a foreign URL) makes it malformed, so it can neither verify nor be stripped from scope.
 */
function parseCompletedSection(section: Pick<ChecklistSection, "content" | "revision">): {
  obligations: Record<string, TriageObligationState>;
  completedAt: string;
  checklistUrl: string;
} | null {
  const lines = section.content.split("\n");
  if (lines.length !== 4 || lines[0] !== "" || lines[3] !== "") return null;
  const marker = obligationsMarkerRegex("").exec(lines[1] ?? "");
  const obligations = marker ? parseTriageObligations(marker[1]) : null;
  // Anchored on the fixed template prefix so a hostile line is rejected in linear time.
  const linkLine = lines[2] ?? "";
  const link = linkLine.startsWith(COMPLETED_LINK_PREFIX)
    ? /^\d+ at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z): \[[^\]\n]*\]\(([^)\s]+)\)$/.exec(linkLine.slice(COMPLETED_LINK_PREFIX.length))
    : null;
  if (!obligations || !link || !isProducerChecklistUrl(link[2])) return null;
  // A malformed timestamp is a malformed block, never a reader exception (code#7594 review).
  if (Number.isNaN(Date.parse(link[1]))) return null;
  const rendered = renderCompletedTriageChecklistBlock({
    revision: section.revision, obligations, completedAt: link[1], checklistUrl: link[2], includeHeading: false,
  }).split("\n");
  return rendered[1] === lines[1] && rendered[2] === lines[2]
    ? { obligations, completedAt: link[1], checklistUrl: link[2] }
    : null;
}

function completedChecklistItems(section: Pick<ChecklistSection, "content" | "revision">): {
  observed: string[];
  unchecked: string[];
  malformed: string[];
} {
  const parsed = parseCompletedSection(section);
  if (!parsed) return { observed: [], unchecked: [], malformed: ["completed-state-block"] };
  const observed = Object.keys(parsed.obligations);
  const unchecked = observed.filter((id) => parsed.obligations[id] === "unchecked");
  return { observed, unchecked, malformed: [] };
}

function checklistItems(section: Pick<ChecklistSection, "content" | "state" | "revision">): {
  observed: string[];
  unchecked: string[];
  malformed: string[];
} {
  if (section.state === "complete") return completedChecklistItems(section);
  const lines = normalizeLf(section.content).split("\n");
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
    ? checklistItems(activeSection)
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
  const completionScope = completions.length === 1 ? (completions[0][3] === "v2" ? "v2" as const : "v1" as const) : null;
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
    // A completed-state body can only carry a v2 fingerprint: the v1 scope hashes the checkbox text it replaced.
    const scope = completionScope ?? (activeSection?.state === "complete" ? "v2" : "v1");
    expectedFingerprint = scope === "v2"
      ? await computeTriageStateFingerprintV2(text, labels)
      : await computeTriageStateFingerprint(text, labels);
    if (completionFingerprint !== null && completionFingerprint !== expectedFingerprint) {
      if (await signatureTolerantFingerprint(text, labels, scope) === completionFingerprint) {
        expectedFingerprint = completionFingerprint;
      } else {
        reasons.push("fingerprint_mismatch");
      }
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
    completion_fingerprint_scope: completionScope,
    expected_fingerprint: expectedFingerprint,
    checklist_state: sections.length === 1 ? sections[0].state : null,
    obligations: activeSection ? sectionObligations(activeSection) : {},
    triaged_labels: triagedLabels,
    pending_labels: pendingLabels,
    execution_substrate_labels: executionSubstrateLabels,
    reasons: [...new Set(reasons)],
  };
}

/** Parsed checklist identity in either body state; null unless the body has exactly one checklist section. */
export function parseTriageChecklist(body: string | null | undefined): {
  revision: number;
  state: "open" | "complete";
  closed: boolean;
  obligations: Record<string, TriageObligationState>;
  completedAt: string | null;
  checklistUrl: string | null;
} | null {
  const sections = extractChecklistSections(body ?? "");
  if (sections.length !== 1) return null;
  const section = sections[0];
  const completed = section.state === "complete" ? parseCompletedSection(section) : null;
  return {
    revision: section.revision,
    state: section.state,
    closed: section.closed,
    obligations: sectionObligations(section),
    completedAt: completed?.completedAt ?? null,
    checklistUrl: completed?.checklistUrl ?? null,
  };
}

/**
 * Completion collapse (Spencer, Oct 30 2026; code#7594): replaces the single current-revision open
 * checklist whose every item is checked with the completed-state block. Any other body is returned
 * unchanged with its reason, so the full checklist stays while triage is open.
 */
export function collapseTriageChecklist(
  body: string,
  options: { completedAt: string | Date; checklistUrl?: string; sourceCommit?: string | null },
): { body: string; collapsed: boolean; reason: "collapsed" | "already_complete" | "not_collapsible" } {
  const text = normalizeLf(body || "");
  const sections = extractChecklistSections(text);
  if (sections.length === 1 && sections[0].state === "complete") return { body, collapsed: false, reason: "already_complete" };
  if (sections.length !== 1 || !sections[0].closed || sections[0].revision !== CURRENT_TRIAGE_REVISION) {
    return { body, collapsed: false, reason: "not_collapsible" };
  }
  const section = sections[0];
  const parsed = checklistItems(section);
  const expected = GOVERNED_TRIAGE_CHECKLIST.items.map((item) => item.id);
  const complete = parsed.unchecked.length === 0 && parsed.malformed.length === 0
    && parsed.observed.length === expected.length && expected.every((id) => parsed.observed.includes(id));
  if (!complete) return { body, collapsed: false, reason: "not_collapsible" };
  const block = renderCompletedTriageChecklistBlock({
    completedAt: options.completedAt,
    checklistUrl: options.checklistUrl ?? triageChecklistUrl(options.sourceCommit),
    obligations: Object.fromEntries(expected.map((id) => [id, "checked" as const])),
    includeHeading: false,
  });
  return { body: text.slice(0, section.start) + block + text.slice(section.end), collapsed: true, reason: "collapsed" };
}

/**
 * Reopen (code#7594): expands a completed-state block, or an older-revision open block, to the full
 * current-revision open checklist. Items in `reusedItemIds` (the delta planner's reused obligations)
 * keep their recorded state; without it a same-revision block keeps every recorded state (so a fully
 * checked completed block re-expands fully checked) and an older revision starts unchecked. New items
 * are always unchecked. A revision-bump reopen passes the delta planner's reused ids.
 */
export function expandTriageChecklist(
  body: string,
  options: { reusedItemIds?: readonly string[] } = {},
): { body: string; expanded: boolean } {
  const text = normalizeLf(body || "");
  const sections = extractChecklistSections(text);
  if (sections.length !== 1 || !sections[0].closed) return { body, expanded: false };
  const section = sections[0];
  if (section.state === "open" && section.revision === CURRENT_TRIAGE_REVISION) return { body, expanded: false };
  const prior = sectionObligations(section);
  const reuse = new Set(options.reusedItemIds ?? (section.revision === CURRENT_TRIAGE_REVISION ? Object.keys(prior) : []));
  const lines = [
    `<!-- ${GOVERNED_TRIAGE_CHECKLIST.sectionMarkerName}: revision=${String(CURRENT_TRIAGE_REVISION)} -->`,
    "<!-- This checkbox block is the current triage-state SSOT. Check an item only after current evidence satisfies it. Do not delete or rename item markers. -->",
  ];
  for (const item of GOVERNED_TRIAGE_CHECKLIST.items) {
    const checked = reuse.has(item.id) && prior[item.id] === "checked";
    lines.push(`<!-- ${GOVERNED_TRIAGE_CHECKLIST.itemMarkerName}: ${item.id} -->`);
    lines.push(`- [${checked ? "x" : " "}] **${item.title}**: ${item.text}`);
  }
  lines.push(`<!-- /${GOVERNED_TRIAGE_CHECKLIST.sectionMarkerName} -->`);
  return { body: text.slice(0, section.start) + lines.join("\n") + text.slice(section.end), expanded: true };
}

/**
 * True only for an exact producer-shaped completed-state block of the current revision with every
 * obligation checked. Scope normalization treats that block as metadata, like the canonical open
 * block, so collapsing on completion keeps the issue scope fingerprint unchanged (code#7594).
 */
export function isCanonicalCompletedTriageChecklistBlock(block: string): boolean {
  const text = normalizeLf(block);
  const sections = extractChecklistSections(text);
  if (sections.length !== 1) return false;
  const section = sections[0];
  if (section.state !== "complete" || !section.closed || section.start !== 0 || section.end !== text.length) return false;
  if (section.revision !== CURRENT_TRIAGE_REVISION) return false;
  // Exact re-render comparison (as the open-block path does): any foreign text keeps the block in scope.
  const parsed = parseCompletedSection(section);
  if (!parsed) return false;
  const ids = Object.keys(parsed.obligations);
  const expected = GOVERNED_TRIAGE_CHECKLIST.items.map((item) => item.id);
  return ids.length === expected.length
    && ids.every((id, index) => id === expected[index] && parsed.obligations[id] === "checked");
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
  const structure = await evaluateTriageChecklistStructure(body, labels);
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
