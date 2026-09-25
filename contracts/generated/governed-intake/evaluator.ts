/**
 * Pure evaluator over the account-owned governed-intake contract (GovernedIntakeBodyV1).
 * Owns stable governed-work-unit identity, contract schema loading, and markdown evaluation.
 *
 * Imports no GitHub mutation machinery and requires no workspace discovery.
 */

import { createHash } from "node:crypto";
import governedContractJson from "./governed-intake-body.v1.json" with { type: "json" };

export type IntakeLadder = {
  id?: string;
  name?: string;
  heading: string;
  doctrine?: string;
  purpose?: string;
  columns: string[];
};

export type WorkUnitKeyContract = {
  heading: string;
  markerName: string;
  algorithm: string;
  markerTemplate: string;
  markerRegex: string;
  requiredMarkerCount: number;
  identityTuple: string[];
  normalization: {
    sequence: string;
    fixOwnerGitHubSlug: string;
    workType: string;
    canonicalWorkUnitIdentity: string;
  };
  serialization: string;
  canonicalIdentity: string;
  collisionHandling: string;
};

export type TaxonomyDispositionContract = {
  requiredAtEveryRank: boolean;
  evidenceCeiling: {
    allowedOnlyWhen: string;
    defaultTerminator: boolean;
  };
};

export type IntakeWorkType = {
  id: string;
  label: string;
  recordKind?: string;
  description: string;
  authority: string;
};

export type IntakeContract = {
  schema: string;
  version: number;
  description?: string;
  requiredHeadings: string[];
  workUnitKey: WorkUnitKeyContract;
  taxonomyRanks: string[];
  causalClimbColumns: string[];
  defectLadders: {
    prevention: IntakeLadder;
    detectHealRecover: IntakeLadder;
  };
  statusTokens: string[];
  workTypes: IntakeWorkType[];
  legacyWorkTypes?: string[];
  taxonomyDisposition?: TaxonomyDispositionContract;
  projections?: {
    markdown: string;
    yaml: string;
    yamlPublishTarget?: string;
    forbiddenLocalYaml: string;
  };
};

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`governed-intake-body: contract ${label} must be string[]`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new TypeError(`governed-intake-body: contract ${label} must be string[]`);
    }
    out.push(item);
  }
  return out;
}

function ladder(value: unknown, label: string): IntakeLadder {
  if (!value || typeof value !== "object") {
    throw new TypeError(`governed-intake-body: contract ${label} missing`);
  }
  const row: Record<string, unknown> = { ...value };
  if (typeof row.heading !== "string") {
    throw new TypeError(`governed-intake-body: contract ${label}.heading must be string`);
  }
  return {
    id: typeof row.id === "string" ? row.id : undefined,
    name: typeof row.name === "string" ? row.name : undefined,
    heading: row.heading,
    doctrine: typeof row.doctrine === "string" ? row.doctrine : undefined,
    purpose: typeof row.purpose === "string" ? row.purpose : undefined,
    columns: strings(row.columns, `${label}.columns`),
  };
}

function requiredString(row: Record<string, unknown>, field: string, label: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`governed-intake-body: contract ${label}.${field} must be a string`);
  }
  return value;
}

function parseWorkUnitKeyContract(value: unknown): WorkUnitKeyContract {
  if (!value || typeof value !== "object") {
    throw new TypeError("governed-intake-body: contract workUnitKey missing");
  }
  const row: Record<string, unknown> = { ...value };
  const normalizationValue = row.normalization;
  if (!normalizationValue || typeof normalizationValue !== "object") {
    throw new TypeError("governed-intake-body: contract workUnitKey.normalization missing");
  }
  const normalization: Record<string, unknown> = { ...normalizationValue };
  if (row.requiredMarkerCount !== 1) {
    throw new TypeError("governed-intake-body: contract workUnitKey.requiredMarkerCount must be 1");
  }
  const contract: WorkUnitKeyContract = {
    heading: requiredString(row, "heading", "workUnitKey"),
    markerName: requiredString(row, "markerName", "workUnitKey"),
    algorithm: requiredString(row, "algorithm", "workUnitKey"),
    markerTemplate: requiredString(row, "markerTemplate", "workUnitKey"),
    markerRegex: requiredString(row, "markerRegex", "workUnitKey"),
    requiredMarkerCount: row.requiredMarkerCount,
    identityTuple: strings(row.identityTuple, "workUnitKey.identityTuple"),
    normalization: {
      sequence: requiredString(normalization, "sequence", "workUnitKey.normalization"),
      fixOwnerGitHubSlug: requiredString(
        normalization,
        "fixOwnerGitHubSlug",
        "workUnitKey.normalization",
      ),
      workType: requiredString(normalization, "workType", "workUnitKey.normalization"),
      canonicalWorkUnitIdentity: requiredString(
        normalization,
        "canonicalWorkUnitIdentity",
        "workUnitKey.normalization",
      ),
    },
    serialization: requiredString(row, "serialization", "workUnitKey"),
    canonicalIdentity: requiredString(row, "canonicalIdentity", "workUnitKey"),
    collisionHandling: requiredString(row, "collisionHandling", "workUnitKey"),
  };
  if (contract.algorithm !== "sha256") {
    throw new TypeError("governed-intake-body: contract workUnitKey.algorithm must be sha256");
  }
  if (
    contract.identityTuple.join("\0") !==
    ["fixOwnerGitHubSlug", "workType", "canonicalWorkUnitIdentity"].join("\0")
  ) {
    throw new TypeError("governed-intake-body: contract workUnitKey.identityTuple is invalid");
  }
  return contract;
}

