/** .github#52: a compatible revision keeps predecessor completions valid. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENT_TRIAGE_REVISION,
  GOVERNED_TRIAGE_CHECKLIST,
  computeTriageStateFingerprint,
  evaluateTriageChecklistStructure,
  renderTriageChecklistBlock,
} from "../contracts/governed-intake-triage-state.evaluate.ts";
import { fingerprintIssueScope, boundTriagePolicyFromProducer } from "../contracts/governed-intake-policy-binding.ts";
import { renderGovernedWorkUnitKeyMarker } from "../contracts/governed-intake-body.evaluate.ts";
import {
  checkPublishedRevisionCompatibility,
  loadRevisionSnapshots,
} from "../contracts/governed-intake-body.release.ts";
import {
  checkRevisionCompatibility,
  type RevisionCompatibility,
  type RevisionItemChange,
} from "../contracts/governed-intake-revision-compatibility.ts";
import {
  evaluateTriagePolicy,
  fingerprintAssessment,
  policyIdentityAccepted,
  type Assessment,
  type PolicySnapshot,
} from "../contracts/governed-intake-triage-policy.evaluate.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(readFileSync(path.join(root, "contracts/governed-intake-body.v1.json"), "utf8"));
const issue = { repository: "spencer-shadley/.github", issueNumber: 52 };
const identity = {
  fixOwnerGitHubSlug: "spencer-shadley/.github",
  workType: "Task",
  canonicalWorkUnitIdentity: "compatible revision keeps r25 triage",
};

function prose(workType: string, checklist: string): string {
  return [
    "## Work type",
    workType,
    "## Governed work-unit key",
    renderGovernedWorkUnitKeyMarker({ ...identity, workType }),
    "## What happened or what is needed?",
    "Keep an already triaged issue complete across a compatible revision.",
    checklist,
  ].join("\n");
}

async function completedAt(revision: number, workType = "Task"): Promise<{ body: string; labels: string[] }> {
  const labels = [`metadata:triage-v${revision}`, "effort:medium", "decomp:unnecessary"];
  const base = prose(workType, renderTriageChecklistBlock({ checked: true, revision }));
  const fingerprint = await computeTriageStateFingerprint(base, labels);
  const body = `${base}\n<!-- governed-triage-completion: revision=${revision} fingerprint=${fingerprint} -->`;
  return { body, labels };
}

test("revision 26 declares revision 25 compatible and changes no checklist item", () => {
  assert.equal(contract.version, 26);
  assert.equal(CURRENT_TRIAGE_REVISION, 26);
  assert.equal(contract.revisionCompatibility.oldestAcceptedRevision, 25);
  assert.deepEqual(contract.revisionCompatibility.itemChanges, []);
  assert.equal(checkPublishedRevisionCompatibility(root).ok, true);
});

test("a predecessor-stamped completion stays complete with no body rewrite (.github#52)", async () => {
  const { body, labels } = await completedAt(25);
  const before = body;
  const state = await evaluateTriageChecklistStructure(body, labels, issue);
  assert.equal(body, before);
  assert.equal(state.needs_triage, false, state.reasons.join(","));
  assert.deepEqual(state.reasons, []);
  assert.deepEqual(state.warnings, [
    "compatible revision mismatch: evaluated revision 25, live revision 26, issue spencer-shadley/.github#52",
  ]);
});

test("the live revision stays complete and does not warn", async () => {
  const { body, labels } = await completedAt(26);
  const state = await evaluateTriageChecklistStructure(body, labels, issue);
  assert.equal(state.needs_triage, false, state.reasons.join(","));
  assert.deepEqual(state.warnings, []);
});

test("a revision outside the compatible range is stale, as is a release that declares no predecessor", async () => {
  const predecessor = await completedAt(25);
  const stale = await evaluateTriageChecklistStructure(predecessor.body, ["metadata:triage-v24", "effort:medium"], issue);
  assert.equal(stale.needs_triage, true);
  assert.ok(stale.reasons.includes("stale_triaged_stamp"));
  assert.deepEqual(stale.warnings, []);

  const undeclared: RevisionCompatibility = { oldestAcceptedRevision: 26, acceptedIdentities: [], itemChanges: [] };
  const refused = await evaluateTriageChecklistStructure(predecessor.body, predecessor.labels, { ...issue, compatibility: undeclared });
  assert.equal(refused.needs_triage, true);
  assert.ok(refused.reasons.includes("checklist_revision_mismatch"));
  assert.ok(refused.reasons.includes("completion_revision_mismatch"));
  assert.ok(refused.reasons.includes("stale_triaged_stamp"));
  assert.deepEqual(refused.warnings, []);
});

test("a tightened item re-pends only the issues it applies to", async () => {
  const taxonomy = GOVERNED_TRIAGE_CHECKLIST.items.find((item) => item.id === "taxonomy");
  assert.ok(taxonomy);
  const change: RevisionItemChange = {
    id: "taxonomy",
    classification: "tightened",
    predecessor: { title: taxonomy.title, text: taxonomy.text },
    appliesTo: { workTypes: ["Task"], dispositions: ["ordinary"] },
  };
  const compatibility: RevisionCompatibility = {
    oldestAcceptedRevision: 25,
    acceptedIdentities: contract.revisionCompatibility.acceptedIdentities,
    itemChanges: [change],
  };
  const affected = await completedAt(25, "Task");
  const unaffected = await completedAt(25, "Feature");
  const affectedState = await evaluateTriageChecklistStructure(affected.body, affected.labels, { ...issue, compatibility });
  const unaffectedState = await evaluateTriageChecklistStructure(
    unaffected.body,
    unaffected.labels,
    { ...issue, issueNumber: 83, compatibility },
  );
  assert.equal(affectedState.needs_triage, true);
  assert.ok(affectedState.unchecked_item_ids.includes("taxonomy"));
  assert.ok(affectedState.reasons.includes("unchecked_checklist_item"));
  assert.equal(unaffectedState.needs_triage, false, unaffectedState.reasons.join(","));
  assert.deepEqual(unaffectedState.unchecked_item_ids, []);
  assert.ok(unaffectedState.warnings[0]?.includes("issue spencer-shadley/.github#83"));
});

test("scope fingerprint strips every compatible revision's checklist block", () => {
  const source = {
    repository: "spencer-shadley/.github",
    issueNumber: 52,
    title: "Compatible revision scope",
  };
  const current = fingerprintIssueScope({
    ...source,
    body: prose("Task", renderTriageChecklistBlock({ includeHeading: false, checked: true, revision: 26 })),
  });
  const previous = fingerprintIssueScope({
    ...source,
    body: prose("Task", renderTriageChecklistBlock({ includeHeading: false, checked: false, revision: 25 })),
  });
  assert.equal(previous, current);
  const foreign = prose("Task", `${renderTriageChecklistBlock({ includeHeading: false, checked: false, revision: 25 })}\nextra scope`);
  assert.notEqual(fingerprintIssueScope({ ...source, body: foreign }), current);
});

test("the policy evaluator accepts a compatible revision's identity pair and rejects an unknown one", async () => {
  const bound = boundTriagePolicyFromProducer();
  const predecessor = contract.revisionCompatibility.acceptedIdentities[0];
  assert.equal(policyIdentityAccepted(bound, predecessor.policyIdentity, predecessor.rubricIdentity), true);
  assert.equal(policyIdentityAccepted(bound, `sha256:${"ab".repeat(32)}`, predecessor.rubricIdentity), false);

  const subject = {
    workUnitKey: "sha256:unit",
    scopeFingerprint: "sha256:scope",
    policyIdentity: predecessor.policyIdentity,
    rubricIdentity: predecessor.rubricIdentity,
  };
  const assessment: Assessment = {
    ...subject,
    disposition: "ordinary",
    effort: "medium",
    assessmentFingerprint: "",
    rationale: "Current residual and evidence establish this scope.",
    verification: "Run the named regression suite and inspect exact output.",
    resumability: "Persist revision and checkpoints under generic custody.",
    confidence: "high",
    blockingAssessmentUnknowns: [],
    implementationUnknowns: [],
  };
  assessment.assessmentFingerprint = await fingerprintAssessment(assessment, null);
  const snapshot: PolicySnapshot = {
    ...subject,
    state: "open",
    repositoryActive: true,
    labels: ["decomp:unnecessary", "effort:medium"],
    requiresQualifiedAssessment: false,
    assessment,
    currentGraphFingerprint: null,
    hasExecutableChildGraph: false,
    finalAttributesScopeFingerprint: subject.scopeFingerprint,
    checklistCurrentAndComplete: true,
    directionEvidenceFresh: true,
    trusted: {
      admissions: [],
      graphs: [],
      requiredCapabilities: {
        "scope-assessment": "floor:scope-assessment",
        "atomic-confirmation": "floor:atomic-confirmation",
        implementation: "floor:implementation",
      },
    },
  };
  const differentPolicy = {
    ...bound,
    policyIdentity: `sha256:${"cd".repeat(32)}`,
    acceptedIdentityPairs: [{ revision: 25, policyIdentity: predecessor.policyIdentity, rubricIdentity: predecessor.rubricIdentity }],
  };
  const accepted = await evaluateTriagePolicy(differentPolicy, snapshot);
  assert.equal(accepted.reasons.includes("unsupported_policy_or_rubric_identity"), false);
  const unknown = { ...snapshot, policyIdentity: `sha256:${"ef".repeat(32)}`, rubricIdentity: `sha256:${"11".repeat(32)}` };
  unknown.assessment = { ...assessment, policyIdentity: unknown.policyIdentity, rubricIdentity: unknown.rubricIdentity };
  const rejected = await evaluateTriagePolicy(bound, unknown);
  assert.ok(rejected.reasons.includes("unsupported_policy_or_rubric_identity"));
});

test("release:check refuses a compatibility declaration that contradicts the item changes", () => {
  const published = checkPublishedRevisionCompatibility(root);
  assert.equal(published.ok, true);
  const snapshots = loadRevisionSnapshots(root, [25]).snapshots;
  const unchanged = GOVERNED_TRIAGE_CHECKLIST.items.find((item) => item.id === "taxonomy");
  assert.ok(unchanged);
  const wordingOnly = structuredClone(contract);
  wordingOnly.revisionCompatibility.itemChanges = [{
    id: "taxonomy",
    classification: "wording-only",
    predecessor: { title: unchanged.title, text: `${unchanged.text} extra` },
  }];
  const wording = checkRevisionCompatibility(wordingOnly, snapshots);
  assert.equal(wording.ok, false);
  if (!wording.ok) assert.match(wording.messages.join("\n"), /contradicts item changes/);

  const added = structuredClone(contract);
  added.triageChecklist.items = [...added.triageChecklist.items, { id: "new-obligation", title: "New", text: "A new obligation." }];
  added.revisionCompatibility.itemChanges = [{ id: "new-obligation", classification: "wording-only", predecessor: { title: "New", text: "A new obligation." } }];
  const invented = checkRevisionCompatibility(added, snapshots);
  assert.equal(invented.ok, false);
  if (!invented.ok) assert.match(invented.messages.join("\n"), /not classified new|contradicts item changes/);

  const unscoped = structuredClone(contract);
  unscoped.triageChecklist.items = [...unscoped.triageChecklist.items, { id: "new-obligation", title: "New", text: "A new obligation." }];
  unscoped.revisionCompatibility.itemChanges = [{ id: "new-obligation", classification: "new" }];
  const missingScope = checkRevisionCompatibility(unscoped, snapshots);
  assert.equal(missingScope.ok, false);
  if (!missingScope.ok) assert.match(missingScope.messages.join("\n"), /does not say which issues it applies to/);
});
