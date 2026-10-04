import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadContract,
  generateTaskMarkdown,
  generateTaskYaml,
  generateFeatureMarkdown,
  generateFeatureYaml,
  checkProjections,
} from "../contracts/governed-intake-body.generate.ts";
import {
  computeTriageStateFingerprint,
  evaluateTriageChecklistStructure,
  isTriagedChecklistLabel,
  isTriageOwnedChecklistLabel,
  renderTriageChecklistBlock,
  renderTriageCompletionMarker,
  CURRENT_TRIAGED_LABEL,
  CURRENT_TRIAGE_REVISION,
  GOVERNED_TRIAGE_CHECKLIST,
} from "../contracts/governed-intake-triage-state.evaluate.ts";
import {
  planChecklistDelta,
  type ChecklistRelease,
  type PriorChecklistEvidence,
} from "../contracts/governed-intake-triage-state.migrate.ts";
import {
  validateGovernedIntakeBody,
  computeGovernedWorkUnitKey,
  renderGovernedWorkUnitKeyMarker,
} from "../contracts/governed-intake-body.evaluate.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = loadContract(root);
const identity = {
  fixOwnerGitHubSlug: "spencer-shadley/.github",
  workType: "Task",
  canonicalWorkUnitIdentity: "candidate revision 23 release",
};

function validBody(): string {
  const ranks = contract.taxonomyRanks;
  return [
    "## Work type", "Task",
    "## Governed work-unit key", renderGovernedWorkUnitKeyMarker(identity),
    "## What happened or what is needed?", "Prepare candidate revision 23 release for accepted taxonomy.",
    "## Initial priority guess", "P2",
    "## Why this initial priority?", "Prevent premature activation while unblocking consumers.",
    "## Relevant details",
    "- repository: spencer-shadley/.github",
    `- commit: ${"a".repeat(40)}`,
    "- path: .github/ISSUE_TEMPLATE/task.yml",
    "## Exact leases", "contracts/governed-intake-body.v1.json",
    "## Root-cause taxonomy and disposition",
    "| Rank | Finding | Disposition | Reified as |",
    "|---|---|---|---|",
    ...ranks.map((r: string) => `| ${r} | Producer candidate boundary | assigned-issue | spencer-shadley/.github#32 |`),
    `### A. ${contract.defectLadders.prevention.heading}`,
    "| Rank | Preventive control | Status |",
    "|---|---|---|",
    ...ranks.map((r: string) => `| ${r} | Staging candidate branch | assigned-issue |`),
    `### B. ${contract.defectLadders.detectHealRecover.heading}`,
    "| Rank | Notice | Self-heal / contain | Restore | Escalate if no progress | Status |",
    "|---|---|---|---|---|---|",
    ...ranks.map((r: string) => `| ${r} | Check candidate digest | Refuse premature merge | Retain revision 22 live | Coordinator | assigned-issue |`),
    "## Durable fix and acceptance", "Candidate revision 23 artifacts verified and published on candidate branch.",
    "## Human-decision state", "No human decision required",
  ].join("\n");
}

test("candidate contract metadata and namespace conforms to revision 23", () => {
  assert.equal(contract.version, 23);
  assert.equal(CURRENT_TRIAGE_REVISION, 23);
  assert.equal(GOVERNED_TRIAGE_CHECKLIST.triagedLabelPrefix, "metadata:triage-v");
  assert.equal(CURRENT_TRIAGED_LABEL, "metadata:triage-v23");
  assert.deepEqual(GOVERNED_TRIAGE_CHECKLIST.pendingLabels, ["priority:triage-tbd", "progress:triage"]);
  assert.ok(GOVERNED_TRIAGE_CHECKLIST.triageOwnedLabelPatterns.includes("^delivers:"));
  assert.ok(GOVERNED_TRIAGE_CHECKLIST.triageOwnedLabelPatterns.includes("^type:"));
  assert.ok(GOVERNED_TRIAGE_CHECKLIST.triageOwnedLabelPatterns.includes("^source:"));
  assert.ok(GOVERNED_TRIAGE_CHECKLIST.triageOwnedLabelPatterns.includes("^blocked:"));
  assert.ok(GOVERNED_TRIAGE_CHECKLIST.triageOwnedLabelPatterns.includes("^environment:"));
  assert.ok(GOVERNED_TRIAGE_CHECKLIST.triageOwnedLabelPatterns.includes("^progress:"));
  assert.ok(GOVERNED_TRIAGE_CHECKLIST.triageOwnedLabelPatterns.includes("^decomp:"));
  assert.ok(GOVERNED_TRIAGE_CHECKLIST.triageOwnedLabelPatterns.includes("^resolution:"));
});