function parseWorkTypes(value: unknown): IntakeWorkType[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("governed-intake-body: contract workTypes missing or empty");
  }
  return value.map((item, i) => {
    if (!item || typeof item !== "object") {
      throw new TypeError(`governed-intake-body: contract workTypes[${i}] must be an object`);
    }
    const row = item as Record<string, unknown>;
    return {
      id: requiredString(row, "id", `workTypes[${i}]`),
      label: requiredString(row, "label", `workTypes[${i}]`),
      ...(typeof row.recordKind === "string" ? { recordKind: row.recordKind } : {}),
      description: requiredString(row, "description", `workTypes[${i}]`),
      authority: requiredString(row, "authority", `workTypes[${i}]`),
    };
  });
}

export function loadGovernedIntakeContract(contractSource?: string | URL | IntakeContract): IntakeContract {
  if (contractSource && typeof contractSource === "object" && !(contractSource instanceof URL)) {
    return contractSource as IntakeContract;
  }
  if (contractSource !== undefined) throw new TypeError("portable contract evaluator accepts a verified contract object, not a filesystem path");
  const raw: unknown = governedContractJson;
  if (!raw || typeof raw !== "object") {
    throw new TypeError("governed-intake-body: contract is not an object");
  }
  const body: Record<string, unknown> = { ...raw };
  const laddersRaw = body.defectLadders;
  if (!laddersRaw || typeof laddersRaw !== "object") {
    throw new TypeError("governed-intake-body: contract defectLadders missing");
  }
  const ladders: Record<string, unknown> = { ...laddersRaw };
  const projectionsRaw = body.projections;
  let projections: IntakeContract["projections"] | undefined;
  if (projectionsRaw && typeof projectionsRaw === "object") {
    const p: Record<string, unknown> = { ...projectionsRaw };
    if (typeof p.markdown === "string" && typeof p.yaml === "string" && typeof p.forbiddenLocalYaml === "string") {
      projections = {
        markdown: p.markdown,
        yaml: p.yaml,
        yamlPublishTarget: typeof p.yamlPublishTarget === "string" ? p.yamlPublishTarget : undefined,
        forbiddenLocalYaml: p.forbiddenLocalYaml,
      };
    }
  }

  let taxonomyDisposition: TaxonomyDispositionContract | undefined;
  if (body.taxonomyDisposition && typeof body.taxonomyDisposition === "object") {
    const td: Record<string, unknown> = { ...(body.taxonomyDisposition as Record<string, unknown>) };
    const ec = td.evidenceCeiling && typeof td.evidenceCeiling === "object"
      ? (td.evidenceCeiling as Record<string, unknown>)
      : {};
    taxonomyDisposition = {
      requiredAtEveryRank: Boolean(td.requiredAtEveryRank),
      evidenceCeiling: {
        allowedOnlyWhen: typeof ec.allowedOnlyWhen === "string" ? ec.allowedOnlyWhen : "evidence is genuinely unobtainable",
        defaultTerminator: Boolean(ec.defaultTerminator),
      },
    };
  }

  return {
    schema: requiredString(body, "schema", "contract"),
    version: typeof body.version === "number" ? body.version : 1,
    description: typeof body.description === "string" ? body.description : undefined,
    requiredHeadings: strings(body.requiredHeadings, "requiredHeadings"),
    workUnitKey: parseWorkUnitKeyContract(body.workUnitKey),
    taxonomyRanks: strings(body.taxonomyRanks, "taxonomyRanks"),
    causalClimbColumns: strings(body.causalClimbColumns, "causalClimbColumns"),
    defectLadders: {
      prevention: ladder(ladders.prevention, "defectLadders.prevention"),
      detectHealRecover: ladder(ladders.detectHealRecover, "defectLadders.detectHealRecover"),
    },
    statusTokens: strings(body.statusTokens, "statusTokens"),
    workTypes: parseWorkTypes(body.workTypes),
    legacyWorkTypes: Array.isArray(body.legacyWorkTypes) ? strings(body.legacyWorkTypes, "legacyWorkTypes") : undefined,
    taxonomyDisposition,
    projections,
  };
}

export const DEFAULT_CONTRACT: IntakeContract = loadGovernedIntakeContract();
export const SCHEMA_VERSION = "governed-intake-body-v1";
export const REQUIRED_HEADINGS: readonly string[] = DEFAULT_CONTRACT.requiredHeadings;
export const TAXONOMY_RANKS: readonly string[] = DEFAULT_CONTRACT.taxonomyRanks;
export const CAUSAL_CLIMB_COLUMNS: readonly string[] = DEFAULT_CONTRACT.causalClimbColumns;
export const STATUS_TOKENS: readonly string[] = DEFAULT_CONTRACT.statusTokens;
export const DEFECT_LADDERS = DEFAULT_CONTRACT.defectLadders;
export const WORK_UNIT_KEY_CONTRACT = DEFAULT_CONTRACT.workUnitKey;
export const GOVERNED_WORK_TYPES: readonly IntakeWorkType[] = DEFAULT_CONTRACT.workTypes;
export const GOVERNED_WORK_TYPE_LABELS: readonly string[] = DEFAULT_CONTRACT.workTypes.map((wt) => wt.label);
export const GOVERNED_LEGACY_WORK_TYPES: readonly string[] = DEFAULT_CONTRACT.legacyWorkTypes ?? [];

