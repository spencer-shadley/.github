#!/usr/bin/env node
/**
 * Canonical account-wide renderer and same-repository projection writer.
 * Origin: Code #4975; custody moved by spencer-shadley/.github#13.
 *
 * Edit the contract here, increment its numeric revision when semantic or
 * projection bytes change, then run this file and --check in the same change.
 * Native GitHub inheritance distributes the live form. There is no publish-copy
 * step. Consumers may use the pure renderers from the verified offline release;
 * only the .github producer checkout may write projections.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { validateChecklistRelease, type ChecklistItem } from "./governed-intake-triage-state.migrate.ts";
import policy from "./governed-intake-triage-policy.v1.json" with { type: "json" };

const THIS_FILE = fileURLToPath(import.meta.url);
const CONTRACTS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.join(CONTRACTS_DIR, "..");
export const CONTRACT_REL = "contracts/governed-intake-body.v1.json";

const STATUS_TOKEN_LINE =
  "Legal status tokens: `landed` | `assigned-issue` | `already-owned` | `inherited` | `N/A` | `evidence-ceiling` | `TBD — triage`. Every rank requires a real disposition; use `evidence-ceiling` only when evidence is genuinely unobtainable, never as a default terminator.";

function workUnitKeyGuidance(workUnitKey: {
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
}) {
  return [
    `Derive SHA-256 from the normalized tuple \`${workUnitKey.identityTuple.join(" + ")}\`.`,
    workUnitKey.normalization.sequence,
    workUnitKey.normalization.fixOwnerGitHubSlug,
    workUnitKey.normalization.workType,
    workUnitKey.normalization.canonicalWorkUnitIdentity,
    workUnitKey.serialization,
    workUnitKey.canonicalIdentity,
    workUnitKey.collisionHandling,
  ].join(" ");
}

const RANK_HINTS = {
  Subspecies: {
    finding: "this exact symptom",
    reified: "this issue",
    prevent: "control so this occurrence cannot recur",
    notice: "how this occurrence is noticed",
  },
  Species: {
    finding: "same mode + proximate cause elsewhere",
    reified: "issue/plan or TBD — triage",
    prevent: "class control across the same mode",
    notice: "how the class is detected",
  },
  Genus: {
    finding: "shared mechanism",
    reified: "issue/plan or TBD — triage",
    prevent: "mechanism cannot produce this species",
    notice: "how the mechanism is detected",
  },
  Family: {
    finding: "subsystem invariant",
    reified: "issue/plan or TBD — triage",
    prevent: "contract/boundary that forbids the mechanism",
    notice: "how the invariant breach is noticed",
  },
  Order: {
    finding: "architectural pattern",
    reified: "issue/plan or TBD — triage",
    prevent: "architecture that does not share the weakness",
    notice: "how the pattern failure is noticed",
  },
  Class: {
    finding: "standard/tool/prompt producing it",
    reified: "issue/plan or TBD — triage",
    prevent: "engineering-system change so tools cannot emit it",
    notice: "how the producing standard is detected",
  },
  Phylum: {
    finding: "ownership/lifecycle structure",
    reified: "issue/plan or TBD — triage",
    prevent: "org/process that owns the class",
    notice: "how ownership/lifecycle miss is noticed",
  },
  Kingdom: {
    finding: "incentive / reward shape",
    reified: "issue/plan or TBD — triage",
    prevent: "governance that does not reward this mode",
    notice: "how the incentive failure is noticed",
  },
  Domain: {
    finding: "optimization model",
    reified: "CEO / terminal stop reason",
    prevent: "objective that does not select for this class",
    notice: "how objective-model failure is noticed",
  },
};

function assertTriageChecklistContract(raw: ReturnType<typeof JSON.parse>) {
  const checklist = raw.triageChecklist;
  assert.ok(checklist && typeof checklist === "object", "triageChecklist missing");
  assert.equal(checklist.revisionSource, "version");
  assert.equal(checklist.fingerprintAlgorithm, "sha256");
  for (const field of ["heading", "sectionMarkerName", "itemMarkerName", "completionMarkerName", "triagedLabelPrefix"]) {
    assert.ok(typeof checklist[field] === "string" && checklist[field].length > 0, `triageChecklist.${field} missing`);
  }
  assert.ok(Array.isArray(checklist.pendingLabels));
  assert.ok(Array.isArray(checklist.triageOwnedLabelPatterns));
  assert.deepEqual(checklist.executionSubstrateLabels, ["cloud-ready", "local-required"]);
  for (const label of checklist.executionSubstrateLabels) assert.ok(checklist.triageOwnedLabelPatterns.includes(`^${label}$`));
  assert.ok(Array.isArray(checklist.items) && checklist.items.length > 0);
  const ids: string[] = checklist.items.map((item: ChecklistItem) => item.id);
  assert.equal(new Set(ids).size, ids.length, "triage checklist item ids must be unique");
  for (const item of checklist.items) {
    assert.match(item.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(typeof item.title === "string" && item.title.length > 0);
    assert.ok(typeof item.text === "string" && item.text.length > 0);
  }
  const order = validateChecklistRelease({ revision: raw.version, items: checklist.items });
  const scopeId = policy.workflow.scopeItemId;
  assert.ok(ids.includes(scopeId), "canonical scope-decomposition item is required");
  const preflight = ["canonical-flow", "value-direction", "fix-owner-responsibility", "dedup-queue-synergy"];
  const finals = ["priority-work-dimensions", "verify-human-required", "cloud-runnable"];
  for (const id of preflight) assert.ok(ids.indexOf(id) < ids.indexOf(scopeId), `${id} must precede ${scopeId}`);
  for (const id of finals) assert.ok(ids.indexOf(scopeId) < ids.indexOf(id), `${scopeId} must precede ${id}`);
  assert.ok(order.indexOf(scopeId) < order.indexOf("priority-work-dimensions"), "execution order must resolve scope before final attributes");
  const semantics = (item: ChecklistItem | undefined): Record<string, unknown> =>
    item?.semantics && typeof item.semantics === "object" && !Array.isArray(item.semantics)
      ? item.semantics as Record<string, unknown>
      : {};
  const scope = checklist.items.find((item: ChecklistItem) => item.id === scopeId);
  assert.equal(semantics(scope).childTriageRequiresParentStamp, false);
  assert.equal(semantics(scope).legacyProgressLabelRequired, false);
  const verify = checklist.items.find((item: ChecklistItem) => item.id === "verify-human-required");
  assert.deepEqual(semantics(verify).verifyFenceRequiredFor, ["ordinary-auto", "atomic-high-auto"]);
  assert.equal(semantics(verify).trackingParentInheritsChildVerify, false);
  assert.equal(raw.effortCalibration?.source, "contracts/governed-intake-triage-policy.v1.json");
  assert.equal(raw.effortCalibration?.preventionRcaDefault, undefined);
  assert.equal(raw.effortCalibration?.tipRedDefectDefault, undefined);
  assert.match(raw.effortCalibration?.description ?? "", /unknown, not low/);
}

export function loadContract(root = REPO_ROOT) {
  const filePath = path.join(root, CONTRACT_REL);
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  assert.equal(raw.schema, "GovernedIntakeBodyV1");
  assert.ok(
    Number.isInteger(raw.version) && raw.version > 0,
    "governed-intake-body version must be a positive integer",
  );
  assert.ok(Array.isArray(raw.requiredHeadings) && raw.requiredHeadings.length === 9);
  assert.equal(raw.workUnitKey?.heading, "Governed work-unit key");
  assert.equal(raw.workUnitKey?.markerName, "governed-work-unit-key");
  assert.equal(raw.workUnitKey?.algorithm, "sha256");
  assert.equal(
    raw.workUnitKey?.markerTemplate,
    "<!-- governed-work-unit-key: sha256:<64 lowercase hex> -->",
  );
  assert.equal(raw.workUnitKey?.requiredMarkerCount, 1);
  assert.deepEqual(raw.workUnitKey?.identityTuple, [
    "fixOwnerGitHubSlug",
    "workType",
    "canonicalWorkUnitIdentity",
  ]);
  const markerRegex = new RegExp(raw.workUnitKey?.markerRegex ?? "");
  assert.match(
    "<!-- governed-work-unit-key: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->",
    markerRegex,
  );
  assert.equal(
    markerRegex.test(
      "<!-- governed-work-unit-key: sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA -->",
    ),
    false,
  );
  assertTriageChecklistContract(raw);
  assert.equal(raw.projections?.featureMarkdown, "contracts/generated/governed-intake/feature.md");
  assert.equal(raw.projections?.featureYaml, ".github/ISSUE_TEMPLATE/feature.yml");
  assert.ok(Array.isArray(raw.taxonomyRanks) && raw.taxonomyRanks.length === 9);
  assert.deepEqual(raw.taxonomyRanks, [
    "Subspecies",
    "Species",
    "Genus",
    "Family",
    "Order",
    "Class",
    "Phylum",
    "Kingdom",
    "Domain",
  ]);
  assert.deepEqual(raw.causalClimbColumns, ["Rank", "Finding", "Disposition", "Reified as"]);
  assert.ok(raw.defectLadders?.prevention && raw.defectLadders?.detectHealRecover);
  assert.notEqual(
    raw.defectLadders.prevention.heading,
    raw.defectLadders.detectHealRecover.heading,
  );
  assert.ok(Array.isArray(raw.statusTokens) && raw.statusTokens.length === 7);
  assert.ok(Array.isArray(raw.workTypes) && raw.workTypes.length === 7);
  for (const wt of raw.workTypes) {
    assert.ok(typeof wt.id === "string" && wt.id.length > 0);
    assert.ok(typeof wt.label === "string" && wt.label.length > 0);
    assert.ok(typeof wt.description === "string" && wt.description.length > 0);
    assert.ok(typeof wt.authority === "string" && wt.authority.length > 0);
  }
  const exploration = raw.workTypes.find((wt: { id: string }) => wt.id === "exploration");
  assert.equal(exploration?.recordKind, "governance/exploration");
  const experiment = raw.workTypes.find((wt: { id: string }) => wt.id === "experiment");
  assert.equal(experiment?.recordKind, "evidence/experiment");
  assert.equal(raw.taxonomyDisposition?.requiredAtEveryRank, true);
  assert.equal(raw.taxonomyDisposition?.evidenceCeiling?.defaultTerminator, false);
  return raw;
}

export function normalizeLf(text) {
  return String(text ?? "").replaceAll("\r\n", "\n").replace(/^\uFEFF/, "");
}

export function extractYamlFieldLabels(yamlText) {
  const labels = [];
  for (const line of normalizeLf(yamlText).split("\n")) {
    const match = /^\s*label:\s*(?:["'](.+?)["']|(.+?))\s*$/.exec(line);
    if (match) labels.push((match[1] ?? match[2]).trim());
  }
  return labels;
}

function table(columns, rows) {
  const header = `| ${columns.join(" | ")} |`;
  const sep = `|${columns.map(() => "---").join("|")}|`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`);
  return [header, sep, ...body].join("\n");
}

function causalRows(contract) {
  return contract.taxonomyRanks.map((rank) => {
    const hint = RANK_HINTS[rank];
    const disposition = hint?.disposition ?? "<!-- disposition -->";
    return [
      rank,
      `<!-- ${hint.finding} -->`,
      disposition,
      hint.reified,
    ];
  });
}

function preventionRows(contract) {
  return contract.taxonomyRanks.map((rank) => {
    const hint = RANK_HINTS[rank];
    return [rank, `<!-- ${hint.prevent} -->`, "TBD — triage"];
  });
}

function detectRows(contract) {
  return contract.taxonomyRanks.map((rank) => {
    const hint = RANK_HINTS[rank];
    return [
      rank,
      `<!-- ${hint.notice} -->`,
      "<!-- heal/contain -->",
      "<!-- restore -->",
      "<!-- escalate if no progress -->",
      "TBD — triage",
    ];
  });
}

function ladderHeading(ladder) {
  return `${ladder.id}. ${ladder.heading}`;
}

function generatedBanner(contract) {
  return `<!-- Generated from contracts/governed-intake-body.v1.json (GovernedIntakeBodyV1 version ${contract.version}). Do not hand-edit; run: node --experimental-strip-types contracts/governed-intake-body.generate.ts -->`;
}

function triageChecklistLines(
  contract: ReturnType<typeof loadContract>,
  { includeHeading = true }: { includeHeading?: boolean } = {},
) {
  const checklist = contract.triageChecklist;
  const lines = [
    ...(includeHeading ? [`## ${checklist.heading}`] : []),
    `<!-- ${checklist.sectionMarkerName}: revision=${contract.version} -->`,
    "<!-- This checkbox block is the current triage-state SSOT. Check an item only after current evidence satisfies it. Do not delete or rename item markers. -->",
  ];
  for (const item of checklist.items) {
    lines.push(`<!-- ${checklist.itemMarkerName}: ${item.id} -->`);
    lines.push(`- [ ] **${item.title}**: ${item.text}`);
  }
  lines.push(`<!-- /${checklist.sectionMarkerName} -->`);
  return lines;
}

export function generateTaskMarkdown(contract) {
  const prevention = contract.defectLadders.prevention;
  const detect = contract.defectLadders.detectHealRecover;
  const workUnitKey = contract.workUnitKey;
  const causal = table(contract.causalClimbColumns, causalRows(contract));
  const preventionTable = table(prevention.columns, preventionRows(contract));
  const detectTable = table(detect.columns, detectRows(contract));

  return [
    "---",
    "name: Task / bug / feature",
    "about: Triage-ready issue — the autonomous pipeline authors a plan from this",
    "labels: agent-review, priority:triage-tbd, work:untriaged",
    "---",
    "",
    generatedBanner(contract),
    "",
    "## Work type",
    `<!-- ${contract.workTypes.map((wt: { label: string }) => wt.label).join(" | ")} -->`,
    "",
    `## ${workUnitKey.heading}`,
    `<!-- ${workUnitKeyGuidance(workUnitKey)} Before governed create, replace the placeholder digest below and leave exactly one marker in the body. -->`,
    workUnitKey.markerTemplate,
    "",
    "## What happened or what is needed?",
    "<!-- One paragraph. For bugs: symptom + repro. For features: the user-visible outcome. -->",
    "",
    "## Initial priority guess",
    "<!-- P0 candidate | P1 | P2 | P3 | P4 | P5.",
    "     Triage TODO: Consult docs/guides/issue-priority.md (Defect Evidence Scale / Economic Case) before selection.",
    "     Key rule: Non-crashing defects, performance debt, and resource leaks are capped at <= P2.",
    "     P0 candidate is strictly reserved for actively blocked critical paths without safe workarounds. -->",
    "",
    "## Why this initial priority?",
    "<!-- One short reason: current harm, urgency, expected value, or time saved (cite docs/guides/issue-priority.md defect scale: frequency x severity x urgency). -->",
    "",
    ...triageChecklistLines(contract),
    "",
    "## Relevant details",
    "<!-- Evidence, links, impact. When filing via cli-wrappers, fill provenance exactly: -->",
    "- repository: spencer-shadley/.github",
    "- commit: <!-- exact 40-character source commit from the admitted release -->",
    "- path: .github/ISSUE_TEMPLATE/task.yml",
    "",
    "## Exact leases",
    "<!-- Exact directories, files, and resources this change may mutate. If no lease applies, write an explicit N/A — <reason>. -->",
    "N/A — <reason>",
    "",
    "## Root-cause taxonomy and disposition",
    "<!-- Required by fleet DOCTRINE.md §14 / governed-intake-body-v1. Climb all nine ranks.",
    "     Use honest TBD — triage when a rank is not yet known — TBD is an open triage",
    "     obligation, not decoration. Cite §14; do not restate doctrine.",
    "     Causal climb columns are Rank, Finding, Disposition, Reified as.",
    "     Defects MUST complete ladders A (Prevention / never again) and B (Detect/heal/recover / §18)",
    "     as distinct structures. Do not keep a single Fix or next action column as the only action.",
    `     ${STATUS_TOKEN_LINE} -->`,
    "",
    causal,
    "",
    `### ${ladderHeading(prevention)}`,
    "<!-- Required for Defects. Other work types may use N/A per row. Preventive control at each §14 rank. -->",
    "",
    preventionTable,
    "",
    `### ${ladderHeading(detect)}`,
    "<!-- Required for Defects. Other work types may use N/A per row. If it still happens: notice, heal, restore, escalate. -->",
    "",
    detectTable,
    "",
    "At planning/closure, every rank requires a real disposition and an acted-on artifact or an explicit evidence-backed reason for delegation, non-action, unsupported scope, or evidence ceiling. Evidence ceiling is reserved for genuinely unobtainable evidence, not a default terminator. Defects also require both ladders at each rank.",
    "",
    "## Durable fix and acceptance",
    "<!-- Bullet list the loop's verify gate can check. The better this is, the likelier a clean",
    "     autonomous fix. -->",
    "",
    "## Human-decision state",
    "<!-- No human decision required | Decision needed: <exact question for Spencer> -->",
    "",
  ].join("\n");
}

function yamlQuote(value) {
  return JSON.stringify(value);
}

function yamlMultiline(text, indent) {
  const pad = " ".repeat(indent);
  return normalizeLf(text)
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => (line.length ? pad + line : ""))
    .join("\n");
}

function slug(heading) {
  return heading
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

export function generateTaskYaml(contract) {
  const prevention = contract.defectLadders.prevention;
  const detect = contract.defectLadders.detectHealRecover;
  const workUnitKey = contract.workUnitKey;
  const causal = table(contract.causalClimbColumns, causalRows(contract));
  const preventionTable = table(prevention.columns, preventionRows(contract));
  const detectTable = table(detect.columns, detectRows(contract));
  const taxonomyDefault = [
    causal,
    "",
    `### ${ladderHeading(prevention)}`,
    "",
    preventionTable,
    "",
    `### ${ladderHeading(detect)}`,
    "",
    detectTable,
  ].join("\n");
  const triageDefault = triageChecklistLines(contract, { includeHeading: false }).join("\n");

  const intro = [
    `Generated projection of spencer-shadley/.github \`contracts/governed-intake-body.v1.json\` (GovernedIntakeBodyV1 version ${contract.version}).`,
    "This form is generated beside its semantic source in spencer-shadley/.github and inherited natively.",
    "Normal consumer repositories must not carry local issue-template or chooser overrides.",
    "Priority is an initial guess, not a self-assignment. Triage cadence is runtime schedule configuration, not semantic issue-template law.",
    "Defects must complete Prevention (never again, §14) and Detect/heal/recover (if it happens, §18) as distinct ladders — not a single Fix or next action column.",
    "Every governed create body must contain exactly one governed-work-unit-key HTML marker with the placeholder replaced by the derived digest.",
    STATUS_TOKEN_LINE,
  ].join("\n");

  return [
    `# Generated from contracts/governed-intake-body.v1.json (GovernedIntakeBodyV1 version ${contract.version}). Do not hand-edit; run:`,
    "#   node --experimental-strip-types contracts/governed-intake-body.generate.ts",
    "# Account producer: spencer-shadley/.github:.github/ISSUE_TEMPLATE/task.yml",
    "name: Task / bug / feature",
    "description: Triage-ready issue — the autonomous pipeline authors a plan from this",
    "title: \"\"",
    "labels:",
    "  - agent-review",
    "  - priority:triage-tbd",
    "  - work:untriaged",
    "body:",
    "  - type: markdown",
    "    attributes:",
    "      value: |",
    yamlMultiline(intro, 8),
    "",
    "  - type: dropdown",
    `    id: ${slug("Work type")}`,
    "    attributes:",
    `      label: ${yamlQuote("Work type")}`,
    "      options:",
    ...contract.workTypes.map((wt: { label: string }) => `        - ${wt.label}`),
    "    validations:",
    "      required: true",
    "",
    "  - type: textarea",
    `    id: ${slug(workUnitKey.heading)}`,
    "    attributes:",
    `      label: ${yamlQuote(workUnitKey.heading)}`,
    "      description: |",
    yamlMultiline(workUnitKeyGuidance(workUnitKey), 8),
    `      placeholder: ${yamlQuote(workUnitKey.markerTemplate)}`,
    "    validations:",
    "      required: true",
    "",
    "  - type: textarea",
    `    id: ${slug("What happened or what is needed?")}`,
    "    attributes:",
    `      label: ${yamlQuote("What happened or what is needed?")}`,
    `      description: ${yamlQuote("One paragraph. For bugs: symptom + repro. For features: the user-visible outcome.")}`,
    "    validations:",
    "      required: true",
    "",
    "  - type: dropdown",
    `    id: ${slug("Initial priority guess")}`,
    "    attributes:",
    `      label: ${yamlQuote("Initial priority guess")}`,
    "      description: This starts triage only. P0 is a candidate, not a self-assigned emergency. Non-crashing defects, performance debt, and resource leaks are capped at <= P2.",
    "      options:",
    "        - P0 candidate",
    "        - P1",
    "        - P2",
    "        - P3",
    "        - P4",
    "        - P5",
    "    validations:",
    "      required: true",
    "",
    "  - type: input",
    `    id: ${slug("Why this initial priority?")}`,
    "    attributes:",
    `      label: ${yamlQuote("Why this initial priority?")}`,
    "      description: One short reason (current harm, urgency, expected value, or time saved).",
    "      placeholder: One-line reason",
    "    validations:",
    "      required: true",
    "",
    "  - type: textarea",
    `    id: ${slug(contract.triageChecklist.heading)}`,
    "    attributes:",
    `      label: ${yamlQuote(contract.triageChecklist.heading)}`,
    "      description: Current governed triage-state SSOT. Triage checks boxes in the persisted issue body; do not delete item markers.",
    "      value: |",
    yamlMultiline(triageDefault, 8),
    "    validations:",
    "      required: true",
    "",
    "  - type: textarea",
    `    id: ${slug("Relevant details")}`,
    "    attributes:",
    `      label: ${yamlQuote("Relevant details")}`,
    "      description: |",
    "        Evidence, links, impact. When filing via cli-wrappers, fill provenance exactly:",
    "        repository, commit (>=7-char SHA), path.",
    "    validations:",
    "      required: true",
    "",
    "  - type: textarea",
    `    id: ${slug("Exact leases")}`,
    "    attributes:",
    `      label: ${yamlQuote("Exact leases")}`,
    "      description: |",
    "        Exact directories, files, and resources this change may mutate.",
    "        If no lease applies, write an explicit N/A — <reason>.",
    "      placeholder: Exact paths/resources, or N/A — <reason>",
    "    validations:",
    "      required: true",
    "",
    "  - type: textarea",
    `    id: ${slug("Root-cause taxonomy and disposition")}`,
    "    attributes:",
    `      label: ${yamlQuote("Root-cause taxonomy and disposition")}`,
    "      description: |",
    "        Climb all nine DOCTRINE §14 ranks. Causal columns: Rank, Finding, Disposition, Reified as.",
    "        Defects complete ladders A (Prevention — never again) and B (Detect/heal/recover — if it still happens).",
    `        ${STATUS_TOKEN_LINE}`,
    "      value: |",
    yamlMultiline(taxonomyDefault, 8),
    "    validations:",
    "      required: true",
    "",
    "  - type: textarea",
    `    id: ${slug("Durable fix and acceptance")}`,
    "    attributes:",
    `      label: ${yamlQuote("Durable fix and acceptance")}`,
    "      description: Bullet list the loop's verify gate can check.",
    "    validations:",
    "      required: true",
    "",
    "  - type: textarea",
    `    id: ${slug("Human-decision state")}`,
    "    attributes:",
    `      label: ${yamlQuote("Human-decision state")}`,
    "      description: No human decision required, or Decision needed with the exact question for Spencer.",
    "      value: No human decision required",
    "    validations:",
    "      required: true",
    "",
  ].join("\n");
}

export function generateFeatureMarkdown(contract) {
  const workUnitKey = contract.workUnitKey;
  return [
    "---",
    "name: Feature / engineering leverage",
    "about: Concise feature, leverage, risk-reduction, or discovery item for triage",
    "labels: agent-review, priority:triage-tbd, work:untriaged",
    "---",
    "",
    generatedBanner(contract),
    "",
    "Machine and triage intake use the governed task body and checklist from this producer.",
    "This feature chooser is not a second checklist, cadence schedule, or registry/shed form.",
    "",
    "## Work type",
    `<!-- ${contract.workTypes.map((wt: { label: string }) => wt.label).join(" | ")} -->`,
    "",
    `## ${workUnitKey.heading}`,
    `<!-- ${workUnitKeyGuidance(workUnitKey)} Before governed create, replace the placeholder digest below and leave exactly one marker in the body. -->`,
    workUnitKey.markerTemplate,
    "",
    "## What happened or what is needed?",
    "<!-- The user-visible outcome, engineering time returned, harm reduced, or decision to unlock. -->",
    "",
    "## Initial priority guess",
    "<!-- P0 candidate | P1 | P2 | P3 | P4 | P5. Priority is an initial guess, not a self-assignment. -->",
    "",
    "## Why this initial priority?",
    "<!-- One short reason: current harm, urgency, expected value, or time saved. -->",
    "",
    "## Relevant details",
    "<!-- Optional evidence, links, impact. Do not attach a private shed, cadence, or fleet-registry checklist here. -->",
    "",
    "## Human-decision state",
    "<!-- No human decision required | Decision needed: <exact question for Spencer> -->",
    "No human decision required",
    "",
  ].join("\n");
}

export function generateFeatureYaml(contract) {
  const workUnitKey = contract.workUnitKey;
  const intro = [
    `Generated projection of spencer-shadley/.github \`contracts/governed-intake-body.v1.json\` (GovernedIntakeBodyV1 version ${contract.version}).`,
    "File the smallest useful description. Priority is an initial guess, not a self-assignment.",
    "Machine and triage intake use the governed task body and checklist from this producer.",
    "This feature chooser is not a second checklist, runtime cadence, or registry/shed form.",
    "Normal consumer repositories must not carry local issue-template or chooser overrides.",
    "Every governed create body must contain exactly one governed-work-unit-key HTML marker with the placeholder replaced by the derived digest.",
  ].join("\n");
  return [
    `# Generated from contracts/governed-intake-body.v1.json (GovernedIntakeBodyV1 version ${contract.version}). Do not hand-edit; run:`,
    "#   node --experimental-strip-types contracts/governed-intake-body.generate.ts",
    "# Account producer: spencer-shadley/.github:.github/ISSUE_TEMPLATE/feature.yml",
    "name: Feature / engineering leverage",
    "description: File a concise feature, leverage, risk-reduction, or discovery item for triage.",
    "title: \"\"",
    "labels:",
    "  - agent-review",
    "  - priority:triage-tbd",
    "  - work:untriaged",
    "body:",
    "  - type: markdown",
    "    attributes:",
    "      value: |",
    yamlMultiline(intro, 8),
    "",
    "  - type: dropdown",
    `    id: ${slug("Work type")}`,
    "    attributes:",
    `      label: ${yamlQuote("Work type")}`,
    "      options:",
    ...contract.workTypes.map((wt: { label: string }) => `        - ${wt.label}`),
    "    validations:",
    "      required: true",
    "",
    "  - type: textarea",
    `    id: ${slug(workUnitKey.heading)}`,
    "    attributes:",
    `      label: ${yamlQuote(workUnitKey.heading)}`,
    "      description: |",
    yamlMultiline(workUnitKeyGuidance(workUnitKey), 8),
    `      placeholder: ${yamlQuote(workUnitKey.markerTemplate)}`,
    "    validations:",
    "      required: true",
    "",
    "  - type: textarea",
    `    id: ${slug("What happened or what is needed?")}`,
    "    attributes:",
    `      label: ${yamlQuote("What happened or what is needed?")}`,
    `      description: ${yamlQuote("The user-visible outcome, engineering time returned, harm reduced, or decision to unlock.")}`,
    "    validations:",
    "      required: true",
    "",
    "  - type: dropdown",
    `    id: ${slug("Initial priority guess")}`,
    "    attributes:",
    `      label: ${yamlQuote("Initial priority guess")}`,
    "      description: This starts triage only. P0 is a candidate, not a self-assigned emergency.",
    "      options:",
    "        - P0 candidate",
    "        - P1",
    "        - P2",
    "        - P3",
    "        - P4",
    "        - P5",
    "    validations:",
    "      required: true",
    "",
    "  - type: input",
    `    id: ${slug("Why this initial priority?")}`,
    "    attributes:",
    `      label: ${yamlQuote("Why this initial priority?")}`,
    "      description: One short reason (current harm, urgency, expected value, or time saved).",
    "      placeholder: One-line reason",
    "    validations:",
    "      required: true",
    "",
    "  - type: textarea",
    `    id: ${slug("Relevant details")}`,
    "    attributes:",
    `      label: ${yamlQuote("Relevant details")}`,
    "      description: Optional evidence, links, or impact. Do not attach a private shed, cadence, or fleet-registry checklist here.",
    "    validations:",
    "      required: false",
    "",
    "  - type: textarea",
    `    id: ${slug("Human-decision state")}`,
    "    attributes:",
    `      label: ${yamlQuote("Human-decision state")}`,
    "      description: No human decision required, or Decision needed with the exact question for Spencer.",
    "      value: No human decision required",
    "    validations:",
    "      required: true",
    "",
  ].join("\n");
}

export function projectionPaths(root = REPO_ROOT) {
  const contract = loadContract(root);
  return {
    markdown: path.join(root, contract.projections.markdown),
    yaml: path.join(root, contract.projections.yaml),
    featureMarkdown: path.join(root, contract.projections.featureMarkdown),
    featureYaml: path.join(root, contract.projections.featureYaml),
    forbiddenLocalYaml: path.join(root, contract.projections.forbiddenLocalYaml),
  };
}

export function assertProducerCheckout(root = REPO_ROOT): void {
  const origin = execFileSync("git", ["remote", "get-url", "origin"], {
    cwd: root, encoding: "utf8", windowsHide: true,
  }).trim();
  assert.match(origin, /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)spencer-shadley\/\.github(?:\.git)?$/,
    "projection writes belong only to the spencer-shadley/.github producer checkout");
  assert.equal(loadContract(root).owner, "spencer-shadley/.github");
}

export function checkProjections(root = REPO_ROOT) {
  const contract = loadContract(root);
  const paths = projectionPaths(root);
  assert.equal(readFileSync(paths.markdown, "utf8"), generateTaskMarkdown(contract), "Markdown projection drift");
  assert.equal(readFileSync(paths.yaml, "utf8"), generateTaskYaml(contract), "live Issue Form projection drift");
  assert.equal(readFileSync(paths.featureMarkdown, "utf8"), generateFeatureMarkdown(contract), "feature Markdown projection drift");
  assert.equal(readFileSync(paths.featureYaml, "utf8"), generateFeatureYaml(contract), "feature Issue Form projection drift");
  return runSelfcheck(root);
}

export function writeProjections(root = REPO_ROOT) {
  assertProducerCheckout(root);
  const contract = loadContract(root);
  const markdown = generateTaskMarkdown(contract);
  const yaml = generateTaskYaml(contract);
  const featureMarkdown = generateFeatureMarkdown(contract);
  const featureYaml = generateFeatureYaml(contract);
  const paths = projectionPaths(root);
  mkdirSync(path.dirname(paths.markdown), { recursive: true });
  mkdirSync(path.dirname(paths.yaml), { recursive: true });
  mkdirSync(path.dirname(paths.featureMarkdown), { recursive: true });
  mkdirSync(path.dirname(paths.featureYaml), { recursive: true });
  writeFileSync(paths.markdown, markdown, "utf8");
  writeFileSync(paths.yaml, yaml, "utf8");
  writeFileSync(paths.featureMarkdown, featureMarkdown, "utf8");
  writeFileSync(paths.featureYaml, featureYaml, "utf8");
  return { markdown, yaml, featureMarkdown, featureYaml, paths };
}

function assertIncludes(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `${label}: missing ${JSON.stringify(needle)}`);
}

export function runSelfcheck(root = REPO_ROOT) {
  const contract = loadContract(root);
  const markdown = generateTaskMarkdown(contract);
  const yaml = generateTaskYaml(contract);

  for (const heading of contract.requiredHeadings) {
    assert.match(
      markdown,
      new RegExp(`^##\\s+${heading.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}\\s*$`, "m"),
      `md heading ${heading}`,
    );
  }
  assert.match(
    markdown,
    new RegExp(`^##\\s+${contract.workUnitKey.heading}\\s*$`, "m"),
    "md governed work-unit key heading",
  );
  assert.equal(
    markdown.split(contract.workUnitKey.markerTemplate).length - 1,
    contract.workUnitKey.requiredMarkerCount,
    "md must project exactly one governed work-unit marker placeholder",
  );
  for (const rank of contract.taxonomyRanks) assertIncludes(markdown, `| ${rank} |`, `md rank ${rank}`);
  for (const column of contract.causalClimbColumns) assertIncludes(markdown, column, `md causal column ${column}`);
  assertIncludes(markdown, contract.defectLadders.prevention.heading, "md prevention ladder");
  assertIncludes(markdown, contract.defectLadders.detectHealRecover.heading, "md detect ladder");
  for (const column of contract.defectLadders.prevention.columns) assertIncludes(markdown, column, `md prevention column ${column}`);
  for (const column of contract.defectLadders.detectHealRecover.columns) assertIncludes(markdown, column, `md detect column ${column}`);
  for (const token of contract.statusTokens) assertIncludes(markdown, `\`${token}\``, `md status token ${token}`);
  assert.equal(markdown.includes("| Fix or next action |"), false, "md must not use a single Fix or next action column");
  assert.equal(/\|\s*(Kingdom|Domain)\s*\|[^\n]*\|\s*evidence-ceiling\s*\|/i.test(markdown), false, "taxonomy must not default Kingdom or Domain to evidence-ceiling");

  const checklist = contract.triageChecklist;
  assertIncludes(markdown, `## ${checklist.heading}`, "md triage checklist heading");
  assertIncludes(markdown, `<!-- ${checklist.sectionMarkerName}: revision=${String(contract.version)} -->`, "md triage revision marker");
  assertIncludes(markdown, `<!-- /${checklist.sectionMarkerName} -->`, "md triage end marker");
  assertIncludes(yaml, `<!-- ${checklist.sectionMarkerName}: revision=${String(contract.version)} -->`, "yaml persisted triage revision marker");
  for (const item of checklist.items) {
    const marker = `<!-- ${checklist.itemMarkerName}: ${item.id} -->`;
    assert.equal(markdown.split(marker).length - 1, 1, `md triage item ${item.id} must be unique`);
    assert.equal(yaml.split(marker).length - 1, 1, `yaml triage item ${item.id} must be unique`);
    assertIncludes(markdown, `- [ ] **${item.title}**: ${item.text}`, `md triage item ${item.id}`);
    assertIncludes(yaml, `- [ ] **${item.title}**: ${item.text}`, `yaml triage item ${item.id}`);
  }
  assert.equal(markdown.includes("record completion in the receipt"), false, "mutable checklist must replace receipt-only completion claim");
  assert.equal(yaml.includes("at least every 30 minutes"), false, "semantic form must not own runtime cadence");

  const versionStamp = `GovernedIntakeBodyV1 version ${contract.version}`;
  assertIncludes(markdown, versionStamp, "md contract version stamp");
  assertIncludes(yaml, versionStamp, "yaml contract version stamp");

  const labels = extractYamlFieldLabels(yaml);
  const projectedHeadings = [
    contract.requiredHeadings[0],
    contract.workUnitKey.heading,
    ...contract.requiredHeadings.slice(1, 4),
    contract.triageChecklist.heading,
    ...contract.requiredHeadings.slice(4),
  ];
  assert.deepEqual(
    [...new Set(labels)],
    projectedHeadings,
    "yaml field labels must equal contract headings plus work-unit key and persisted triage checklist fields",
  );
  assert.equal(
    yaml.split(contract.workUnitKey.markerTemplate).length - 1,
    contract.workUnitKey.requiredMarkerCount,
    "yaml must project exactly one governed work-unit marker placeholder",
  );
  for (const rank of contract.taxonomyRanks) assertIncludes(yaml, `| ${rank} |`, `yaml rank ${rank}`);
  assertIncludes(yaml, contract.defectLadders.prevention.heading, "yaml prevention ladder");
  assertIncludes(yaml, contract.defectLadders.detectHealRecover.heading, "yaml detect ladder");
  assert.equal(yaml.includes("| Fix or next action |"), false, "yaml must not use a single Fix column");
  assert.equal(/\|\s*(Kingdom|Domain)\s*\|[^\n]*\|\s*evidence-ceiling\s*\|/i.test(yaml), false, "yaml must not default Kingdom or Domain to evidence-ceiling");

  for (const wt of contract.workTypes) {
    assertIncludes(markdown, wt.label, `md work type ${wt.label}`);
    assertIncludes(yaml, `- ${wt.label}`, `yaml work type ${wt.label}`);
  }
  assert.equal(markdown.includes("Discovery / experiment"), false, "md must not contain legacy combined option");
  assert.equal(yaml.includes("Discovery / experiment"), false, "yaml must not contain legacy combined option");
  const itemIds: string[] = checklist.items.map((item: { id: string }) => item.id);
  assert.ok(itemIds.indexOf("scope-decomposition") > itemIds.indexOf("dedup-queue-synergy"), "scope item follows value/dedup");
  assert.ok(itemIds.indexOf("scope-decomposition") < itemIds.indexOf("priority-work-dimensions"), "scope item precedes final attributes");
  assert.match(markdown, /Child triage does not wait for a parent completion stamp/);
  assert.match(yaml, /qualified `effort:high` atomic leaves/);
  assert.equal(markdown.includes("The triage role does not plan, decompose, mint, or commission implementation writers."), false);
  assert.equal(JSON.stringify(contract.effortCalibration).includes("preventionRcaDefault"), false);
  assert.equal(JSON.stringify(contract.effortCalibration).includes("tipRedDefectDefault"), false);

  const featureMarkdown = generateFeatureMarkdown(contract);
  const featureYaml = generateFeatureYaml(contract);
  assertIncludes(featureMarkdown, versionStamp, "feature md contract version stamp");
  assertIncludes(featureYaml, versionStamp, "feature yaml contract version stamp");
  for (const wt of contract.workTypes) {
    assertIncludes(featureMarkdown, wt.label, `feature md work type ${wt.label}`);
    assertIncludes(featureYaml, `- ${wt.label}`, `feature yaml work type ${wt.label}`);
  }
  assert.equal(featureYaml.includes("Discovery / experiment"), false, "feature yaml must not contain legacy combined option");
  assert.equal(featureYaml.includes("at least every 30 minutes"), false, "feature form must not own runtime cadence");
  assert.equal(featureYaml.includes("FLEET-REGISTRY.md"), false, "feature form must not own private registry checklist");
  assert.equal(featureYaml.includes("shedAbovePct"), false, "feature form must not own shed checklist");
  assert.equal(featureMarkdown.includes("at least every 30 minutes"), false, "feature md must not own runtime cadence");

  const withoutDomain = markdown.replaceAll("| Domain |", "| Domaine |");
  const missingRanks = contract.taxonomyRanks.filter(
    (rank) => !new RegExp(String.raw`\|\s*` + rank + String.raw`\s*\|`).test(withoutDomain),
  );
  assert.ok(missingRanks.includes("Domain"), "negative fixture must drop Domain rank");

  return { ok: true, schema: contract.schema, version: contract.version };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE;
if (invokedDirectly) {
  if (process.argv.includes("--check")) {
    const result = checkProjections();
    console.log(`governed-intake-body.generate: projections match (${result.schema} v${result.version})`);
  } else if (process.argv.includes("--selfcheck")) {
    const result = runSelfcheck();
    console.log(`governed-intake-body.generate: selfcheck ok (${result.schema} v${result.version})`);
  } else if (process.argv.includes("--print-md")) {
    process.stdout.write(generateTaskMarkdown(loadContract()));
  } else if (process.argv.includes("--print-yaml")) {
    process.stdout.write(generateTaskYaml(loadContract()));
  } else {
    const { paths } = writeProjections();
    console.log(`governed-intake-body.generate: wrote ${paths.markdown}`);
    console.log(`governed-intake-body.generate: wrote ${paths.yaml}`);
    console.log(`governed-intake-body.generate: wrote ${paths.featureMarkdown}`);
    console.log(`governed-intake-body.generate: wrote ${paths.featureYaml}`);
  }
}
