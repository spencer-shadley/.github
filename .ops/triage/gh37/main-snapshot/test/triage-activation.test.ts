import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateTaskMarkdown,
  generateFeatureYaml,
  loadContract,
} from "../contracts/governed-intake-body.generate.ts";
import {
  validateGovernedIntakeBody,
  computeGovernedWorkUnitKey,
  renderGovernedWorkUnitKeyMarker,
} from "../contracts/governed-intake-body.evaluate.ts";
import {
  renderTriageChecklistBlock,
  renderTriageCompletionMarker,
  computeTriageStateFingerprint,
  evaluateTriageChecklistStructure as evaluateTriageChecklistState,
  CURRENT_TRIAGED_LABEL,
} from "../contracts/governed-intake-triage-state.evaluate.ts";
import {
  fingerprintAssessment,
  type Assessment,
  type PolicySnapshot,
  type QualifiedReceipt,
} from "../contracts/governed-intake-triage-policy.evaluate.ts";
import { planChecklistDelta, validateChecklistRelease } from "../contracts/governed-intake-triage-state.migrate.ts";
import {
  boundTriagePolicyFromProducer,
  currentChecklistRelease,
  evaluateGovernedIntakeTriage as evaluateProducerTriage,
  fingerprintIssueScope, bindTriagePolicy,
  type SemanticEvidenceInput,
} from "../contracts/governed-intake-triage.compose.ts";
import { bindTaskProfileContract, type TaskProfileContract, type TaskProfileRecord } from "../contracts/governed-intake-task-profile.evaluate.ts";
import taskProfileContractJson from "../contracts/governed-intake-task-profile.v1.json" with { type: "json" };
import { fingerprintDirectionFacts } from "../contracts/governed-intake-policy-binding.ts";
import { admitGovernedIntakeRelease } from "../contracts/governed-intake-release.verify.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = loadContract(root);
const bound = boundTriagePolicyFromProducer();
const identity = { fixOwnerGitHubSlug: "Spencer-Shadley/.github", workType: "Task", canonicalWorkUnitIdentity: "policy activation" };
const actualIssue = { repository: "spencer-shadley/.github", issueNumber: 19, title: "Activate policy" };
const taxonomyObservation = { ...actualIssue, state: "open" as const, lifecycleId: "created-event-19" };
const observedNoImpact = () => {
  const facts = { seed: actualIssue, threads: [{ ...actualIssue, materialFingerprint: `sha256:${"a".repeat(64)}`, decisions: [] }],
    sourceFingerprint: `sha256:${"b".repeat(64)}`, ownershipFingerprint: `sha256:${"c".repeat(64)}`, relatedWorkFingerprint: `sha256:${"d".repeat(64)}` };
  return {
    directionImpact: { ...subject, factsFingerprint: fingerprintDirectionFacts(facts), revision: contract.version,
      assessment: "no-impact" as const, rationale: "This synthetic leaf changes no related direction." },
    taxonomyObservation,
    directionObservation: { facts, coverage: "complete" as const, publication: { repository: "spencer-shadley/.github",
      sourceCommit: "a".repeat(40), payloadDigest: "b".repeat(64), revision: contract.version } } };
};
const evaluateGovernedIntakeTriage = (input: Parameters<typeof evaluateProducerTriage>[0]) =>
  evaluateProducerTriage({ subject: actualIssue, ...observedNoImpact(), ...input });
const subject = {
  workUnitKey: `sha256:${computeGovernedWorkUnitKey(identity)}`,
  scopeFingerprint: fingerprintIssueScope({ ...actualIssue, body: validBody() }),
  policyIdentity: bound.policyIdentity,
  rubricIdentity: bound.rubricIdentity,
};

function validBody() {
  const ranks = contract.taxonomyRanks;
  return [
    "## Work type", "Task", "## Governed work-unit key", renderGovernedWorkUnitKeyMarker(identity),
    "## What happened or what is needed?", "Activate early decomposition with composed policy evidence.",
    "## Initial priority guess", "P2", "## Why this initial priority?", "Prevent false completion.",
    "## Relevant details", "- repository: spencer-shadley/.github", `- commit: ${"a".repeat(40)}`, "- path: .github/ISSUE_TEMPLATE/task.yml",
    "## Exact leases", "contracts/governed-intake-triage.compose.ts",
    "## Root-cause taxonomy and disposition", "| Rank | Finding | Disposition | Reified as |", "|---|---|---|---|",
    ...ranks.map((r: string) => `| ${r} | Structural completion omitted decomposition evidence | assigned-issue | spencer-shadley/.github#19 |`),
    `### A. ${contract.defectLadders.prevention.heading}`, "| Rank | Preventive control | Status |", "|---|---|---|",
    ...ranks.map((r: string) => `| ${r} | Compose policy evidence before completion | assigned-issue |`),
    `### B. ${contract.defectLadders.detectHealRecover.heading}`, "| Rank | Notice | Self-heal / contain | Restore | Escalate if no progress | Status |", "|---|---|---|---|---|---|",
    ...ranks.map((r: string) => `| ${r} | Missing semantic evidence | Keep triage pending | Verified composition result | Producer owner | assigned-issue |`),
    "## Durable fix and acceptance", "Checked boxes cannot complete triage without adapter-verified evidence.",
    "## Human-decision state", "No human decision required",
  ].join("\n");
}

