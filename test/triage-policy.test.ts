import test from 'node:test';
import assert from 'node:assert/strict';
import rawPolicy from '../contracts/governed-intake-triage-policy.v1.json' with { type: 'json' };
import {
  assertTriagePolicy, evaluateTriagePolicy, evaluateImplementationCandidate,
  planRetiredProgressLabelCleanup, fingerprintAssessment,
  type Assessment, type BoundTriagePolicy, type PolicySnapshot, type QualifiedReceipt, type TriagePolicy,
} from '../contracts/governed-intake-triage-policy.evaluate.ts';

const policy = rawPolicy as TriagePolicy;
const release: BoundTriagePolicy = { policy, policyIdentity: 'verified-producer:policy-1', rubricIdentity: 'verified-producer:rubric-1' };
const subject = { workUnitKey: 'sha256:unit', scopeFingerprint: 'sha256:scope', policyIdentity: release.policyIdentity, rubricIdentity: release.rubricIdentity };
function receipt(id: string, role: QualifiedReceipt['role'], assessmentFingerprint: string, family: string): QualifiedReceipt {
  const identity = { bindingId: `binding-${family}`, provider: `provider-${family}`, modelFamily: family,
    modelId: `model-${family}`, configurationId: 'qualified-config' };
  return { ...subject, id, role, routePolicyIdentity: 'verified-router:release-1', requiredCapability: `floor:${role}`,
    admitted: true, servingVerified: true, selected: { ...identity }, served: { ...identity }, verdict: 'agree', assessmentFingerprint };
}
async function snapshot(disposition: Assessment['disposition'] = 'ordinary'): Promise<PolicySnapshot> {
  const effort = disposition === 'ordinary' ? 'medium' : 'high';
  const assessment: Assessment = {
    ...subject, disposition, effort, assessmentFingerprint: '', rationale: 'Current residual and evidence establish this scope.',
    verification: 'Run the named regression suite and inspect exact output.', resumability: 'Persist revision and checkpoints under generic custody.',
    confidence: 'high', blockingAssessmentUnknowns: [], implementationUnknowns: [],
    ...(disposition === 'atomic-high' ? { invariant: 'One coupled invariant must hold throughout the correction.',
      difficultyRationale: 'Concrete coupled-correctness reasoning remains.', alternativesConsidered: 'A staged split would not provide a separately verifiable unit under this invariant.' } : {}),
  };
  const graphFingerprint = disposition === 'parent' ? 'sha256:current-graph' : null;
  assessment.assessmentFingerprint = await fingerprintAssessment(assessment, graphFingerprint);
  const result: PolicySnapshot = {
    ...subject, state: 'open', repositoryActive: true, labels: [...policy.dispositions[disposition].labels, policy.effortRubric.labels[effort]],
    priorHighEffort: effort === 'high', requiresQualifiedAssessment: disposition !== 'ordinary', assessment,
    currentGraphFingerprint: graphFingerprint, hasExecutableChildGraph: disposition === 'parent',
    finalAttributesScopeFingerprint: subject.scopeFingerprint, checklistCurrentAndComplete: true, directionEvidenceFresh: true,
    trusted: { admissions: [], graphs: [], requiredCapabilities: {
      'scope-assessment': 'floor:scope-assessment', 'atomic-confirmation': 'floor:atomic-confirmation', implementation: 'floor:implementation',
    } },
  };
  if (disposition !== 'ordinary') {
    assessment.assessorReceiptId = 'assessor';
    result.trusted.admissions.push(receipt('assessor', 'scope-assessment', assessment.assessmentFingerprint, 'a'));
  }
  if (disposition === 'atomic-high') {
    assessment.confirmationReceiptId = 'confirmer';
    result.trusted.admissions.push(receipt('confirmer', 'atomic-confirmation', assessment.assessmentFingerprint, 'b'));
  }
  if (disposition === 'parent') {
    assessment.graphReceiptId = 'graph';
    result.trusted.graphs.push({ ...subject, id: 'graph', graphFingerprint: graphFingerprint!, validatorIdentity: 'verified-code-core:revision',
      valid: true, coverageComplete: true, canonicalRelationshipsReadBack: true, requiredLeafTriageComplete: true });
  }
  return result;
}
const reason = (actual: { reasons: string[] }, expected: string) => assert.ok(actual.reasons.includes(expected), JSON.stringify(actual));