export function escapeRegExp(s: string): string {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function normalizeLf(text: string): string {
  return (text || "").replaceAll("\r\n", "\n");
}

export function stripFrontmatter(markdown: string): string {
  const text = normalizeLf(markdown).replace(/^\u{FEFF}/u, "");
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return text;
  return text.slice(end + "\n---\n".length);
}

export type GovernedWorkUnitIdentity = {
  /** GitHub `owner/name` slug of the fix-owner repository. */
  fixOwnerGitHubSlug: string;
  /** The body's `## Work type` value (e.g. "Risk reduction", "Defect"). */
  workType: string;
  /** Smallest durable mechanism/outcome seam that names the work unit; stable across reruns. */
  canonicalWorkUnitIdentity: string;
};

function frameUtf8(value: string): string {
  return `${String(Buffer.byteLength(value, "utf8"))}:${value}`;
}

/**
 * Computes the governed work-unit key per `contracts/governed-intake-body.v1.json`'s
 * `workUnitKey` contract: normalize each tuple field (trim, NFC, then field-specific case rule),
 * frame each as `<utf8-byte-length>:<bytes>`, join with LF, SHA-256 the result.
 */
export function computeGovernedWorkUnitKey(identity: GovernedWorkUnitIdentity): string {
  const normalize = (value: string): string => value.trim().normalize("NFC");
  const owner = normalize(identity.fixOwnerGitHubSlug).toLowerCase();
  const workType = normalize(identity.workType).toLowerCase();
  const canonical = normalize(identity.canonicalWorkUnitIdentity);
  const serialized = [frameUtf8(owner), frameUtf8(workType), frameUtf8(canonical)].join("\n");
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

/** Renders the single `<!-- governed-work-unit-key: sha256:<hex> -->` marker for a body. */
export function renderGovernedWorkUnitKeyMarker(identity: GovernedWorkUnitIdentity): string {
  return `<!-- governed-work-unit-key: sha256:${computeGovernedWorkUnitKey(identity)} -->`;
}

export type ValidateGovernedWorkUnitKeyResult = {
  ok: boolean;
  key: string | null;
  digest: string | null;
  reason: "missing" | "malformed" | "multiple" | "placeholder" | null;
  markerCount: number;
  isPlaceholder?: boolean;
};

export type ValidateWorkUnitKeyOptions = {
  allowPlaceholder?: boolean;
  contract?: IntakeContract;
};

export function validateGovernedWorkUnitKey(
  bodyMarkdown: string,
  options?: ValidateWorkUnitKeyOptions,
): ValidateGovernedWorkUnitKeyResult {
  const contract = options?.contract ?? DEFAULT_CONTRACT;
  const allowPlaceholder = options?.allowPlaceholder ?? false;
  const text = normalizeLf(bodyMarkdown || "");
  const comments = text.match(/<!--[\s\S]*?-->/g) ?? [];
  const candidates = comments.filter((comment) =>
    comment.includes(contract.workUnitKey.markerName)
  );
  const withoutClosedComments = text.replaceAll(/<!--[\s\S]*?-->/g, "");
  const danglingMarker = new RegExp(
    String.raw`<!--(?:(?!-->)[\s\S])*?${escapeRegExp(contract.workUnitKey.markerName)}`,
    "g",
  );
  const danglingCount = withoutClosedComments.match(danglingMarker)?.length ?? 0;
  const markerCount = candidates.length + danglingCount;

  if (markerCount === 0) {
    return {
      ok: false,
      key: null,
      digest: null,
      reason: "missing",
      markerCount: 0,
    };
  }
  if (markerCount !== contract.workUnitKey.requiredMarkerCount) {
    return {
      ok: false,
      key: null,
      digest: null,
      reason: "multiple",
      markerCount,
    };
  }
  if (candidates.length === 0) {
    return {
      ok: false,
      key: null,
      digest: null,
      reason: "malformed",
      markerCount,
    };
  }

  const candidate = (candidates[0] ?? "").trim();
  if (candidate === contract.workUnitKey.markerTemplate.trim()) {
    if (allowPlaceholder) {
      return {
        ok: true,
        key: `${contract.workUnitKey.algorithm}:placeholder`,
        digest: "placeholder",
        reason: null,
        markerCount: 1,
        isPlaceholder: true,
      };
    }
    return {
      ok: false,
      key: null,
      digest: null,
      reason: "placeholder",
      markerCount: 1,
      isPlaceholder: true,
    };
  }

  const match = new RegExp(contract.workUnitKey.markerRegex).exec(candidate);
  if (!match || typeof match[1] !== "string") {
    return {
      ok: false,
      key: null,
      digest: null,
      reason: "malformed",
      markerCount: 1,
    };
  }
  return {
    ok: true,
    key: `${contract.workUnitKey.algorithm}:${match[1]}`,
    digest: match[1],
    reason: null,
    markerCount: 1,
    isPlaceholder: false,
  };
}

export type IntakeValidationMode = "template" | "body";

export type IntakeValidationOptions = {
  mode?: IntakeValidationMode;
  contract?: IntakeContract;
};

export type IntakeValidationResult =
  | { ok: true; schemaVersion: string }
  | { ok: false; missing: string[]; schemaVersion: string };

export function sectionContent(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(String.raw`^##\s+${escapeRegExp(heading)}\s*$`, "i").test(line)
  );
  if (start === -1) return "";
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i] ?? "")) break;
    out.push(lines[i] ?? "");
  }
  return out.join("\n").replaceAll(/<!--[\s\S]*?-->/g, "").trim();
}

