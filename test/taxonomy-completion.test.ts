import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTaxonomy, type TaxonomyEvidence, type TaxonomyObservation } from "../contracts/governed-intake-taxonomy.evaluate.ts";
import { CURRENT_TRIAGE_REVISION } from "../contracts/governed-intake-triage-state.evaluate.ts";

const subject = { repository: "spencer-shadley/.github", issueNumber: 32 };
const labels = ["type:maintenance", "source:human", "effort:medium", "priority:repo:p2", "priority:fleet:p2", "progress:planned", "decomp:unnecessary"];
const observation: TaxonomyObservation = { ...subject, state: "open", lifecycleId: "github-creation-32" };
const evidence: TaxonomyEvidence = { workUnitKey: `sha256:${"a".repeat(64)}`, scopeFingerprint: `sha256:${"b".repeat(64)}`,
  revision: CURRENT_TRIAGE_REVISION, lifecycleId: observation.lifecycleId };
const fixture = () => structuredClone({ labels, subject, state: "open" as "open" | "closed", observation, evidence,
  workUnitKey: evidence.workUnitKey, scopeFingerprint: evidence.scopeFingerprint });
type Input = ReturnType<typeof fixture>;
const acceptance = { verified: true, headSha: "c".repeat(40), receiptUrl: "https://github.com/spencer-shadley/.github/pull/53#issuecomment-1" };
const close = (input: Input, resolution: string) => {
  input.state = "closed";
  input.observation.state = "closed";
  input.observation.lifecycleId = "github-close-32";
  input.evidence.lifecycleId = input.observation.lifecycleId;
  input.observation.previousProgress = "progress:planned";
  input.labels.push(resolution);
};
const replace = (input: Input, from: string, to: string) => { input.labels = input.labels.filter(label => label !== from); input.labels.push(to); };

