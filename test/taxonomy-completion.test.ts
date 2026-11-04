import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTaxonomy, type TaxonomyEvidence, type TaxonomyObservation } from "../contracts/governed-intake-taxonomy.evaluate.ts";
import { CURRENT_TRIAGE_REVISION } from "../contracts/governed-intake-triage-state.evaluate.ts";
import { createHash } from "node:crypto";
import * as canonicalComposition from "../contracts/governed-intake-triage.compose.ts";
import type { ComposedDeliveryInput } from "../contracts/governed-intake-triage.compose.ts";
import type { DeliveryAcceptanceObservation, DeliveryAcceptanceTree } from "../contracts/governed-intake-taxonomy.evaluate.ts";

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
    ? evaluateTaxonomy(input) : (await import("../contracts/generated/governed-intake/governed-intake-taxonomy.evaluate.js")).evaluateTaxonomy(input);

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
    input.evidence.acceptance = structuredClone(acceptance);
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

function deliveryFixture(prose = "- AC1. The accepted source correction is independently verified."): ComposedDeliveryInput {
  return { subject: { ...subject, title: "Bounded accepted delivery fixture" }, labels: [...labels], lifecycleId: observation.lifecycleId,
    body: `<!-- governed-work-unit-key: ${evidence.workUnitKey} -->\n\n## Durable fix and acceptance\n\n${prose}\n\n## Human-decision state\nNone.\n`,
    draft: { schema: "GovernedDeliveryAcceptanceDraftV1", extraction: "complete", changeKind: "ordinary",
      acceptanceFingerprint: `sha256:${createHash("sha256").update(JSON.stringify(prose)).digest("hex")}`,
      obligations: [{ id: "AC1", parentId: null, owner: subject.repository,
        original: { start: 0, end: prose.length, text: prose },
        acceptedScope: { kind: "source-only", description: "The accepted outcome is this source correction." },
        evidenceKind: "source", applicability: { status: "required", reason: "Explicit accepted source outcome." }, consumers: [] }] } };
}

function mappedObservation(tree: DeliveryAcceptanceTree): DeliveryAcceptanceObservation {
  return { schema: "GovernedDeliveryAcceptanceObservationV1", subject: structuredClone(tree.subject),
    treeFingerprint: tree.fingerprint, coverage: "complete", record: { reference: "https://example.test/independent-record", identity: "record-revision-7" },
    items: tree.nodes.map(node => ({ id: node.id, meaningFingerprint: node.meaningFingerprint,
      result: node.applicability.status === "not-applicable" ? "not-applicable" : "verified",
      evidence: [{ kind: node.evidenceKind, reference: `https://example.test/evidence/${encodeURIComponent(node.id)}`, identity: `actual-${node.id}` }],
      verifier: { actor: "independent-fixture-reviewer", reference: "https://example.test/review", identity: "review-revision-2" } })) };
}

function withConsumers(input: ComposedDeliveryInput): ComposedDeliveryInput {
  const obligation = input.draft!.obligations[0];
  obligation.acceptedScope = { kind: "consumers", description: "The accepted current and future consumer behavior." };
  obligation.consumerInventory = { coverage: "complete", reference: "https://example.test/accepted-consumer-inventory", identity: "inventory-3" };
  obligation.consumers = (["current", "default", "installed", "recovery", "future-install", "future-update", "future-repair"] as const)
    .map(phase => ({ id: phase, name: `${phase} named consumer`, entrypoint: `existing-owner/${phase}`,
      phase, applicability: { status: "required", reason: "This entrypoint is in the accepted outcome." } }));
  return input;
}