export function taxonomySection(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^##\s+Root-cause taxonomy and disposition\s*$/i.test(l));
  if (start === -1) return "";
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i] ?? "")) break;
    out.push(lines[i] ?? "");
  }
  return out.join("\n");
}

function extractCausalClimbSection(text: string, preventionHeading: string): string {
  const lines = text.split("\n");
  const endRe = new RegExp(String.raw`^(?:###?\s+)?(?:[A-Z]\.\s+)?${escapeRegExp(preventionHeading)}\s*$`, "i");
  const out: string[] = [];
  for (const line of lines) {
    if (endRe.test(line.trim())) break;
    out.push(line);
  }
  return out.join("\n");
}

function extractLadderSection(text: string, startHeading: string, endHeading?: string): string {
  const lines = text.split("\n");
  const startRe = new RegExp(String.raw`^(?:###?\s+)?(?:[A-Z]\.\s+)?${escapeRegExp(startHeading)}\s*$`, "i");
  const start = lines.findIndex((l) => startRe.test(l.trim()));
  if (start === -1) return "";
  const endRe = endHeading
    ? new RegExp(String.raw`^(?:###?\s+)?(?:[A-Z]\.\s+)?${escapeRegExp(endHeading)}\s*$`, "i")
    : null;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (endRe && endRe.test(line.trim())) break;
    if (/^##\s+/.test(line)) break;
    out.push(line);
  }
  return out.join("\n");
}

export type CausalRow = {
  rank: string;
  finding: string;
  disposition: string;
  reifiedAs: string;
  raw: string;
};

export function parseCausalRows(sectionText: string): CausalRow[] {
  const rows: CausalRow[] = [];
  for (const line of sectionText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || trimmed.includes("---")) continue;
    const cells = trimmed
      .split("|")
      .map((c) => c.trim())
      .slice(1, -1);
    if (cells.length < 4) continue;
    const rank = cells[0] ?? "";
    const finding = cells[1] ?? "";
    const disposition = cells[2] ?? "";
    const reifiedAs = cells[3] ?? "";
    if (/^rank$/i.test(rank)) continue;
    rows.push({ rank, finding, disposition, reifiedAs, raw: trimmed });
  }
  return rows;
}

function parseTableRows(sectionText: string): Array<{ rank: string; status: string; raw: string }> {
  const rows: Array<{ rank: string; status: string; raw: string }> = [];
  for (const line of sectionText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || trimmed.includes("---")) continue;
    const cells = trimmed
      .split("|")
      .map((c) => c.trim())
      .slice(1, -1);
    if (cells.length < 2) continue;
    const rank = cells[0] ?? "";
    const status = cells.at(-1) ?? "";
    if (/^rank$/i.test(rank)) continue;
    rows.push({ rank, status, raw: trimmed });
  }
  return rows;
}

const DECISION_CLAIM_TRIGGER_RES = [
  /decision\s+needed/i,
  /needs?\s+(?:spencer|the\s+operator|the\s+ceo)\b/i,
  /\byour\s+call\b/i,
  /\bonly\s+you\s+can\b/i,
  /\bauthori[sz]e?\b/i,
  /\bsign[- ]?off\b/i,
  /\bi\s+need\s+you\s+to\b/i,
  /\bneed\s+you\s+to\s+decide\b/i,
  /\bawaiting\s+(?:spencer|operator|ceo)\b/i,
  /\bplease\s+(?:advise|decide|authorize|authorise|approve|confirm)\b/i,
];

export function claimsOperatorDecision(section: string): boolean {
  return DECISION_CLAIM_TRIGGER_RES.some((re) => re.test(section));
}

const OPTION_LINE_RE = /^(?:[-*]|\d+[.)])\s+(\S.*)$/;
const OPTION_DOWNSIDE_RE = /\b(downside|cost|risk|trade-?off|harm|loses?|sacrific\w*|danger|hazard)\b/i;

function hasTwoOptionsWithDownsides(section: string): boolean {
  const items = section
    .split("\n")
    .map((line) => OPTION_LINE_RE.exec(line.trim())?.[1])
    .filter((item): item is string => typeof item === "string");
  return items.filter((item) => OPTION_DOWNSIDE_RE.test(item)).length >= 2;
}