async function completedBodyAndLabels(extraLabels: string[]) {
  const body = validBody() + "\n" + renderTriageChecklistBlock({ checked: true });
  const labels = [CURRENT_TRIAGED_LABEL, ...extraLabels];
  const completed = body + "\n" + renderTriageCompletionMarker(await computeTriageStateFingerprint(body, labels));
  return { body: completed, labels };
}

function receipt(id: string, role: QualifiedReceipt["role"], assessmentFingerprint: string, family: string): QualifiedReceipt {
  const identityFields = {
    bindingId: `binding-${family}`,
    provider: `provider-${family}`,
    modelFamily: family,
    modelId: `model-${family}`,
    configurationId: "qualified-config",
  };
  return {
    ...subject, id, role, routePolicyIdentity: "verified-router:release-1", requiredCapability: `floor:${role}`,
    admitted: true, servingVerified: true, selected: { ...identityFields }, served: { ...identityFields },
    verdict: "agree", assessmentFingerprint,
  };
}

async function verifiedEvidence(disposition: Assessment["disposition"]): Promise<Extract<SemanticEvidenceInput, { kind: "adapter-verified" }>> {
  const effort = disposition === "ordinary" ? "medium" : "high";
  const assessment: Assessment = {
    ...subject, disposition, effort, assessmentFingerprint: "",
    rationale: "Current residual and evidence establish this scope.",
    verification: "Run the named regression suite and inspect exact output.",
    resumability: "Persist revision and checkpoints under generic custody.",
    confidence: "high", blockingAssessmentUnknowns: [], implementationUnknowns: [],
    ...(disposition === "atomic-high" ? {
      invariant: "One coupled invariant must hold throughout the correction.",
      difficultyRationale: "Concrete coupled-correctness reasoning remains.",
      alternativesConsidered: "A staged split would not provide a separately verifiable unit under this invariant.",
    } : {}),
  };
  const graphFingerprint = disposition === "parent" ? "sha256:current-graph" : null;
  assessment.assessmentFingerprint = await fingerprintAssessment(assessment, graphFingerprint);
  const trusted: PolicySnapshot["trusted"] = {
    admissions: [],
    graphs: [],
    requiredCapabilities: {
      "scope-assessment": "floor:scope-assessment",
      "atomic-confirmation": "floor:atomic-confirmation",
      implementation: "floor:implementation",
    },
  };
  if (disposition !== "ordinary") {
    assessment.assessorReceiptId = "assessor";
    trusted.admissions.push(receipt("assessor", "scope-assessment", assessment.assessmentFingerprint, "a"));
  }
  if (disposition === "atomic-high") {
    assessment.confirmationReceiptId = "confirmer";
    trusted.admissions.push(receipt("confirmer", "atomic-confirmation", assessment.assessmentFingerprint, "b"));
  }
  if (disposition === "parent") {
    assessment.graphReceiptId = "graph";
    trusted.graphs.push({
      ...subject, id: "graph", graphFingerprint: graphFingerprint!, validatorIdentity: "verified-code-core:revision",
      valid: true, coverageComplete: true, canonicalRelationshipsReadBack: true, requiredLeafTriageComplete: true,
    });
  }
  return {
    kind: "adapter-verified",
    workUnitKey: subject.workUnitKey,
    scopeFingerprint: subject.scopeFingerprint,
    state: "open",
    taxonomy: { ...subject, revision: contract.version, lifecycleId: taxonomyObservation.lifecycleId },
    repositoryActive: true,
    priorHighEffort: effort === "high",
    requiresQualifiedAssessment: disposition !== "ordinary",
    assessment,
    currentGraphFingerprint: graphFingerprint,
    hasExecutableChildGraph: disposition === "parent",
    finalAttributesScopeFingerprint: subject.scopeFingerprint,
    directionEvidenceFresh: true,
    trusted,
    execution: { ...subject, revision: contract.version, stage: "implement", cloudReadiness: { status: "ready", reason: "Versioned source and fixtures are available remotely.", localVerificationRequired: false }, environment: { allOf: [] } },
  };
}

const requiredTaxonomyLabels = ["type:maintenance", "source:human", "priority:repo:p2", "priority:fleet:p2", "progress:planned"];

function dispositionLabels(disposition: Assessment["disposition"]): string[] {
  const effort = disposition === "ordinary" ? "medium" : "high";
  return [...bound.policy.dispositions[disposition].labels, bound.policy.effortRubric.labels[effort], ...requiredTaxonomyLabels];
}

test("current semantic revision binds scope before final attributes", () => {
  assert.ok(contract.version >= 20, "subject-bound completion requires the post-19 semantic revision");
  const scope = contract.triageChecklist.items.find((item: { id: string }) => item.id === "scope-decomposition");
  assert.equal(scope.semantics.subjectBinding, "server-fetched-issue-v1");
  assert.equal(scope.semantics.completionAuthority, "composed-semantic-evaluation-v1");
  const ids: string[] = contract.triageChecklist.items.map((item: { id: string }) => item.id);
  assert.ok(ids.indexOf("canonical-flow") < ids.indexOf("scope-decomposition"));
  assert.ok(ids.indexOf("value-direction") < ids.indexOf("scope-decomposition"));
  assert.ok(ids.indexOf("dedup-queue-synergy") < ids.indexOf("scope-decomposition"));
  assert.ok(ids.indexOf("scope-decomposition") < ids.indexOf("priority-work-dimensions"));
  assert.ok(ids.indexOf("scope-decomposition") < ids.indexOf("verify-human-required"));
  const order = validateChecklistRelease(currentChecklistRelease());
  assert.ok(order.indexOf("scope-decomposition") < order.indexOf("priority-work-dimensions"));
  assert.equal(ids.includes("decomp-in-progress"), false);
});