test('source contract has one coherent vocabulary, ordinary/atomic/parent outcomes and no progress state', () => {
  assertTriagePolicy(policy);
  assert.deepEqual(policy.dispositions['atomic-high'].efforts, ['high']);
  assert.deepEqual(policy.dispositions['atomic-high'].labels, ['decomp-atomic']);
  assert.equal(policy.dispositions.parent.trackingOnly, true);
  assert.ok(!Object.values(policy.dispositions).flatMap(item => item.labels).includes('decomp-in-progress'));
});
for (const kind of ['ordinary', 'atomic-high', 'parent'] as const) {
  test(`valid ${kind} passes triage with shape-appropriate implementation candidacy`, async () => {
    const s = await snapshot(kind); const before = structuredClone(s);
    const result = await evaluateTriagePolicy(release, s);
    assert.equal(result.scopeResolved, true); assert.equal(result.needsTriage, false);
    assert.equal(result.implementationCandidate, kind !== 'parent'); assert.deepEqual(s, before);
  });
}
for (const kind of ['ordinary', 'atomic-high', 'parent'] as const) {
  test(`legacy progress label does not hide or invalidate a valid ${kind}`, async () => {
    const s = await snapshot(kind); s.labels.push('decomp-in-progress');
    const result = await evaluateTriagePolicy(release, s);
    assert.equal(result.needsTriage, false); assert.deepEqual(result.legacyLabelsToRemove, ['decomp-in-progress']);
  });
}
test('unfinished issue stays discoverable despite legacy running label or original worker loss', async () => {
  const s = await snapshot(); s.assessment = null; s.labels = ['decomp-in-progress'];
  const result = await evaluateTriagePolicy(release, s);
  assert.equal(result.inScope, true); assert.equal(result.needsTriage, true);
  reason(result, 'missing_or_unsupported_scope_disposition');
});
test('failed legacy cleanup is not a semantic admission dependency', async () => {
  const s = await snapshot('atomic-high'); s.labels.push('decomp-in-progress');
  assert.deepEqual(await evaluateTriagePolicy(release, s), await evaluateTriagePolicy(release, s));
  assert.equal((await evaluateTriagePolicy(release, s)).implementationCandidate, true);
});
test('cleanup removes only the retired projection, never children/provenance/effort/stages', () => {
  const labels = ['work:planned', 'triaged-by-example-high', 'effort:high', 'decomp-atomic', 'decomp-in-progress'];
  const before = [...labels]; assert.deepEqual(planRetiredProgressLabelCleanup(policy, labels), ['decomp-in-progress']);
  assert.deepEqual(labels, before);
});
for (const kind of ['ordinary', 'atomic-high', 'parent'] as const) {
  test(`${kind} pending obligation cannot be stamped complete`, async () => {
    const s = await snapshot(kind); s.labels.push('decomp-needed');
    const result = await evaluateTriagePolicy(release, s);
    assert.equal(result.needsTriage, true); reason(result, 'unresolved_decomposition_obligation');
  });
}
for (const field of ['rationale', 'verification', 'resumability'] as const) {
  test(`assessment requires ${field}`, async () => {
    const s = await snapshot(); s.assessment![field] = '';
    reason(await evaluateTriagePolicy(release, s), `missing_assessment_field:${field}`);
  });
}
for (const field of ['invariant', 'difficultyRationale', 'alternativesConsidered'] as const) {
  test(`atomic assessment requires ${field}`, async () => {
    const s = await snapshot('atomic-high'); delete s.assessment![field];
    reason(await evaluateTriagePolicy(release, s), `missing_atomic_field:${field}`);
  });
}
test('editing rationale without a new fingerprint/confirmation is rejected', async () => {
  const s = await snapshot('atomic-high'); s.assessment!.rationale = 'Changed judgment with old approval';
  reason(await evaluateTriagePolicy(release, s), 'assessment_content_fingerprint_mismatch');
});
test('attaching receipt pointers does not change the semantic assessment fingerprint', async () => {
  const s = await snapshot('atomic-high'); const first = await fingerprintAssessment(s.assessment!, null);
  s.assessment!.confirmationReceiptId = 'another-pointer';
  assert.equal(await fingerprintAssessment(s.assessment!, null), first);
});
for (const field of ['scopeFingerprint', 'workUnitKey', 'policyIdentity', 'rubricIdentity'] as const) {
  test(`assessment binds exact ${field}`, async () => {
    const s = await snapshot('atomic-high'); s.assessment![field] = 'other';
    reason(await evaluateTriagePolicy(release, s), 'stale_scope_or_policy_evidence');
  });
}
test('old assessment and receipts cannot agree with one another under a different loaded policy', async () => {
  const s = await snapshot();
  reason(await evaluateTriagePolicy({ ...release, policyIdentity: 'new-producer-policy' }, s), 'unsupported_policy_or_rubric_identity');
});
for (const mutate of [
  (s: PolicySnapshot) => { s.assessment!.confidence = 'low'; },
  (s: PolicySnapshot) => { s.assessment!.blockingAssessmentUnknowns = ['material unresolved assessment evidence']; },
]) {
  test('uncertain evidence is pending, not invented low/high completion', async () => {
    const s = await snapshot(); mutate(s);
    reason(await evaluateTriagePolicy(release, s), 'unresolved_assessment_uncertainty');
  });
}
for (const labels of [['decomp-not-needed', 'effort:high'], ['decomp-atomic', 'effort:medium']]) {
  test(`reject incoherent effort/disposition ${labels.join(' + ')}`, async () => {
    const s = await snapshot(labels.includes('decomp-atomic') ? 'atomic-high' : 'ordinary'); s.labels = labels;
    reason(await evaluateTriagePolicy(release, s), 'effort_disposition_mismatch');
  });
}
for (const label of ['decomp', 'epic', 'decomp-not-needed']) {
  test(`atomic cannot coexist with ${label}`, async () => {
    const s = await snapshot('atomic-high'); s.labels.push(label);
    reason(await evaluateTriagePolicy(release, s), 'conflicting_or_missing_disposition_labels');
  });
}
for (const alias of policy.unsupportedTerminalAliases) {
  test(`legacy alias ${alias} does not certify an atomic leaf`, async () => {
    const s = await snapshot('atomic-high'); s.labels.push(alias);
    reason(await evaluateTriagePolicy(release, s), 'unsupported_decomposition_alias');
  });
}
for (const labels of [[], ['decomp-not-needed'], ['decomp-not-needed', 'effort:medium', 'effort:low']]) {
  test(`requires exactly one honest effort: ${JSON.stringify(labels)}`, async () => {
    const s = await snapshot(); s.labels = labels;
    reason(await evaluateTriagePolicy(release, s), 'effort_not_exactly_one');
  });
}
test('cheap assessor cannot downgrade a previously-high issue', async () => {
  const s = await snapshot(); s.priorHighEffort = true;
  reason(await evaluateTriagePolicy(release, s), 'scope-assessment:missing_or_duplicate_receipt');
});
test('qualified evidence can genuinely correct an inflated high classification', async () => {
  const s = await snapshot(); s.priorHighEffort = true; s.assessment!.assessorReceiptId = 'correction';
  s.trusted.admissions.push(receipt('correction', 'scope-assessment', s.assessment!.assessmentFingerprint, 'a'));
  assert.equal((await evaluateTriagePolicy(release, s)).needsTriage, false);
});
test('difficult mislabeled work requires qualified assessment before ordinary completion', async () => {
  const s = await snapshot(); s.requiresQualifiedAssessment = true;
  reason(await evaluateTriagePolicy(release, s), 'scope-assessment:missing_or_duplicate_receipt');
});
for (const role of ['scope-assessment', 'atomic-confirmation'] as const) {
  for (const fault of ['missing', 'duplicate', 'denied', 'unverified', 'substitution', 'wrong-floor', 'dissent', 'different-assessment'] as const) {
    test(`${role} rejects ${fault}`, async () => {
      const s = await snapshot('atomic-high'); const found = s.trusted.admissions.find(r => r.role === role)!;
      if (fault === 'missing') s.trusted.admissions = s.trusted.admissions.filter(r => r !== found);
      if (fault === 'duplicate') s.trusted.admissions.push(structuredClone(found));
      if (fault === 'denied') found.admitted = false;
      if (fault === 'unverified') found.servingVerified = false;
      if (fault === 'substitution') found.served.configurationId = 'weaker-serving';
      if (fault === 'wrong-floor') found.requiredCapability = 'routine';
      if (fault === 'dissent') found.verdict = 'disagree';
      if (fault === 'different-assessment') found.assessmentFingerprint = 'sha256:other';
      const result = await evaluateTriagePolicy(release, s);
      assert.equal(result.needsTriage, true); assert.ok(result.reasons.some(r => r.startsWith(role)), JSON.stringify(result));
    });
  }
}
for (const field of ['provider', 'modelFamily'] as const) {
  test(`atomic confirmation requires distinct ${field}, not another session`, async () => {
    const s = await snapshot('atomic-high'); const [a, b] = s.trusted.admissions;
    b.selected[field] = a.selected[field]; b.served[field] = a.served[field];
    reason(await evaluateTriagePolicy(release, s), 'atomic_confirmation_not_independent');
  });
}
test('qualified atomic leaf is not automatically admitted to a cheap executor', async () => {
  const s = await snapshot('atomic-high');
  reason(await evaluateImplementationCandidate(release, s), 'implementation:missing_or_duplicate_receipt');
});
test('atomic leaf with exact admitted executor becomes an implementation candidate', async () => {
  const s = await snapshot('atomic-high'); s.trusted.admissions.push(receipt('executor', 'implementation', s.assessment!.assessmentFingerprint, 'c'));
  assert.equal((await evaluateImplementationCandidate(release, s, 'executor')).eligible, true);
});
test('below-floor or substituted executor is rejected even after valid atomic triage', async () => {
  const s = await snapshot('atomic-high'); const executor = receipt('executor', 'implementation', s.assessment!.assessmentFingerprint, 'c');
  executor.admitted = false; s.trusted.admissions.push(executor);
  assert.equal((await evaluateImplementationCandidate(release, s, 'executor')).eligible, false);
});
test('tracking parent is never implementation work', async () => {
  const s = await snapshot('parent'); assert.equal((await evaluateImplementationCandidate(release, s)).eligible, false);
});
for (const fault of ['missing', 'duplicate', 'invalid', 'coverage', 'relationships', 'stale'] as const) {
  test(`parent graph receipt rejects ${fault}`, async () => {
    const s = await snapshot('parent'); const graph = s.trusted.graphs[0];
    if (fault === 'missing') s.trusted.graphs = [];
    if (fault === 'duplicate') s.trusted.graphs.push(structuredClone(graph));
    if (fault === 'invalid') graph.valid = false;
    if (fault === 'coverage') graph.coverageComplete = false;
    if (fault === 'relationships') graph.canonicalRelationshipsReadBack = false;
    if (fault === 'stale') graph.graphFingerprint = 'other';
    const result = await evaluateTriagePolicy(release, s);
    assert.equal(result.needsTriage, true); assert.ok(result.reasons.some(r => r.includes('graph_receipt')));
  });
}
test('resolved parent graph can precede leaf triage without asserting parent completion', async () => {
  const s = await snapshot('parent'); s.trusted.graphs[0].requiredLeafTriageComplete = false;
  const result = await evaluateTriagePolicy(release, s);
  assert.equal(result.scopeResolved, true); assert.equal(result.needsTriage, true); reason(result, 'required_leaf_triage_incomplete');
});
test('atomic status cannot conceal a current executable child graph', async () => {
  const s = await snapshot('atomic-high'); s.hasExecutableChildGraph = true;
  reason(await evaluateTriagePolicy(release, s), 'leaf_contradicts_current_child_graph');
});
test('shape resolution precedes final attributes; old attribute fingerprint cannot pass', async () => {
  const s = await snapshot(); s.finalAttributesScopeFingerprint = 'prior-scope';
  const result = await evaluateTriagePolicy(release, s);
  assert.equal(result.scopeResolved, true); reason(result, 'final_attributes_not_bound_to_current_scope');
});
test('checklist and direction remain separate required completion gates', async () => {
  const s = await snapshot(); s.checklistCurrentAndComplete = false; s.directionEvidenceFresh = false;
  const result = await evaluateTriagePolicy(release, s);
  assert.equal(result.scopeResolved, true); reason(result, 'current_checklist_incomplete'); reason(result, 'direction_evidence_stale');
});
for (const field of ['closed', 'archived'] as const) {
  test(`${field} work is excluded from action, not converted to successful triage`, async () => {
    const s = await snapshot(); if (field === 'closed') s.state = 'closed'; else s.repositoryActive = false;
    const result = await evaluateTriagePolicy(release, s);
    assert.equal(result.inScope, false); assert.equal(result.implementationCandidate, false); assert.equal(result.scopeResolved, false);
  });
}
for (const malformed of [null, {}, { state: 'open' }, { labels: [1] }]) {
  test(`malformed input is typed non-success: ${JSON.stringify(malformed)}`, async () => {
    reason(await evaluateTriagePolicy(release, malformed), 'malformed_policy_snapshot');
  });
}
test('malformed assessment is pending and does not throw', async () => {
  const s = await snapshot(); s.assessment = {} as Assessment;
  assert.equal((await evaluateTriagePolicy(release, s)).needsTriage, true);
});
test('missing release binding is an error, never a private default', async () => {
  await assert.rejects(evaluateTriagePolicy({ ...release, policyIdentity: '' }, await snapshot()), /unbound_policy_release/);
});
test('source rubric has conditional examples and no hardcoded model selector', () => {
  assert.equal(rawPolicy.examples.length, 12);
  for (const example of rawPolicy.examples) assert.ok(example.assumptions.length > 0);
  for (const band of ['low', 'medium', 'high']) assert.ok(rawPolicy.examples.some(example => example.effort === band));
  assert.equal(rawPolicy.capabilityPolicy.modelNamesInThisContract, false);
  for (const name of ['Grok 4.7', 'Opus 5.5', 'Gemini 3.8', 'Codex Astra']) assert.ok(!JSON.stringify(rawPolicy).includes(name));
});