const DOCTRINE_27_CATEGORY_RE =
  /(irreversib\w*|one-way\s?door|security\s+surface|safety\s+surface|external\s+(?:or\s+production\s+)?effect|production\s+effect|\bspend\b|destructive\s+ambiguity|only\s+(?:the\s+)?(?:operator|spencer|ceo)\s+holds|operator['’]?s?\s+intent)/i;

const FALLBACK_DEADLINE_RE =
  /\b(by\s+\d{4}-\d{2}-\d{2}|by\s+\d{1,2}(:\d{2})?\s*(am|pm)|within\s+\d+\s*(minute|hour|day|week)s?)/i;
const FALLBACK_ACTION_RE =
  /\bif\s+no\s+(?:answer|response)\b|\bno\s+response\b|\botherwise\b|\bdefault(?:s|ing)?\s+to\b|\bwill\s+proceed\s+with\b/i;

export function humanDecisionClaimGaps(section: string): string[] {
  const missing: string[] = [];
  if (!hasTwoOptionsWithDownsides(section)) {
    missing.push(
      "Human-decision state: at least two competing options, each naming its actual downside",
    );
  }
  if (!DOCTRINE_27_CATEGORY_RE.test(section)) {
    missing.push(
      "Human-decision state: which DOCTRINE §27 category makes this non-dominated " +
        "(irreversibility, a security/safety surface, external/production effect or spend, " +
        "destructive ambiguity, or intent only the operator holds)",
    );
  }
  if (!(FALLBACK_DEADLINE_RE.test(section) && FALLBACK_ACTION_RE.test(section))) {
    missing.push("Human-decision state: what happens if no answer comes, and by when");
  }
  return missing;
}

/**
 * Validates governed intake markdown under the account-wide contract.
 * Explicit validation modes:
 *   - "template": validates scaffolding, allows placeholders where expected.
 *   - "body": validates completed issue body evidence; rejects all placeholders.
 */
export function validateGovernedIntakeMarkdown(
  markdown: string,
  options?: IntakeValidationOptions,
): IntakeValidationResult {
  const mode = options?.mode ?? "template";
  const contract = options?.contract ?? DEFAULT_CONTRACT;
  const text = stripFrontmatter(markdown);
  const missing: string[] = [];

  for (const h of contract.requiredHeadings) {
    if (!new RegExp(String.raw`^##\s+` + escapeRegExp(h) + String.raw`\s*$`, "im").test(text)) {
      missing.push(`## ${h}`);
    }
  }

  const keyResult = validateGovernedWorkUnitKey(text, {
    allowPlaceholder: mode === "template",
    contract,
  });
  if (!keyResult.ok) {
    if (keyResult.reason === "missing") {
      missing.push("governed work-unit key marker");
    } else if (keyResult.reason === "placeholder") {
      missing.push("governed work-unit key marker: placeholders are not accepted in body admission");
    } else if (keyResult.reason === "multiple") {
      missing.push(`governed work-unit key marker: multiple markers found (${keyResult.markerCount})`);
    } else if (keyResult.reason === "malformed") {
      missing.push("governed work-unit key marker: malformed key digest");
    }
  }

  const lines = text.split("\n");
  if (mode === "template") {
    const hasRepo = lines.some((l) => /^\s*(?:[-*]\s+)?(?:\*\*)?repository(?:\*\*)?\s*:/i.test(l));
    const hasCommit = lines.some((l) => /^\s*(?:[-*]\s+)?(?:\*\*)?commit(?:\*\*)?\s*:/i.test(l));
    const hasPath = lines.some((l) => /^\s*(?:[-*]\s+)?(?:\*\*)?path(?:\*\*)?\s*:.*\.github\/ISSUE_TEMPLATE\//i.test(l))
      || /ISSUE_TEMPLATE\/task\.(md|ya?ml)/i.test(text);
    if (!(hasRepo && hasCommit && hasPath)) {
      missing.push("template provenance scaffold (repository, commit, path)");
    }
    const workTypeTemplateSection = (() => {
      const match = /^##\s+Work type\s*$([\s\S]*?)(?=^##\s+|(?![\s\S]))/im.exec(text);
      return match?.[1] ?? "";
    })();
    const legacyTypes = contract.legacyWorkTypes ?? ["Discovery / experiment", "Discovery/experiment"];
    for (const legacy of legacyTypes) {
      if (workTypeTemplateSection.toLowerCase().includes(legacy.toLowerCase())) {
        missing.push(`template must not contain legacy combined work type choice: "${legacy}"`);
      }
    }
    for (const wt of contract.workTypes) {
      if (!workTypeTemplateSection.includes(wt.label)) {
        missing.push(`template must include supported work type choice: "${wt.label}"`);
      }
    }
  } else {
    let repoVal: string | null = null;
    let commitVal: string | null = null;
    let pathVal: string | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim().replace(/^[-*]\s*/, "");
      const r = /^\*?\*?repository\*?\*?\s*:\s*(.+)$/i.exec(line);
      if (r) repoVal = r[1].trim();
      const c = /^\*?\*?commit\*?\*?\s*:\s*(.+)$/i.exec(line);
      if (c) commitVal = c[1].trim();
      const p = /^\*?\*?path\*?\*?\s*:\s*(.+)$/i.exec(line);
      if (p) pathVal = p[1].trim();
    }

    const clean = (s: string | null) => (s || "").replaceAll(/<!--[\s\S]*?-->/g, "").trim();
    const repoClean = clean(repoVal);
    const commitClean = clean(commitVal);
    const pathClean = clean(pathVal);

    const validRepo = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repoClean) && !repoClean.includes("<");
    const validCommit = /^[0-9a-fA-F]{7,40}$/.test(commitClean);
    const validPath = pathClean.includes(".github/ISSUE_TEMPLATE/") && !pathClean.includes("<");

    if (!validRepo) {
      missing.push("body provenance: repository must be a valid owner/repo slug without placeholders");
    }
    if (!validCommit) {
      missing.push("body provenance: commit must be a valid commit SHA without placeholders");
    }
    if (!validPath) {
      missing.push("body provenance: path must point under .github/ISSUE_TEMPLATE/ without placeholders");
    }
    const workTypeVal = sectionContent(text, "Work type").trim();
    if (!workTypeVal || workTypeVal.length === 0) {
      missing.push("Work type content (cannot be empty)");
    } else {
      const normalizedWorkType = workTypeVal.toLowerCase();
      const legacyTypes = (contract.legacyWorkTypes ?? ["Discovery / experiment", "Discovery/experiment"]).map((t) => t.toLowerCase());
      if (legacyTypes.some((legacy) => normalizedWorkType === legacy || normalizedWorkType.includes(legacy))) {
        missing.push(
          `Work type "${workTypeVal}" uses deprecated combined choice; use "Exploration / design research" or "Experiment / evidence test"`,
        );
      } else {
        const matchingWorkType = contract.workTypes.find(
          (wt) => wt.label.toLowerCase() === normalizedWorkType,
        );
        if (!matchingWorkType) {
          missing.push(`Work type "${workTypeVal}" is unsupported; use one exact configured work type label`);
        } else if (matchingWorkType.id === "exploration") {
          const leaseContent = sectionContent(text, "Exact leases").trim();
          const whatNeeded = sectionContent(text, "What happened or what is needed?").trim();
          const details = sectionContent(text, "Relevant details").trim();
          const outcomeText = `${whatNeeded}\n${details}`;
          if (leaseContent && !leaseContent.toLowerCase().startsWith("n/a")) {
            missing.push(
              `Exploration / design research is read-only and cannot authorize implementation leases (found lease: "${leaseContent}")`,
            );
          }
          if (/\b(?:authorized|commissioned)\s+to\s+implement\b/i.test(outcomeText) || /\bimplementation\s+authority\s+(?:granted|approved)\b/i.test(outcomeText) || /\bimplement(?:ation|ed|ing)?\b/i.test(outcomeText)) {
            missing.push(
              "Exploration / design research cannot claim or infer implementation authority; implementation requires separate commissioning",
            );
          }
          if (!/\b(?:proposal|recommendation)\b/i.test(outcomeText)) {
            missing.push(
              "Exploration / design research must terminate at a proposal or recommendation, not an implementation outcome",
            );
          }
        } else if (matchingWorkType.id === "experiment") {
          const whatNeeded = sectionContent(text, "What happened or what is needed?").trim();
          const details = sectionContent(text, "Relevant details").trim();
          const combined = `${whatNeeded}\n${details}`;
          const requirements: Array<[string, RegExp]> = [
            ["falsifiable hypothesis", /\bfalsifiable\s+hypothesis\b/i],
            ["metrics", /\bmetrics?\b/i],
            ["reversible test", /\breversib\w*\b/i],
            ["authorized exposure boundary", /\bexposure\b/i],
            ["authorized effect boundary", /\beffects?\b/i],
            ["authorized budget boundary", /\bbudget\b/i],
            ["authorized privacy boundary", /\bprivacy\b/i],
            ["pre-existing authority reference", /\b(?:pre-existing|existing)\s+authority\b|\bauthority\s+(?:reference|receipt|charter|envelope)\b/i],
            ["TTL", /\bTTL\b|\btime[- ]to[- ]live\b|\bexpir(?:e|es|y|ation)\b/i],
            ["abort criteria", /\babort\b|\bstop\s+criteri(?:on|a)\b/i],
            ["cleanup/rollback plan", /\bcleanup\b|\broll\s*back\b|\brollback\b/i],
            ["result routing", /\bresults?\s+(?:routing|route|reported|sent|go(?:es)?\s+to)\b|\broute\s+(?:the\s+)?results?\b/i],
          ];
          const absent = requirements.filter(([, pattern]) => !pattern.test(combined)).map(([label]) => label);
          if (absent.length > 0) {
            missing.push(
              `Experiment / evidence test requires a bounded authorized envelope; missing: ${absent.join(", ")}`,
            );
          }
        }
      }
    }
  }

  const leases = sectionContent(text, "Exact leases");
  const trimmedLeases = (leases || "").trim();
  if (!leases || trimmedLeases.length === 0) {
    missing.push("Exact leases content (exact paths/resources or N/A — <reason>)");
  } else if (trimmedLeases === "N/A" || trimmedLeases === "N/A —" || trimmedLeases === "N/A -") {
    missing.push("Exact leases N/A requires a reason");
  } else if (mode === "body") {
    if (/<reason>/i.test(trimmedLeases) || /^N\/A\s*[—–-]\s*<.*>$/i.test(trimmedLeases)) {
      missing.push("Exact leases: placeholders are not accepted in body admission");
    }
  }

  const section = taxonomySection(text);
  if (!/\|/.test(section)) {
    missing.push("Root-cause taxonomy table");
  } else {
    const prevention = contract.defectLadders.prevention;
    const detect = contract.defectLadders.detectHealRecover;

    const causalSection = extractCausalClimbSection(section, prevention.heading);
    for (const rank of contract.taxonomyRanks) {
      if (!new RegExp(String.raw`\|\s*` + escapeRegExp(rank) + String.raw`\s*\|`, "i").test(causalSection)) {
        missing.push(`taxonomy rank row: ${rank}`);
      }
    }
    const causalHeader = `| ${contract.causalClimbColumns.join(" | ")} |`;
    if (!section.includes(causalHeader)) {
      missing.push(`causal climb columns: ${contract.causalClimbColumns.join(", ")}`);
    }
    if (section.includes("| Fix or next action |")) {
      missing.push("causal climb still uses Fix or next action; use Defect ladders A and B");
    }
    if (!section.includes(prevention.heading)) {
      missing.push(`Defect ladder A: ${prevention.heading}`);
    }
    if (!section.includes(detect.heading)) {
      missing.push(`Defect ladder B: ${detect.heading}`);
    }
    const preventionHeader = `| ${prevention.columns.join(" | ")} |`;
    const detectHeader = `| ${detect.columns.join(" | ")} |`;
    if (!section.includes(preventionHeader)) {
      missing.push(`prevention columns: ${prevention.columns.join(", ")}`);
    }
    if (!section.includes(detectHeader)) {
      missing.push(`detect/heal/recover columns: ${detect.columns.join(", ")}`);
    }

    const ladderASection = extractLadderSection(section, prevention.heading, detect.heading);
    const ladderBSection = extractLadderSection(section, detect.heading);

    for (const rank of contract.taxonomyRanks) {
      if (!new RegExp(String.raw`\|\s*` + escapeRegExp(rank) + String.raw`\s*\|`, "i").test(ladderASection)) {
        missing.push(`Defect ladder A rank row: ${rank}`);
      }
      if (!new RegExp(String.raw`\|\s*` + escapeRegExp(rank) + String.raw`\s*\|`, "i").test(ladderBSection)) {
        missing.push(`Defect ladder B rank row: ${rank}`);
      }
    }

    if (mode === "body") {
      const allowedStatus = new Set([
        ...contract.statusTokens,
        "immediate",
        "reordered-plan",
      ]);
      const causalRows = parseCausalRows(causalSection);
      const causalRowMap = new Map(
        causalRows.map((r) => [r.rank.toLowerCase(), r]),
      );

      const BARE_CEILING_RE =
        /^(?:CEO\s*(?:\/|-|—)?\s*terminal stop reason|terminal stop reason|evidence-ceiling(?:\s*(?:—|-)\s*CEO)?|bare evidence-ceiling|terminal systemic governance ceiling|CEO)$/i;
      const UNAVAILABLE_EVIDENCE_RE =
        /\b(unavailabl\w*|unobtainabl\w*|missing|lacking|no\s+(?:records|telemetry|logs|data|evidence|metrics)|purged|unrecorded|uninstrumented|absent)\b/i;
      const CONSTRAINT_ATTEMPT_RE =
        /\b(attempt\w*|constraint\w*|prevent\w*|limit\w*|restrict\w*|external|proprietary|permission|cannot|unable|retention|opaque|prohibit|blocked|barrier)\b/i;

      for (const rank of contract.taxonomyRanks) {
        const row = causalRowMap.get(rank.toLowerCase());
        if (!row) continue;

        const findingClean = row.finding.replaceAll(/<!--[\s\S]*?-->/g, "").trim();
        const dispClean = row.disposition.replaceAll(/<!--[\s\S]*?-->/g, "").trim();
        const reifiedClean = row.reifiedAs.replaceAll(/<!--[\s\S]*?-->/g, "").trim();

        if (findingClean.length === 0) {
          missing.push(`taxonomy rank ${rank} finding: must not be empty or placeholder`);
        }

        if (dispClean.length === 0) {
          missing.push(`taxonomy rank ${rank} disposition: missing real disposition`);
        } else if (!allowedStatus.has(dispClean)) {
          missing.push(`taxonomy rank ${rank} disposition invalid: "${dispClean}"`);
        }

        if (reifiedClean.length === 0) {
          missing.push(
            `taxonomy rank ${rank}: disposition "${dispClean}" requires a supporting artifact or specific evidentiary explanation`,
          );
        } else if (reifiedClean.toLowerCase() === rank.toLowerCase() || /^rank$/i.test(reifiedClean)) {
          missing.push(
            `taxonomy rank ${rank}: rank name alone does not justify stopping; must provide supporting artifact or evidentiary explanation`,
          );
        } else if (
          dispClean.toLowerCase() === "evidence-ceiling" ||
          reifiedClean.toLowerCase().includes("evidence-ceiling")
        ) {
          if (BARE_CEILING_RE.test(reifiedClean)) {
            missing.push(
              `taxonomy rank ${rank}: rejected bare evidence-ceiling ("${reifiedClean}") without supporting evidence`,
            );
          } else if (
            !UNAVAILABLE_EVIDENCE_RE.test(reifiedClean) ||
            !CONSTRAINT_ATTEMPT_RE.test(reifiedClean)
          ) {
            missing.push(
              `taxonomy rank ${rank}: evidence-ceiling requires identifying unavailable evidence and attempts or constraints preventing acquisition`,
            );
          }
        } else if (
          reifiedClean === "issue/plan" ||
          reifiedClean === "issue/plan or TBD — triage"
        ) {
          missing.push(
            `taxonomy rank ${rank}: placeholder "${reifiedClean}" is not an accepted artifact`,
          );
        } else if (dispClean.toUpperCase() === "N/A" && reifiedClean.length < 5) {
          missing.push(
            `taxonomy rank ${rank}: N/A requires specific evidentiary explanation`,
          );
        }
      }
      const rowsA = parseTableRows(ladderASection);
      for (const row of rowsA) {
        if (!allowedStatus.has(row.status)) {
          missing.push(`Defect ladder A rank ${row.rank} status invalid: "${row.status}"`);
        }
      }
      const rowsB = parseTableRows(ladderBSection);
      for (const row of rowsB) {
        if (!allowedStatus.has(row.status)) {
          missing.push(`Defect ladder B rank ${row.rank} status invalid: "${row.status}"`);
        }
      }
    }
  }

  if (mode === "template") {
    for (const token of contract.statusTokens) {
      if (!text.includes("`" + token + "`")) {
        missing.push(`status token: ${token}`);
      }
    }
    if (contract.taxonomyDisposition?.requiredAtEveryRank === false) {
      missing.push("taxonomy disposition must be required at every rank");
    }
    if (contract.taxonomyDisposition?.evidenceCeiling?.defaultTerminator === true) {
      missing.push("evidence-ceiling must not be configured as a default terminator");
    }
    if (!/every rank requires a real disposition/i.test(section)) {
      missing.push("taxonomy guidance must require a real disposition at every rank");
    }
    if (!/evidence is genuinely unobtainable/i.test(section)) {
      missing.push("taxonomy guidance must reserve evidence-ceiling for genuinely unobtainable evidence");
    }
    const defaultCeiling = section.split("\n").some((line) => {
      const columns = line.split("|").map((col) => col.trim().toLowerCase());
      return (columns[1] === "kingdom" || columns[1] === "domain") && columns[3] === "evidence-ceiling";
    });
    if (defaultCeiling) {
      missing.push("Kingdom/Domain must not default to evidence-ceiling");
    }
  } else {
    const rawDecisionSection = text.split("\n");
    const startIdx = rawDecisionSection.findIndex((l) => /^##\s+Human-decision state\s*$/i.test(l));
    let rawContent = "";
    if (startIdx !== -1) {
      const parts: string[] = [];
      for (let i = startIdx + 1; i < rawDecisionSection.length; i += 1) {
        if (/^##\s+/.test(rawDecisionSection[i] ?? "")) break;
        parts.push(rawDecisionSection[i] ?? "");
      }
      rawContent = parts.join("\n");
    }
    const cleanDecision = rawContent.replaceAll(/<!--[\s\S]*?-->/g, "").trim();
    if (cleanDecision.length === 0) {
      missing.push("Human-decision state content (cannot be empty or only placeholder comment)");
    } else if (claimsOperatorDecision(cleanDecision)) {
      missing.push(...humanDecisionClaimGaps(cleanDecision));
    }
  }

  return missing.length > 0
    ? { ok: false, missing, schemaVersion: SCHEMA_VERSION }
    : { ok: true, schemaVersion: SCHEMA_VERSION };
}

export function validateIssueTemplate(
  templateMarkdown: string,
  options?: Omit<IntakeValidationOptions, "mode">,
): IntakeValidationResult {
  return validateGovernedIntakeMarkdown(templateMarkdown, { ...options, mode: "template" });
}

export function validateGovernedIntakeBody(
  bodyMarkdown: string,
  options?: Omit<IntakeValidationOptions, "mode">,
): IntakeValidationResult {
  return validateGovernedIntakeMarkdown(bodyMarkdown, { ...options, mode: "body" });
}


export type ClassifiedWorkTypeResult =
  | { kind: "resolved"; workType: IntakeWorkType }
  | { kind: "unresolved"; reason: string; candidateTypes?: string[] };

export function classifyWorkTypeFromIntent(
  intentText: string,
  contract: IntakeContract = DEFAULT_CONTRACT,
): ClassifiedWorkTypeResult {
  const text = intentText.trim();
  const lower = text.toLowerCase();

  const isExplorationSignal = /\b(investigat\w*|research|explor\w*|proposal|recommendation|design\s+decision)\b/i.test(text);
  const isExperimentSignal = /\b(experiment\w*|hypothesis|empirical|treatment|control|ab\s+test|canary)\b/i.test(text);

  if (isExplorationSignal && isExperimentSignal) {
    return {
      kind: "unresolved",
      reason: "ambiguous intent contains conflicting signals for both exploration (proposal-only) and experiment (empirical test); preserves quarantine path",
      candidateTypes: ["Exploration / design research", "Experiment / evidence test"],
    };
  }

  if (isExplorationSignal) {
    const exploration = contract.workTypes.find((wt) => wt.id === "exploration");
    if (exploration) return { kind: "resolved", workType: exploration };
  }

  if (isExperimentSignal) {
    const experiment = contract.workTypes.find((wt) => wt.id === "experiment");
    if (experiment) return { kind: "resolved", workType: experiment };
  }

  for (const wt of contract.workTypes) {
    if (lower.includes(wt.label.toLowerCase()) || lower.includes(wt.id.toLowerCase())) {
      return { kind: "resolved", workType: wt };
    }
  }

  return {
    kind: "unresolved",
    reason: "unsupported or ambiguous work type intent; preserves quarantine path",
  };
}