test("effort calibration references policy JSON and drops compulsory RCA/N=1 caps", () => {
  assert.equal(contract.effortCalibration.source, "contracts/governed-intake-triage-policy.v1.json");
  assert.equal(contract.effortCalibration.preventionRcaDefault, undefined);
  assert.equal(contract.effortCalibration.compilerErrorDefault, undefined);
  assert.match(contract.effortCalibration.description, /unknown, not low/);
  assert.match(generateTaskMarkdown(contract), /Certified atomic-high remains high/);
});

test("ownership and synergy checklist avoid repeated full-census ceremony", () => {
  const owner = contract.triageChecklist.items.find((item: { id: string }) => item.id === "fix-owner-responsibility");
  const dedup = contract.triageChecklist.items.find((item: { id: string }) => item.id === "dedup-queue-synergy");
  assert.match(owner.text, /Reuse a prior high-confidence ownership receipt/);
  assert.match(owner.text, /does not require a model seat/);
  assert.match(dedup.text, /Search open work in the resolved owner first/);
  assert.match(dedup.text, /closed history only for regression\/prior-fix/);
  assert.match(dedup.text, /Reuse a fresh synergy receipt/);
});

test("verification is required before implementation but not as triage prose", () => {
  const verify = contract.triageChecklist.items.find((item: { id: string }) => item.id === "verify-human-required");
  assert.match(verify.text, /before an implementation writer starts/);
  assert.match(verify.text, /does not require the issue body to already contain `## Verify`/);
  assert.match(verify.text, /Tracking parents do not inherit child Verify/);
  assert.deepEqual(verify.semantics.verifyFenceRequiredFor, []);
  assert.deepEqual(
    verify.semantics.verificationContractRequiredBeforeImplementation,
    ["ordinary-auto", "atomic-high-auto"],
  );
  assert.equal(verify.semantics.trackingParentInheritsChildVerify, false);
});

test("higher-intelligence item no longer forbids decomposition inside triage", () => {
  const handoff = contract.triageChecklist.items.find((item: { id: string }) => item.id === "higher-intelligence-handoff");
  assert.match(handoff.text, /earlier `scope-decomposition` obligation/);
  assert.equal(handoff.text.includes("does not plan, decompose, mint"), false);
});

// .github#48: Code's provenance contract (spencer-shadley/code#7817) has an `agent_unattested`
// actor that records no model, effort or `triaged-by-*` label. The checklist must admit that run.
test("confirm-receipt requires triaged-by only when a receipt names the model, and admits an unattested run", () => {
  const confirm = contract.triageChecklist.items.find((item: { id: string }) => item.id === "confirm-receipt");
  assert.equal(/every substantive model-triaged run/.test(confirm.text), false);
  assert.match(confirm.text, /named by an authoritative execution or route receipt records additive model provenance using `triaged-by-<model>-<effort>`/);
  assert.ok(confirm.text.includes("`agent_unattested`) completes with no `triaged-by-*` label"));
  assert.match(confirm.text, /never invents a model or effort slug/);
  assert.match(confirm.text, /never stripped on re-triage or correction/);
  for (const projection of [generateTaskMarkdown(contract), readFileSync(path.join(root, ".github/ISSUE_TEMPLATE/task.yml"), "utf8")]) {
    assert.ok(projection.includes(confirm.text), "projection carries the confirm-receipt text verbatim");
  }
});

test("a previous high-effort label is a suggestion to get a second opinion, not a completion gate", async () => {
  const handoff = contract.triageChecklist.items.find((item: { id: string }) => item.id === "higher-intelligence-handoff");
  assert.match(handoff.text, /carried `effort:high` before and is now assessed low or medium/);
  assert.match(handoff.text, /highly encouraged/);
  assert.match(handoff.text, /completion does not depend on it/);
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("ordinary"));
  const evidence = await verifiedEvidence("ordinary");
  if (evidence.kind !== "adapter-verified") throw new Error("fixture");
  evidence.priorHighEffort = true;
  assert.equal(evidence.trusted.admissions.length, 0);
  const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
  assert.equal(result.status, "complete", JSON.stringify(result.reasons));
});

test("feature projection drops cadence, combined discovery, and registry/shed checklists", () => {
  const yaml = generateFeatureYaml(contract);
  assert.equal(yaml.includes("at least every 30 minutes"), false);
  assert.equal(yaml.includes("Discovery / experiment"), false);
  assert.equal(yaml.includes("FLEET-REGISTRY.md"), false);
  assert.equal(yaml.includes("shedAbovePct"), false);
  assert.match(yaml, /not a second checklist, runtime cadence, or registry\/shed form/);
});

test("checked boxes without semantic evidence cannot report completed triage", async () => {
  const { body, labels } = await completedBodyAndLabels(["effort:medium", "decomp:unnecessary"]);
  assert.equal((await evaluateTriageChecklistState(body, labels)).needs_triage, false);
  assert.deepEqual(validateGovernedIntakeBody(body), { ok: true, schemaVersion: "governed-intake-body-v1" });
  const result = await evaluateGovernedIntakeTriage({ body, labels, evidence: { kind: "missing" } });
  assert.equal(result.status, "pending");
  assert.equal(result.needsTriage, true);
  assert.equal(result.implementationCandidate, false);
  assert.ok(result.reasons.includes("missing_semantic_evidence"));
  assert.equal(result.policy, null);
  assert.equal(result.consumerCutover, false);
});