test('implementation unknowns do not require implementation to be solved before atomic triage', async () => {
  const s = await snapshot('atomic-high');
  s.assessment!.implementationUnknowns = ['The final synchronization algorithm still needs implementation research.'];
  s.assessment!.assessmentFingerprint = await fingerprintAssessment(s.assessment!, null);
  for (const admission of s.trusted.admissions) admission.assessmentFingerprint = s.assessment!.assessmentFingerprint;
  assert.equal((await evaluateTriagePolicy(release, s)).needsTriage, false);
});

test('new unlabeled issue can resolve scope before publishing final effort/shape labels', async () => {
  const s = await snapshot('atomic-high'); s.labels = [];
  s.finalAttributesScopeFingerprint = null; s.checklistCurrentAndComplete = false;
  const result = await evaluateTriagePolicy(release, s);
  assert.equal(result.scopeResolved, true);
  assert.equal(result.needsTriage, true); assert.equal(result.implementationCandidate, false);
  reason(result, 'effort_not_exactly_one');
});
test('validated replacement evidence can resolve shape while old labels still require reconciliation', async () => {
  const s = await snapshot('atomic-high'); s.labels = ['decomp-not-needed', 'effort:high', 'decomp-needed'];
  const result = await evaluateTriagePolicy(release, s);
  assert.equal(result.scopeResolved, true); assert.equal(result.needsTriage, true);
  reason(result, 'conflicting_or_missing_disposition_labels');
});