test("generated projections use progress:triage and ban work:untriaged", () => {
  const taskMd = generateTaskMarkdown(contract);
  const taskYml = generateTaskYaml(contract);
  const featMd = generateFeatureMarkdown(contract);
  const featYml = generateFeatureYaml(contract);

  for (const [name, content] of [["task.md", taskMd], ["task.yml", taskYml], ["feature.md", featMd], ["feature.yml", featYml]]) {
    assert.match(content, /progress:triage/, `${name} must include progress:triage`);
    assert.doesNotMatch(content, /work:untriaged/, `${name} must NOT include work:untriaged`);
    assert.match(content, /priority:triage-tbd/, `${name} must include priority:triage-tbd`);
    assert.match(content, /agent-review/, `${name} must include agent-review`);
  }
  assert.equal(checkProjections(root).ok, true);
});

test("triage label recognizer handles current metadata:triage-v and legacy triaged:v", () => {
  assert.equal(isTriagedChecklistLabel("metadata:triage-v23"), true);
  assert.equal(isTriagedChecklistLabel("metadata:triage-v22"), true);
  assert.equal(isTriagedChecklistLabel("triaged:v22"), true);
  assert.equal(isTriagedChecklistLabel("triaged:v19"), true);
  assert.equal(isTriagedChecklistLabel("metadata:triage-v"), false);
  assert.equal(isTriagedChecklistLabel("triaged:"), false);
  assert.equal(isTriagedChecklistLabel("progress:triage"), false);
});

test("triage evaluator distinguishes valid current stamp from stale legacy or forged stamps", async () => {
  const base = validBody() + "\n" + renderTriageChecklistBlock({ checked: true });
  const labels = [CURRENT_TRIAGED_LABEL, "cloud-ready", "effort:medium", "tier:auto"];
  const fingerprint = await computeTriageStateFingerprint(base, labels);
  const body = base + "\n" + renderTriageCompletionMarker(fingerprint);

  // Current stamp passes
  const validState = await evaluateTriageChecklistStructure(body, labels);
  assert.equal(validState.needs_triage, false);
  assert.deepEqual(validState.reasons, []);

  // Stale legacy triaged:v22 stamp flags stale_triaged_stamp
  const staleLegacy = await evaluateTriageChecklistStructure(body, ["triaged:v22", "cloud-ready", "effort:medium", "tier:auto"]);
  assert.equal(staleLegacy.needs_triage, true);
  assert.ok(staleLegacy.reasons.includes("stale_triaged_stamp"));

  // Stale metadata:triage-v22 flags stale_triaged_stamp
  const staleCandidate = await evaluateTriageChecklistStructure(body, ["metadata:triage-v22", "cloud-ready", "effort:medium", "tier:auto"]);
  assert.equal(staleCandidate.needs_triage, true);
  assert.ok(staleCandidate.reasons.includes("stale_triaged_stamp"));

  // Wrong prefix triaged:v23 flags stale_triaged_stamp
  const wrongPrefix = await evaluateTriageChecklistStructure(body, ["triaged:v23", "cloud-ready", "effort:medium", "tier:auto"]);
  assert.equal(wrongPrefix.needs_triage, true);
  assert.ok(wrongPrefix.reasons.includes("stale_triaged_stamp"));

  // Missing stamp flags missing_triaged_stamp
  const missingStamp = await evaluateTriageChecklistStructure(body, ["cloud-ready", "effort:medium", "tier:auto"]);
  assert.equal(missingStamp.needs_triage, true);
  assert.ok(missingStamp.reasons.includes("missing_triaged_stamp"));

  // Duplicate stamps flag duplicate_triaged_stamp
  const duplicate = await evaluateTriageChecklistStructure(body, [CURRENT_TRIAGED_LABEL, "triaged:v22", "cloud-ready", "effort:medium", "tier:auto"]);
  assert.equal(duplicate.needs_triage, true);
  assert.ok(duplicate.reasons.includes("duplicate_triaged_stamp"));
  assert.ok(duplicate.reasons.includes("stale_triaged_stamp"));
});