test("unsupported consumers fail closed instead of completing from local boxes", async () => {
  const { body, labels } = await completedBodyAndLabels(["effort:medium"]);
  const result = await evaluateGovernedIntakeTriage({
    body, labels, evidence: { kind: "unsupported", consumer: "legacy-v17-cache", reason: "stale_release_pin" },
  });
  assert.equal(result.status, "unsupported");
  assert.ok(result.reasons.includes("unsupported_consumer"));
  assert.ok(result.reasons.includes("stale_release_pin"));
});

test("closed or inactive issues remain out of scope without becoming pending triage", async () => {
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("ordinary"));
  for (const patch of [{ state: "closed" as const }, { repositoryActive: false }]) {
    const evidence = await verifiedEvidence("ordinary");
    Object.assign(evidence, patch);
    const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
    assert.equal(result.status, "out_of_scope", JSON.stringify(result.reasons));
    assert.equal(result.needsTriage, false, JSON.stringify(result.reasons));
    assert.equal(result.implementationCandidate, false);
  }
});

for (const kind of ["ordinary", "atomic-high", "parent"] as const) {
  test(`adapter-verified ${kind} can complete composed triage with shape-appropriate candidacy`, async () => {
    const { body, labels } = await completedBodyAndLabels(dispositionLabels(kind));
    const evidence = await verifiedEvidence(kind);
    const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
    assert.equal(result.status, "complete", JSON.stringify(result.reasons));
    assert.equal(result.scopeResolved, true);
    assert.equal(result.implementationCandidate, kind !== "parent");
    assert.equal(result.disposition, kind);
    assert.equal(result.consumerCutover, false);
  });
  test(`legacy decomp-in-progress is cosmetic for valid ${kind} and never required`, async () => {
    const { body, labels } = await completedBodyAndLabels([...dispositionLabels(kind), "decomp-in-progress"]);
    const evidence = await verifiedEvidence(kind);
    const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
    assert.equal(result.status, "complete", JSON.stringify(result.reasons));
    assert.deepEqual(result.legacyLabelsToRemove, ["decomp-in-progress"]);
  });
}

test("ordinary path stays inexpensive: no qualified receipts required", async () => {
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("ordinary"));
  const evidence = await verifiedEvidence("ordinary");
  assert.equal(evidence.trusted.admissions.length, 0);
  const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
  assert.equal(result.status, "complete");
  assert.equal(result.implementationEligible, true);
});

test("atomic-high completes without second-opinion receipts; the checklist says they are encouraged", async () => {
  const scope = contract.triageChecklist.items.find((item: { id: string }) => item.id === "scope-decomposition");
  assert.match(scope.text, /highly encouraged and are checked when recorded, but completion does not depend on them/);
  const handoff = contract.triageChecklist.items.find((item: { id: string }) => item.id === "higher-intelligence-handoff");
  assert.equal(handoff.text.startsWith("`effort:high`"), false);
  assert.match(handoff.text, /For `effort:high` work, and for an issue that carried `effort:high` before/);
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("atomic-high"));
  const evidence = await verifiedEvidence("atomic-high");
  evidence.requiresQualifiedAssessment = false;
  delete evidence.assessment!.assessorReceiptId; delete evidence.assessment!.confirmationReceiptId;
  evidence.trusted.admissions = [];
  const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
  assert.equal(result.status, "complete", JSON.stringify(result.reasons));
  assert.equal(result.implementationEligible, false, "execution of a high-effort leaf still needs its admitted implementation receipt");
});

test("atomic-high keeps high; a recorded confirmation that cannot be verified keeps triage pending", async () => {
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("atomic-high"));
  const evidence = await verifiedEvidence("atomic-high");
  evidence.trusted.admissions = evidence.trusted.admissions.filter((row) => row.role !== "atomic-confirmation");
  const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
  assert.equal(result.status, "pending");
  assert.ok(result.reasons.some((reason) => reason.startsWith("atomic-confirmation")));
});

test("same-family confirmer is not independent", async () => {
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("atomic-high"));
  const evidence = await verifiedEvidence("atomic-high");
  const [assessor, confirmer] = evidence.trusted.admissions;
  confirmer.selected.modelFamily = assessor.selected.modelFamily;
  confirmer.served.modelFamily = assessor.served.modelFamily;
  const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
  assert.ok(result.reasons.includes("atomic_confirmation_not_independent"));
});

test("parents are tracking only and cannot deadlock child triage on a parent stamp", async () => {
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("parent"));
  const evidence = await verifiedEvidence("parent");
  evidence.trusted.graphs[0].requiredLeafTriageComplete = false;
  const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
  assert.equal(result.scopeResolved, true);
  assert.equal(result.implementationCandidate, false);
  assert.ok(result.reasons.includes("required_leaf_triage_incomplete"));
  assert.equal(result.status, "pending");
});

test("ordinary leaf with no supplied task profile degrades to legacy-unprofiled without a pending reason", async () => {
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("ordinary"));
  const evidence = await verifiedEvidence("ordinary");
  const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
  assert.equal(result.status, "complete", JSON.stringify(result.reasons));
  assert.equal(result.taskProfile?.status, "legacy-unprofiled");
  assert.equal(result.reasons.some((reason) => reason.startsWith("task_profile_")), false);
});