// Both surfaces execute the very same fixtures; portable bytes are committed,
// manifest-verified elsewhere, and never rewritten by these tests.
for (const surface of ["canonical", "portable"] as const) {
  const evaluate = async (input: Parameters<typeof evaluateTaxonomy>[0]) => surface === "canonical"
    ? evaluateTaxonomy(input) : (await import("../contracts/generated/governed-intake/taxonomy-evaluator.js")).evaluateTaxonomy(input);

  test(`${surface} taxonomy accepts independent multi-value dimensions and unrelated overlays`, async () => {
    const input = fixture();
    input.labels.push("type:migration", "type:deletion", "type:proposal", "source:retro-skill:weekly-audit",
      "source:scheduled-task:weekly-sync", "delivers:reliability", "delivers:cost-efficiency", "agent-review", "triaged-by-fixture-model-high");
    assert.deepEqual(await evaluate(input), []);
  });

  for (const name of ["type", "source", "effort", "priority:repo", "priority:fleet", "progress"]) {
    test(`${surface} taxonomy refuses missing ${name}`, async () => {
      const input = fixture(); input.labels = input.labels.filter(label => !label.startsWith(`${name}:`));
      assert.ok((await evaluate(input)).includes(`taxonomy_${name}_cardinality`));
    });
  }
  for (const [name, label] of [["effort", "effort:high"], ["priority:repo", "priority:repo:p3"],
    ["priority:fleet", "priority:fleet:p1"], ["progress", "progress:verified"], ["decomp", "decomp:complete"]]) {
    test(`${surface} taxonomy refuses conflicting ${name}`, async () => {
      const input = fixture(); input.labels.push(label);
      assert.ok((await evaluate(input)).includes(`taxonomy_${name}_cardinality`));
    });
  }
  for (const [name, label] of [["type", "type:unknown"], ["source", "source:scheduled-task:BAD"],
    ["priority:repo", "priority:repo:p6"], ["blocked", "blocked:provider"], ["environment", "environment:cloud"],
    ["progress", "progress:done"], ["resolution", "resolution:success"]]) {
    test(`${surface} taxonomy refuses unsupported ${label} beside a valid sibling`, async () => {
      const input = fixture(); input.labels.push(label);
      assert.ok((await evaluate(input)).includes(`taxonomy_${name}_unsupported_label`));
    });
  }

  test(`${surface} taxonomy validates verified progress and open/closed delivery`, async () => {
    const input = fixture(); input.labels.push("resolution:delivered");
    const invalid = await evaluate(input);
    assert.ok(invalid.includes("taxonomy_resolution_cardinality"));
    assert.ok(invalid.includes("taxonomy_delivered_requires_verified_progress"));
    replace(input, "progress:planned", "progress:verified");
    assert.ok((await evaluate(input)).includes("taxonomy_verified_acceptance_required"));
    input.evidence.acceptance = acceptance;
    assert.ok((await evaluate(input)).includes("taxonomy_resolution_cardinality"), "verified delivery is still invalid while open");
    input.labels = input.labels.filter(label => !label.startsWith("resolution:"));
    assert.deepEqual(await evaluate(input), [], "verified open work is allowed with real acceptance");
    close(input, "resolution:delivered");
    assert.deepEqual(await evaluate(input), []);
    input.evidence.acceptance.headSha = "0".repeat(40);
    assert.ok((await evaluate(input)).includes("taxonomy_verified_acceptance_required"));
  });

  test(`${surface} taxonomy enforces closed resolution and preserves non-delivery progress`, async () => {
    const input = fixture(); close(input, "resolution:declined");
    assert.deepEqual(await evaluate(input), []);
    replace(input, "progress:planned", "progress:implemented");
    assert.ok((await evaluate(input)).includes("taxonomy_non_delivery_progress_changed_or_unknown"));
    replace(input, "progress:implemented", "progress:planned");
    input.labels.push("resolution:duplicate");
    assert.ok((await evaluate(input)).includes("taxonomy_resolution_cardinality"));
    input.labels = input.labels.filter(label => !label.startsWith("resolution:"));
    assert.ok((await evaluate(input)).includes("taxonomy_resolution_cardinality"));
  });

  test(`${surface} taxonomy rejects pre-reopen assessment despite unchanged body/label scope`, async () => {
    const input = fixture(); input.observation.lifecycleId = "github-reopen-32";
    assert.ok((await evaluate(input)).includes("taxonomy_evidence_missing_or_stale"));
    input.evidence.lifecycleId = input.observation.lifecycleId;
    assert.deepEqual(await evaluate(input), []);
    input.labels.push("resolution:duplicate");
    assert.ok((await evaluate(input)).includes("taxonomy_resolution_cardinality"));
  });

  test(`${surface} taxonomy binds observation/evidence to actual subject, scope, revision and state`, async () => {
    for (const mutate of [
      (i: Input) => { i.observation.issueNumber++; },
      (i: Input) => { i.observation.repository = "spencer-shadley/code"; },
      (i: Input) => { i.observation.state = "closed"; },
      (i: Input) => { i.evidence.scopeFingerprint = "stale"; },
      (i: Input) => { i.evidence.workUnitKey = "other"; },
      (i: Input) => { i.evidence.revision--; },
    ]) {
      const input = fixture(); mutate(input); assert.notDeepEqual(await evaluate(input), []);
    }
    const input = fixture();
    assert.ok((await evaluate({ ...input, observation: undefined })).includes("taxonomy_observation_missing_or_subject_mismatch"));
    assert.ok((await evaluate({ ...input, evidence: undefined })).includes("taxonomy_evidence_missing_or_stale"));
  });

  test(`${surface} taxonomy requires regression references and permits research negative/inconclusive results`, async () => {
    const input = fixture(); input.labels.push("type:bug", "type:regression");
    assert.ok((await evaluate(input)).includes("taxonomy_regression_reference_required"));
    input.evidence.regressionReference = "https://github.com/spencer-shadley/.github/issues/19#issuecomment-1";
    assert.deepEqual(await evaluate(input), []);
    input.labels.push("type:research"); close(input, "resolution:declined");
    assert.ok((await evaluate(input)).includes("taxonomy_research_conclusion_required"));
    for (const conclusion of ["positive", "negative", "inconclusive"] as const) {
      input.evidence.researchConclusion = conclusion; assert.deepEqual(await evaluate(input), []);
    }
  });

  test(`${surface} taxonomy binds independent blockers to release predicates and actual human input`, async () => {
    const input = fixture(); input.labels.push("blocked:time", "blocked:human-required", "blocked:issue");
    assert.ok((await evaluate(input)).includes("taxonomy_blocker_evidence_required"));
    input.evidence.blockers = [
      { label: "blocked:time", releasePredicate: "The event's announced date arrives." },
      { label: "blocked:human-required", releasePredicate: "Hardware access is restored.", humanInput: "Connect the camera physically." },
      { label: "blocked:issue", releasePredicate: "Consumer readback on Code #7625 passes." },
    ];
    assert.deepEqual(await evaluate(input), []);
    delete input.evidence.blockers[1].humanInput;
    assert.ok((await evaluate(input)).includes("taxonomy_blocker_evidence_required"));
  });

  test(`${surface} taxonomy conserves superseded destination and obsolete decision/backlink`, async () => {
    const input = fixture(); close(input, "resolution:superseded");
    assert.ok((await evaluate(input)).includes("taxonomy_superseded_destination_required"));
    input.evidence.supersededDestination = "https://github.com/spencer-shadley/code/issues/7586";
    assert.deepEqual(await evaluate(input), []);
    replace(input, "resolution:superseded", "resolution:obsolete");
    assert.ok((await evaluate(input)).includes("taxonomy_obsolete_decision_required"));
    input.evidence.obsoleteDecision = { accepted: true, noRemainingValue: true,
      causingIssue: "https://github.com/spencer-shadley/code/issues/7586",
      decisionUrl: "https://github.com/spencer-shadley/code/issues/7586#issuecomment-1",
      backlinkUrl: "https://github.com/spencer-shadley/code/issues/7586#issuecomment-2" };
    assert.deepEqual(await evaluate(input), []);
    input.evidence.obsoleteDecision.accepted = false;
    assert.ok((await evaluate(input)).includes("taxonomy_obsolete_decision_required"));
  });
}