for (const surface of ["canonical", "portable"] as const) {
  const api = async () => surface === "canonical" ? canonicalComposition
    : import("../contracts/generated/governed-intake/governed-intake-triage.compose.js");

  test(`${surface} delivery rejects a caller-authored verified flag despite valid legacy taxonomy`, async () => {
    const legacy = fixture(); replace(legacy, "progress:planned", "progress:verified");
    legacy.evidence.acceptance = structuredClone(acceptance);
    assert.deepEqual(await (surface === "canonical" ? evaluateTaxonomy(legacy)
      : (await import("../contracts/generated/governed-intake/governed-intake-taxonomy.evaluate.js")).evaluateTaxonomy(legacy)), []);
    const evaluator = (await api()).evaluateGovernedIntakeDelivery;
    const input = { ...deliveryFixture(), acceptance: acceptance, verified: true };
    // Exact-original negative control exercises the previous coarse path. It
    // reaches the delivery assertion, rather than failing on a new named import.
    const delivered = typeof evaluator === "function" ? evaluator(input).status === "verified" : evaluateTaxonomy(legacy).length === 0;
    assert.equal(delivered, false, "a verified flag and PR link cannot establish independent per-obligation delivery");
  });

  test(`${surface} delivery admits independently mapped source-only work without inventing fleet obligations`, async () => {
    const owner = await api(); const input = deliveryFixture();
    const tree = owner.composeGovernedDeliveryAcceptance(input);
    assert.equal(tree.nodes.length, 1); assert.equal(tree.nodes[0].consumer, null);
    assert.equal(tree.nodes[0].evidenceKind, "source"); assert.deepEqual(tree.pendingReasons, []);
    assert.equal(owner.evaluateGovernedIntakeDelivery(input).status, "pending");
    input.observation = mappedObservation(tree);
    const result = owner.evaluateGovernedIntakeDelivery(input);
    assert.equal(result.status, "verified"); assert.deepEqual(result.reasons, []);
    assert.equal(result.effectAuthority, false);
    assert.equal(result.tree.originalAcceptance, input.draft!.obligations[0].original.text);
    assert.deepEqual(owner.composeGovernedDeliveryAcceptance(JSON.parse(JSON.stringify(input))), tree);
  });

  test(`${surface} delivery composes all explicitly named current and future consumers with the required evidence kind`, async () => {
    const owner = await api(); const input = withConsumers(deliveryFixture());
    const tree = owner.composeGovernedDeliveryAcceptance(input);
    assert.equal(tree.nodes.length, 8); assert.deepEqual(tree.pendingReasons, []);
    for (const node of tree.nodes.slice(1)) {
      assert.equal(node.parentId, "AC1");
      assert.equal(node.evidenceKind, node.consumer!.phase.startsWith("future-") ? "lifecycle" : "runtime");
      assert.equal(node.original.text, tree.originalAcceptance);
    }
    input.observation = mappedObservation(tree);
    assert.equal(owner.evaluateGovernedIntakeDelivery(input).status, "verified");
    for (const phase of ["installed", "future-repair"]) {
      const missing = structuredClone(input); missing.observation!.items = missing.observation!.items.filter(item => !item.id.endsWith(`/${phase}`));
      assert.equal(owner.evaluateGovernedIntakeDelivery(missing).status, "pending", phase);
      const sourceOnly = structuredClone(input); sourceOnly.observation!.items.find(item => item.id.endsWith(`/${phase}`))!.evidence[0].kind = "source";
      assert.equal(owner.evaluateGovernedIntakeDelivery(sourceOnly).status, "pending", `${phase} cannot use source evidence`);
    }
  });

  test(`${surface} delivery preserves original legacy prose and refuses absent, empty or partial extraction`, async () => {
    const owner = await api(); const input = deliveryFixture("First accepted outcome.\nSecond accepted outcome that was omitted.");
    const first = "First accepted outcome.";
    input.draft!.obligations[0].original = { start: 0, end: first.length, text: first };
    const tree = owner.composeGovernedDeliveryAcceptance(input);
    assert.ok(tree.pendingReasons.includes("delivery_original_obligations_unmapped"));
    assert.equal(tree.unmapped[0].text, "\nSecond accepted outcome that was omitted.");
    for (const mutate of [
      (i: ComposedDeliveryInput) => { delete i.draft; },
      (i: ComposedDeliveryInput) => { i.draft!.obligations = []; },
      (i: ComposedDeliveryInput) => { i.draft!.extraction = "partial"; },
      (i: ComposedDeliveryInput) => { i.draft!.acceptanceFingerprint = "stale"; },
    ]) {
      const changed = deliveryFixture(); mutate(changed);
      const result = owner.evaluateGovernedIntakeDelivery(changed);
      assert.equal(result.status, "pending"); assert.ok(result.tree.originalAcceptance.includes("AC1."));
    }
    for (const fields of [{ body: "" }, { labels: null }, { lifecycleId: null }, { draft: { obligations: [null] } }]) {
      const unreadable = { ...deliveryFixture(), ...fields } as unknown as ComposedDeliveryInput;
      assert.equal(owner.evaluateGovernedIntakeDelivery(unreadable).status, "pending", JSON.stringify(fields));
    }
  });

  test(`${surface} delivery rejects missing IDs, original-source drift, duplicate IDs and invalid parent graphs`, async () => {
    const owner = await api();
    for (const mutate of [
      (i: ComposedDeliveryInput) => { i.draft!.obligations[0].id = ""; },
      (i: ComposedDeliveryInput) => { i.draft!.obligations[0].original.text = "A different obligation."; },
      (i: ComposedDeliveryInput) => { i.draft!.obligations.push(structuredClone(i.draft!.obligations[0])); },
      (i: ComposedDeliveryInput) => { i.draft!.obligations[0].parentId = "missing"; },
      (i: ComposedDeliveryInput) => { i.draft!.obligations[0].parentId = "AC1"; },
    ]) {
      const input = deliveryFixture(); mutate(input); const tree = owner.composeGovernedDeliveryAcceptance(input);
      input.observation = mappedObservation(tree); assert.equal(owner.evaluateGovernedIntakeDelivery(input).status, "pending");
    }
  });

  test(`${surface} delivery does not infer inventory completeness or applicability`, async () => {
    const owner = await api();
    for (const mutate of [
      (i: ComposedDeliveryInput) => { delete i.draft!.obligations[0].consumerInventory; },
      (i: ComposedDeliveryInput) => { i.draft!.obligations[0].consumerInventory!.coverage = "unknown"; },
      (i: ComposedDeliveryInput) => { i.draft!.obligations[0].consumers = []; },
      (i: ComposedDeliveryInput) => { i.draft!.obligations[0].consumers[0].entrypoint = ""; },
      (i: ComposedDeliveryInput) => { i.draft!.obligations[0].consumers[0].applicability.status = "unknown"; },
      (i: ComposedDeliveryInput) => { i.draft!.obligations[0].consumers.push(structuredClone(i.draft!.obligations[0].consumers[0])); },
      (i: ComposedDeliveryInput) => { i.draft!.obligations[0].acceptedScope.kind = "source-only"; },
    ]) {
      const input = withConsumers(deliveryFixture()); mutate(input); const tree = owner.composeGovernedDeliveryAcceptance(input);
      input.observation = mappedObservation(tree); assert.equal(owner.evaluateGovernedIntakeDelivery(input).status, "pending");
    }
  });

  test(`${surface} delivery keeps unsupported migration deletion and new-owner propagation branches pending`, async () => {
    const owner = await api();
    for (const kind of ["migration", "deletion", "new-owner", "unknown"] as const) {
      const input = deliveryFixture(); input.draft!.changeKind = kind;
      input.observation = mappedObservation(owner.composeGovernedDeliveryAcceptance(input));
      assert.equal(owner.evaluateGovernedIntakeDelivery(input).status, "pending", kind);
    }
    for (const label of ["type:migration", "type:deletion"]) {
      const input = deliveryFixture(); input.labels = [...input.labels, label];
      input.observation = mappedObservation(owner.composeGovernedDeliveryAcceptance(input));
      assert.equal(owner.evaluateGovernedIntakeDelivery(input).status, "pending", "labels cannot be hidden by an ordinary draft");
    }
  });

  test(`${surface} delivery changes only affected node meaning and permits explicit mapping of unchanged evidence`, async () => {
    const owner = await api(); const first = "First source outcome."; const second = "Second source outcome.";
    const input = deliveryFixture(`${first}\n${second}`);
    input.draft!.obligations[0].original = { start: 0, end: first.length, text: first };
    input.draft!.obligations.push({ ...structuredClone(input.draft!.obligations[0]), id: "AC2",
      original: { start: first.length + 1, end: first.length + 1 + second.length, text: second } });
    const before = owner.composeGovernedDeliveryAcceptance(input); const oldFacts = mappedObservation(before);
    const expanded = "First source outcome with changed accepted meaning.";
    const changed = deliveryFixture(`${expanded}\n${second}`);
    changed.draft!.obligations = structuredClone(input.draft!.obligations);
    changed.draft!.obligations[0].original = { start: 0, end: expanded.length, text: expanded };
    changed.draft!.obligations[1].original = { start: expanded.length + 1, end: expanded.length + 1 + second.length, text: second };
    const after = owner.composeGovernedDeliveryAcceptance(changed);
    assert.notEqual(after.nodes[0].meaningFingerprint, before.nodes[0].meaningFingerprint);
    assert.equal(after.nodes[1].meaningFingerprint, before.nodes[1].meaningFingerprint, "position shifts do not change accepted meaning");
    changed.observation = { ...mappedObservation(after), items: oldFacts.items };
    const partial = owner.evaluateGovernedIntakeDelivery(changed);
    assert.equal(partial.status, "pending"); assert.equal(partial.items[0].status, "pending"); assert.equal(partial.items[1].status, "verified");
    changed.observation.items[0] = mappedObservation(after).items[0];
    assert.equal(owner.evaluateGovernedIntakeDelivery(changed).status, "verified");
  });

  test(`${surface} delivery requires explicit independently mapped non-applicability and never admits an all-waived empty outcome`, async () => {
    const owner = await api(); const input = withConsumers(deliveryFixture());
    const consumer = input.draft!.obligations[0].consumers[0];
    consumer.applicability = { status: "not-applicable", reason: "This inventory entry is outside the accepted current scope." };
    const tree = owner.composeGovernedDeliveryAcceptance(input); input.observation = mappedObservation(tree);
    assert.equal(tree.nodes[1].evidenceKind, "applicability");
    assert.equal(input.observation.items[1].evidence[0].kind, "applicability");
    assert.equal(owner.evaluateGovernedIntakeDelivery(input).status, "verified");
    const authorWaiver = structuredClone(input); delete authorWaiver.observation;
    assert.equal(owner.evaluateGovernedIntakeDelivery(authorWaiver).status, "pending", "author's exclusion needs an independent mapping");
    const wrongKind = structuredClone(input); wrongKind.observation!.items[1].evidence[0].kind = "runtime";
    assert.equal(owner.evaluateGovernedIntakeDelivery(wrongKind).status, "pending", "runtime invocation is not the exclusion evidence");
    const otherExclusion = structuredClone(input); otherExclusion.draft!.obligations[0].consumers[0].applicability.reason = "A different exclusion claim.";
    const freshTree = owner.composeGovernedDeliveryAcceptance(otherExclusion);
    otherExclusion.observation = { ...mappedObservation(freshTree), items: input.observation.items };
    assert.equal(owner.evaluateGovernedIntakeDelivery(otherExclusion).status, "pending", "changed exclusion meaning cannot reuse the old proof");
    input.observation.items[1].result = "verified";
    assert.equal(owner.evaluateGovernedIntakeDelivery(input).status, "pending");
    const waived = deliveryFixture(); waived.draft!.obligations[0].applicability.status = "not-applicable";
    waived.observation = mappedObservation(owner.composeGovernedDeliveryAcceptance(waived));
    assert.equal(owner.evaluateGovernedIntakeDelivery(waived).status, "pending");
  });

  test(`${surface} delivery binds independently observed records to current lifecycle, tree and exact required items`, async () => {
    const owner = await api(); const input = deliveryFixture(); input.observation = mappedObservation(owner.composeGovernedDeliveryAcceptance(input));
    for (const mutate of [
      (i: ComposedDeliveryInput) => { i.lifecycleId = "github-reopen-32"; },
      (i: ComposedDeliveryInput) => { i.observation!.subject.workUnitKey = "other"; },
      (i: ComposedDeliveryInput) => { i.observation!.treeFingerprint = "stale"; },
      (i: ComposedDeliveryInput) => { i.observation!.coverage = "incomplete"; },
      (i: ComposedDeliveryInput) => { i.observation!.record.identity = ""; },
      (i: ComposedDeliveryInput) => { i.observation!.items[0].verifier.actor = ""; },
      (i: ComposedDeliveryInput) => { i.observation!.items[0].evidence = []; },
      (i: ComposedDeliveryInput) => { i.observation!.items[0].result = "failed"; },
      (i: ComposedDeliveryInput) => { i.observation!.items.push(structuredClone(i.observation!.items[0])); },
      (i: ComposedDeliveryInput) => { i.observation!.items.push({ ...structuredClone(i.observation!.items[0]), id: "unknown" }); },
    ]) {
      const changed = structuredClone(input); mutate(changed);
      assert.equal(owner.evaluateGovernedIntakeDelivery(changed).status, "pending");
    }
    const first = owner.composeGovernedDeliveryAcceptance(input);
    first.nodes[0].definition.requirement = "tampered returned snapshot";
    first.nodes[0].applicability.reason = "tampered reason";
    assert.equal(owner.evaluateGovernedIntakeDelivery(input).status, "verified", "returned trees cannot mutate the contract or draft");
  });
}