test("ordinary leaf with a bound task profile record projects its derived labels", async () => {
  const { body, labels } = await completedBodyAndLabels([...dispositionLabels("ordinary"), "task:implement"]);
  const evidence = await verifiedEvidence("ordinary");
  const taskProfileBound = await bindTaskProfileContract(taskProfileContractJson as TaskProfileContract);
  const record: TaskProfileRecord = {
    profile: { schemaVersion: taskProfileContractJson.profileSchemaVersion, scores: { implement: 10, diagnose: 0, design: 0, review: 0, judgment: 0 }, confidence: "high", rationale: "known bounded fix" },
    workUnitKey: evidence.workUnitKey, scopeFingerprint: evidence.scopeFingerprint, contractIdentity: taskProfileBound.contractIdentity,
  };
  const result = await evaluateGovernedIntakeTriage({ body, labels, evidence, taskProfile: { record, required: true } });
  assert.equal(result.status, "complete", JSON.stringify(result.reasons));
  assert.equal(result.taskProfile?.status, "profiled");
  assert.deepEqual(result.taskProfile?.labels, ["task:implement"]);
});

test("a task profile whose derived label is not yet reflected on the issue stays pending until readback", async () => {
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("ordinary"));
  const evidence = await verifiedEvidence("ordinary");
  const taskProfileBound = await bindTaskProfileContract(taskProfileContractJson as TaskProfileContract);
  const record: TaskProfileRecord = {
    profile: { schemaVersion: taskProfileContractJson.profileSchemaVersion, scores: { implement: 10, diagnose: 0, design: 0, review: 0, judgment: 0 }, confidence: "high", rationale: "known bounded fix" },
    workUnitKey: evidence.workUnitKey, scopeFingerprint: evidence.scopeFingerprint, contractIdentity: taskProfileBound.contractIdentity,
  };
  const result = await evaluateGovernedIntakeTriage({ body, labels, evidence, taskProfile: { record, required: true } });
  assert.equal(result.status, "pending");
  assert.ok(result.reasons.includes("task_label_projection_mismatch"));
  assert.equal(result.taskProfile?.status, "profiled");
});

test("a required but missing task profile on an executable leaf stays pending, not completed", async () => {
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("ordinary"));
  const evidence = await verifiedEvidence("ordinary");
  const result = await evaluateGovernedIntakeTriage({ body, labels, evidence, taskProfile: { record: null, required: true } });
  assert.equal(result.status, "pending");
  assert.ok(result.reasons.includes("task_profile_missing"), JSON.stringify(result.reasons));
});

test("a tracking parent never receives an aggregate task profile", async () => {
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("parent"));
  const evidence = await verifiedEvidence("parent");
  const taskProfileBound = await bindTaskProfileContract(taskProfileContractJson as TaskProfileContract);
  const record: TaskProfileRecord = {
    profile: { schemaVersion: taskProfileContractJson.profileSchemaVersion, scores: { implement: 10, diagnose: 0, design: 0, review: 0, judgment: 0 }, confidence: "high", rationale: "invalid on a parent" },
    workUnitKey: evidence.workUnitKey, scopeFingerprint: evidence.scopeFingerprint, contractIdentity: taskProfileBound.contractIdentity,
  };
  const result = await evaluateGovernedIntakeTriage({ body, labels, evidence, taskProfile: { record, required: false } });
  assert.equal(result.taskProfile?.status, "not-applicable");
  assert.ok(result.reasons.includes("tracking_parent_task_profile"));
  assert.equal(result.status, "pending");
});

test("composed evaluation binds policy identity from producer bytes, not issue text", async () => {
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("ordinary"));
  const evidence = await verifiedEvidence("ordinary");
  evidence.assessment!.policyIdentity = "issue-authored-policy";
  const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
  assert.equal(result.policyIdentity, bound.policyIdentity);
  assert.ok(result.reasons.includes("stale_scope_or_policy_evidence"));
});

test("scope-before-attributes: old final-attribute fingerprint cannot complete", async () => {
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("ordinary"));
  const evidence = await verifiedEvidence("ordinary");
  evidence.finalAttributesScopeFingerprint = "prior-scope";
  const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
  assert.equal(result.scopeResolved, true);
  assert.ok(result.reasons.includes("final_attributes_not_bound_to_current_scope"));
  assert.equal(result.status, "pending");
});

test("delta reuse keeps unchanged preflight evidence when only the new scope item is added", () => {
  const current = currentChecklistRelease();
  const previous = {
    revision: 18,
    items: current.items.filter((item) => item.id !== "scope-decomposition").map((item) => ({
      id: item.id, title: item.title, text: item.text,
    })),
  };
  const completedItemIds = previous.items.map((item) => item.id);
  const delta = planChecklistDelta(previous, current, {
    completionVerified: true, completedItemIds, staleItemIds: [], changedEvidenceKeys: [], changedResultItemIds: [],
  });
  assert.ok(delta.reevaluatedItems.some((item) => item.id === "scope-decomposition"));
  assert.ok(delta.reusedItemIds.includes("canonical-flow"));
  assert.ok(delta.reusedItemIds.includes("github-effects-quota"));
  assert.equal(delta.requiresResultReconciliation, true);
});