test("triage fingerprint excludes triage stamps and includes accepted taxonomy labels", async () => {
  const base = validBody() + "\n" + renderTriageChecklistBlock({ checked: true });
  const baseLabels = ["cloud-ready", "effort:medium", "tier:auto"];

  const fpWithCurrentStamp = await computeTriageStateFingerprint(base, [...baseLabels, CURRENT_TRIAGED_LABEL]);
  const fpWithLegacyStamp = await computeTriageStateFingerprint(base, [...baseLabels, "triaged:v22"]);
  const fpWithoutStamp = await computeTriageStateFingerprint(base, baseLabels);

  // Triage stamps must not alter the fingerprint
  assert.equal(fpWithCurrentStamp, fpWithoutStamp);
  assert.equal(fpWithLegacyStamp, fpWithoutStamp);

  // Taxonomy dimensions DO participate in the fingerprint
  const taxonomyLabels = [
    "delivers:agent-efficiency",
    "type:feature",
    "type:maintenance",
    "source:human",
    "priority:repo:p2",
    "priority:fleet:p2",
    "blocked:time",
    "environment:fleet-local",
    "progress:implementing",
    "decomp:unnecessary",
  ];
  const fpWithTaxonomy = await computeTriageStateFingerprint(base, [...baseLabels, ...taxonomyLabels]);
  assert.notEqual(fpWithTaxonomy, fpWithoutStamp);

  for (const label of taxonomyLabels) {
    assert.equal(isTriageOwnedChecklistLabel(label), true, `${label} must be recognized as triage-owned`);
  }
});

test("delta planner handles migration from v22 to v23 without mutation", () => {
  const v22Items = contract.triageChecklist.items.map((item) => ({
    ...item,
    ...(item.id === "confirm-receipt"
      ? { text: item.text.replace("metadata:triage-vN", "triaged:vN") }
      : {}),
  }));
  const v22Release: ChecklistRelease = { revision: 22, items: v22Items };
  const v23Release: ChecklistRelease = { revision: 23, items: contract.triageChecklist.items };

  const priorEvidence: PriorChecklistEvidence = {
    completionVerified: true,
    completedItemIds: v22Items.map((i) => i.id),
    staleItemIds: [],
    changedEvidenceKeys: [],
    changedResultItemIds: [],
  };

  const priorSnapshot = structuredClone(priorEvidence);
  const v22Snapshot = structuredClone(v22Release);
  const v23Snapshot = structuredClone(v23Release);

  const delta = planChecklistDelta(v22Release, v23Release, priorEvidence);

  // Confirm receipt text changed -> must be reevaluated
  assert.equal(delta.fromRevision, 22);
  assert.equal(delta.toRevision, 23);
  assert.ok(delta.reevaluatedItems.some((item) => item.id === "confirm-receipt"));
  assert.ok(delta.reusedItemIds.includes("canonical-flow"));
  assert.ok(delta.reusedItemIds.includes("scope-decomposition"));

  // Pure execution: no mutations
  assert.deepEqual(priorEvidence, priorSnapshot);
  assert.deepEqual(v22Release, v22Snapshot);
  assert.deepEqual(v23Release, v23Snapshot);
});

test("accepted taxonomy dimensions and lifecycle rules validation", () => {
  const delivers = [
    "delivers:agent-efficiency",
    "delivers:human-efficiency",
    "delivers:reliability",
    "delivers:cost-efficiency",
    "delivers:capability",
  ];
  for (const label of delivers) {
    assert.equal(isTriageOwnedChecklistLabel(label), true);
  }

  const types = [
    "type:feature",
    "type:bug",
    "type:regression",
    "type:migration",
    "type:deletion",
    "type:research",
    "type:maintenance",
  ];
  for (const label of types) {
    assert.equal(isTriageOwnedChecklistLabel(label), true);
  }

  const sources = [
    "source:human",
    "source:runtime-signal",
    "source:retro-skill",
    "source:retro-bot",
    "source:scheduled-task",
    "source:retro-skill:auto-sweep",
    "source:scheduled-task:weekly-sync",
  ];
  for (const label of sources) {
    assert.equal(isTriageOwnedChecklistLabel(label), true);
  }

  const progress = [
    "progress:triage",
    "progress:planned",
    "progress:implementing",
    "progress:reviewing",
    "progress:implemented",
    "progress:verified",
  ];
  for (const label of progress) {
    assert.equal(isTriageOwnedChecklistLabel(label), true);
  }

  const decomp = [
    "decomp:required",
    "decomp:in-progress",
    "decomp:complete",
    "decomp:unnecessary",
  ];
  for (const label of decomp) {
    assert.equal(isTriageOwnedChecklistLabel(label), true);
  }

  const resolutions = [
    "resolution:delivered",
    "resolution:duplicate",
    "resolution:superseded",
    "resolution:declined",
    "resolution:obsolete",
  ];
  for (const label of resolutions) {
    assert.equal(isTriageOwnedChecklistLabel(label), true);
  }

  const environments = [
    "environment:fleet-local",
    "environment:host:mangekyo",
    "environment:hardware:gpu-h100",
  ];
  for (const label of environments) {
    assert.equal(isTriageOwnedChecklistLabel(label), true);
  }

  const blocked = [
    "blocked:time",
    "blocked:human-required",
    "blocked:issue",
  ];
  for (const label of blocked) {
    assert.equal(isTriageOwnedChecklistLabel(label), true);
  }
});