test("observed scope result change reopens declared dependents and reuses unrelated preflight", () => {
  const current = currentChecklistRelease();
  const delta = planChecklistDelta(current, current, {
    completionVerified: true,
    completedItemIds: current.items.map((item) => item.id),
    staleItemIds: [],
    changedEvidenceKeys: [],
    changedResultItemIds: ["scope-decomposition"],
  });
  assert.ok(delta.reusedItemIds.includes("canonical-flow"));
  assert.ok(delta.reusedItemIds.includes("value-direction"));
  assert.ok(delta.reevaluatedItems.some((item) => item.id === "priority-work-dimensions" && item.reasons.includes("dependency-invalidated")));
  assert.equal(delta.reevaluatedItems.some((item) => item.id === "github-effects-quota"), false);
});

test("compose source API has no decomp-in-progress requirement", () => {
  const source = readFileSync(path.join(root, "contracts/governed-intake-triage.compose.ts"), "utf8");
  assert.equal(/decomp-in-progress/.test(source), false);
  assert.match(source, /adapter-verified/);
  assert.equal(/eligible\s*:\s*true/.test(source), false);
});


test("identical claimed subject pairs cannot attest a different real issue", async () => {
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("ordinary"));
  const evidence = await verifiedEvidence("ordinary");
  const result = await evaluateGovernedIntakeTriage({ subject: { ...actualIssue, issueNumber: 20 }, body, labels, evidence });
  assert.equal(result.status, "pending");
  assert.equal(result.scopeResolved, false);
  assert.ok(result.reasons.includes("scope_evidence_subject_mismatch"));
});
test("matching forged work-unit pair cannot replace the actual body marker", async () => {
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("ordinary"));
  const evidence = await verifiedEvidence("ordinary");
  evidence.workUnitKey = "sha256:" + "b".repeat(64);
  evidence.assessment!.workUnitKey = evidence.workUnitKey;
  evidence.assessment!.assessmentFingerprint = await fingerprintAssessment(evidence.assessment!, null);
  const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
  assert.equal(result.status, "pending");
  assert.ok(result.reasons.includes("work_unit_evidence_subject_mismatch"));
});
test("omitting server-fetched subject metadata is never semantic completion", async () => {
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("ordinary"));
  const result = await evaluateProducerTriage({ body, labels, evidence: await verifiedEvidence("ordinary") });
  assert.equal(result.status, "pending");
  assert.ok(result.reasons.includes("missing_or_invalid_subject_identity"));
});
test("title and actual scope changes invalidate evidence but checkbox changes do not", async () => {
  const original = validBody();
  const checked = original + "\n" + renderTriageChecklistBlock({ checked: true });
  const unchecked = original + "\n" + renderTriageChecklistBlock({ checked: false });
  const fingerprint = fingerprintIssueScope({ ...actualIssue, body: original });
  assert.equal(fingerprintIssueScope({ ...actualIssue, body: checked }), fingerprint);
  assert.equal(fingerprintIssueScope({ ...actualIssue, body: unchecked }), fingerprint);
  assert.notEqual(fingerprintIssueScope({ ...actualIssue, title: "Different outcome", body: original }), fingerprint);
  assert.notEqual(fingerprintIssueScope({ ...actualIssue, body: original.replace("Activate early decomposition", "Remove verification entirely") }), fingerprint);
});
test("all consumers share canonical semantic policy and rubric identities", () => {
  const reordered = Object.fromEntries(Object.entries(bound.policy).reverse());
  const rebound = bindTriagePolicy(JSON.parse(JSON.stringify(reordered)));
  assert.equal(rebound.policyIdentity, bound.policyIdentity);
  assert.equal(rebound.rubricIdentity, bound.rubricIdentity);
  const changed = structuredClone(bound.policy);
  changed.effortRubric.version++;
  const revised = bindTriagePolicy(changed);
  assert.notEqual(revised.policyIdentity, bound.policyIdentity);
  assert.notEqual(revised.rubricIdentity, bound.rubricIdentity);
});
test("portable evaluator and composition import no filesystem or process modules", () => {
  for (const name of ["governed-intake-body.evaluate.ts", "governed-intake-policy-binding.ts", "governed-intake-triage.compose.ts"]) {
    const source = readFileSync(path.join(root, "contracts", name), "utf8");
    assert.doesNotMatch(source, /from\s+["']node:(?:fs|child_process|process)["']/);
  }
});


test("legacy public two-argument checklist API cannot restamp unresolved work", async () => {
  const { evaluateTriageChecklistState: publicState } = await import("../contracts/governed-intake-triage-state.evaluate.ts");
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("ordinary"));
  const result = await publicState(body, labels);
  assert.equal(result.needs_triage, true);
  assert.ok(result.reasons.includes("semantic_evidence_required"));
  assert.ok(result.unchecked_item_ids.includes("scope-decomposition"));
});
test("public checklist API composes verified ordinary evidence rather than blocking every issue", async () => {
  const { evaluateTriageChecklistState: publicState } = await import("../contracts/governed-intake-triage-state.evaluate.ts");
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("ordinary"));
  const result = await publicState(body, labels, { subject: actualIssue, evidence: await verifiedEvidence("ordinary"), ...observedNoImpact() });
  assert.equal(result.needs_triage, false, JSON.stringify(result.semantic_reasons));
  assert.equal(result.scope_resolved, true);
});
test("public checklist API cannot hide missing atomic confirmation behind checked boxes", async () => {
  const { evaluateTriageChecklistState: publicState } = await import("../contracts/governed-intake-triage-state.evaluate.ts");
  const { body, labels } = await completedBodyAndLabels(dispositionLabels("atomic-high"));
  const evidence = await verifiedEvidence("atomic-high");
  evidence.trusted.admissions = evidence.trusted.admissions.filter(row => row.role !== "atomic-confirmation");
  const result = await publicState(body, labels, { subject: actualIssue, evidence });
  assert.equal(result.needs_triage, true);
  assert.equal(result.scope_resolved, false);
});


test("extra prose hidden inside checklist delimiters changes actual scope", () => {
  const body = validBody() + "\n" + renderTriageChecklistBlock({ checked: false });
  const before = fingerprintIssueScope({ ...actualIssue, body });
  const changed = body.replace("<!-- /governed-triage-checklist -->", "Extra implementation requirement: delete the verification gate.\n<!-- /governed-triage-checklist -->");
  assert.notEqual(fingerprintIssueScope({ ...actualIssue, body: changed }), before);
});
test("revision-less and unknown checklist-shaped regions never hide scope", () => {
  const body = validBody();
  const before = fingerprintIssueScope({ ...actualIssue, body });
  for (const marker of ["", "revision=999999"]) {
    const changed = body + "\n<!-- governed-triage-checklist: " + marker + " -->\nNew actual work\n<!-- /governed-triage-checklist -->";
    assert.notEqual(fingerprintIssueScope({ ...actualIssue, body: changed }), before);
  }
});

// Real revision-23 producer parity: no rewritten policy or invented cloud label.
for (const kind of ["ordinary", "atomic-high", "parent"] as const) {
  for (const local of [false, true]) {
    test(`candidate taxonomy parity: ${kind} / ${local ? "local" : "cloud"}`, async () => {
      const environment = local ? ["environment:fleet-local", "environment:hardware:camera"] : [];
      const { body, labels } = await completedBodyAndLabels([...dispositionLabels(kind), ...environment]);
      const evidence = await verifiedEvidence(kind);
      evidence.execution!.cloudReadiness = { status: local ? "not-ready" : "ready", reason: local ? "Implementation needs the camera device." : "Versioned sources and isolated tests.", localVerificationRequired: !local, ...(!local ? { localFollowUp: "spencer-shadley/code#7625 device acceptance" } : {}) };
      evidence.execution!.environment = { allOf: environment };
      const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
      assert.equal(result.status, "complete", JSON.stringify(result.reasons));
      assert.equal(result.disposition, kind);
      assert.equal(result.implementationCandidate, kind !== "parent");
      assert.equal(labels.some(label => /^(?:decomp-|decomp$|epic$|cloud-ready$|local-required$)/.test(label)), false);
      const releaseDir = path.join(root, "contracts/generated/governed-intake");
      const manifest = JSON.parse(readFileSync(path.join(releaseDir, "manifest.json"), "utf8"));
      assert.equal(admitGovernedIntakeRelease(releaseDir, { repository: "spencer-shadley/.github",
        commit: manifest.producer.commit, revision: contract.version, payloadDigest: manifest.payloadDigest }).ok, true);
      const portable = await import("../contracts/generated/governed-intake/compose.js");
      const portableResult = await portable.evaluateGovernedIntakeTriage({ subject: actualIssue, ...observedNoImpact(), body, labels, evidence });
      assert.deepEqual(portableResult, result, "verified unmodified release and canonical source must agree");
    });
  }
}

for (const [name, mutate, expected] of [
  ["missing", (e: Awaited<ReturnType<typeof verifiedEvidence>>) => { delete e.execution; }, "execution_evidence_required"],
  ["unknown", (e: Awaited<ReturnType<typeof verifiedEvidence>>) => { e.execution!.cloudReadiness.status = "unknown"; }, "execution_evidence_invalid_or_unknown"],
  ["stale scope", (e: Awaited<ReturnType<typeof verifiedEvidence>>) => { e.execution!.scopeFingerprint = "stale"; }, "execution_evidence_subject_or_revision_mismatch"],
  ["stale revision", (e: Awaited<ReturnType<typeof verifiedEvidence>>) => { e.execution!.revision = 22; }, "execution_evidence_subject_or_revision_mismatch"],
  ["missing local follow-up", (e: Awaited<ReturnType<typeof verifiedEvidence>>) => { e.execution!.cloudReadiness.localVerificationRequired = true; }, "execution_local_follow_up_required"],
  ["local with no requirements", (e: Awaited<ReturnType<typeof verifiedEvidence>>) => { e.execution!.cloudReadiness.status = "not-ready"; }, "execution_substrate_environment_mismatch"],
  ["unsupported environment", (e: Awaited<ReturnType<typeof verifiedEvidence>>) => { e.execution!.environment.allOf = ["environment:cloud"]; }, "execution_environment_invalid"],
] as const) {
  test(`candidate structured execution rejects ${name}`, async () => {
    const { body, labels } = await completedBodyAndLabels(dispositionLabels("ordinary"));
    const evidence = await verifiedEvidence("ordinary"); mutate(evidence);
    const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
    assert.equal(result.status, "pending"); assert.ok(result.reasons.includes(expected), JSON.stringify(result.reasons));
    assert.equal(result.implementationEligible, false);
  });
}

test("environment alternatives stay structured rather than becoming conjunctive labels", async () => {
  const { body, labels } = await completedBodyAndLabels([...dispositionLabels("ordinary"), "environment:fleet-local"]);
  const evidence = await verifiedEvidence("ordinary");
  evidence.execution!.cloudReadiness.status = "not-ready";
  evidence.execution!.environment = { allOf: ["environment:fleet-local"], anyOf: [["environment:host:mangekyo", "environment:host:rinnegan"]] };
  assert.equal((await evaluateGovernedIntakeTriage({ body, labels, evidence })).status, "complete");
  const extra = await completedBodyAndLabels([...labels, "environment:host:mangekyo"]);
  const result = await evaluateGovernedIntakeTriage({ ...extra, evidence });
  assert.ok(result.reasons.includes("execution_environment_projection_mismatch"));
});

// Review B1: recompute the stamp so these cases exercise semantic taxonomy,
// rather than merely discovering a stale completion fingerprint.
for (const [name, extra] of [
  ["missing required dimensions", []],
  ["conflicting progress", ["type:maintenance", "source:human", "priority:repo:p2", "priority:fleet:p2", "progress:planned", "progress:verified"]],
  ["open delivered resolution", ["type:maintenance", "source:human", "priority:repo:p2", "priority:fleet:p2", "progress:planned", "resolution:delivered"]],
] as const) {
  test(`taxonomy completion refuses ${name} even with a fresh stamp`, async () => {
    const { body, labels } = await completedBodyAndLabels([...dispositionLabels("ordinary").filter(label => !requiredTaxonomyLabels.includes(label)), ...extra]);
    const evidence = await verifiedEvidence("ordinary");
    const result = await evaluateGovernedIntakeTriage({ body, labels, evidence });
    assert.equal(result.status, "pending");
    assert.equal(result.needsTriage, true);
    assert.equal(result.implementationCandidate, false);
    assert.equal(result.implementationEligible, false);
    assert.ok(result.reasons.some(reason => reason.startsWith("taxonomy_")));
  });
}

for (const surface of ["canonical", "portable"] as const) {
  const evaluate = async (input: Parameters<typeof evaluateProducerTriage>[0]) => surface === "canonical"
    ? evaluateGovernedIntakeTriage(input)
    : (await import("../contracts/generated/governed-intake/compose.js")).evaluateGovernedIntakeTriage({ subject: actualIssue, ...observedNoImpact(), ...input });
  for (const dimension of ["type", "source", "priority:repo", "priority:fleet", "progress"]) {
    test(`${surface} composed taxonomy refuses missing ${dimension} with a recomputed stamp`, async () => {
      const current = await completedBodyAndLabels(dispositionLabels("ordinary").filter(label => !label.startsWith(`${dimension}:`)));
      const result = await evaluate({ ...current, evidence: await verifiedEvidence("ordinary") });
      assert.equal(result.status, "pending");
      assert.ok(result.reasons.includes(`taxonomy_${dimension}_cardinality`));
      assert.equal(result.needsTriage, true);
      assert.equal(result.implementationCandidate, false);
      assert.equal(result.implementationEligible, false);
    });
  }
  for (const extra of [["progress:verified"], ["resolution:delivered"]]) {
    test(`${surface} composed taxonomy rejects ${extra[0]} on planned open work`, async () => {
      const current = await completedBodyAndLabels([...dispositionLabels("ordinary"), ...extra]);
      const result = await evaluate({ ...current, evidence: await verifiedEvidence("ordinary") });
      assert.equal(result.status, "pending");
      assert.equal(result.implementationEligible, false);
      assert.equal(result.implementationCandidate, false);
      assert.ok(result.reasons.some(reason => reason.startsWith("taxonomy_")));
    });
  }
  test(`${surface} composed taxonomy rejects missing observation and old pre-reopen assessment`, async () => {
    const current = await completedBodyAndLabels(dispositionLabels("ordinary"));
    const evidence = await verifiedEvidence("ordinary");
    const missing = await evaluate({ ...current, evidence, taxonomyObservation: undefined });
    assert.equal(missing.status, "pending");
    assert.ok(missing.reasons.includes("taxonomy_observation_missing_or_subject_mismatch"));
    const reopened = { ...taxonomyObservation, lifecycleId: "reopened-event-19" };
    const old = await evaluate({ ...current, evidence, taxonomyObservation: reopened });
    assert.equal(old.status, "pending"); assert.equal(old.implementationEligible, false);
    assert.ok(old.reasons.includes("taxonomy_evidence_missing_or_stale"));
    evidence.taxonomy!.lifecycleId = reopened.lifecycleId;
    const fresh = await evaluate({ ...current, evidence, taxonomyObservation: reopened });
    assert.equal(fresh.status, "complete", JSON.stringify(fresh.reasons));
    assert.equal(fresh.implementationCandidate, true);
  });
}

test("public checklist API accepts lifecycle observation and exposes pending taxonomy obligations", async () => {
  const { evaluateTriageChecklistState } = await import("../contracts/governed-intake-triage-state.evaluate.ts");
  const current = await completedBodyAndLabels(dispositionLabels("ordinary"));
  const semanticInput = { subject: actualIssue, ...observedNoImpact(), evidence: await verifiedEvidence("ordinary") };
  const valid = await evaluateTriageChecklistState(current.body, current.labels, semanticInput);
  assert.equal(valid.needs_triage, false);
  const invalid = await completedBodyAndLabels([...dispositionLabels("ordinary"), "progress:verified"]);
  const pending = await evaluateTriageChecklistState(invalid.body, invalid.labels, semanticInput);
  assert.equal(pending.needs_triage, true);
  assert.ok(pending.semantic_reasons!.includes("taxonomy_progress_cardinality"));
  assert.ok(pending.unchecked_item_ids.includes("priority-work-dimensions"));
});
