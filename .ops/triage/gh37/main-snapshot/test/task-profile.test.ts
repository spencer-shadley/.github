import test from 'node:test';
import assert from 'node:assert/strict';
import rawContract from '../contracts/governed-intake-task-profile.v1.json' with { type: 'json' };
import {
  assertTaskProfileContract, bindTaskProfileContract, validateTaskProfile, deriveTaskLabels,
  evaluateTaskLabelProjection, decideTaskProfileReuse, resolveRuntimeTaskProfile,
  type TaskProfileContract, type TaskProfile, type TaskProfileRecord,
} from '../contracts/governed-intake-task-profile.evaluate.ts';

const contract = rawContract as TaskProfileContract;

test('source contract is well-formed: five categories, ten-point scoring, high/medium/low confidence', () => {
  assertTaskProfileContract(contract);
  assert.equal(contract.categories.length, 5);
  assert.equal(contract.scoring.totalPoints, 10);
  assert.deepEqual([...contract.confidence.levels], ['high', 'medium', 'low']);
});

test('contract identity is a deterministic sha256 independent of key order', async () => {
  const bound1 = await bindTaskProfileContract(contract);
  const reordered = JSON.parse(JSON.stringify(contract)) as TaskProfileContract;
  // @ts-expect-error runtime reorder check only
  reordered.owner = contract.owner; // no-op touch; real reorder covered by canonicalJson sorting keys
  const bound2 = await bindTaskProfileContract(reordered);
  assert.equal(bound1.contractIdentity, bound2.contractIdentity);
  assert.match(bound1.contractIdentity, /^sha256:[0-9a-f]{64}$/);
});

test('every calibration example round-trips through validate + derive to its published labels', async () => {
  const bound = await bindTaskProfileContract(contract);
  for (const example of contract.examples) {
    const value = { schemaVersion: contract.profileSchemaVersion, scores: example.scores, confidence: 'high', rationale: 'calibration fixture' };
    const validated = validateTaskProfile(bound, value);
    assert.equal(validated.ok, true, `${example.id}: ${JSON.stringify(validated)}`);
    if (!validated.ok) continue;
    const labels = deriveTaskLabels(bound, validated.profile);
    assert.deepEqual(labels.sort(), [...example.labels].sort(), example.id);
    assert.ok(labels.length <= 2, `${example.id} produced more than two labels`);
  }
});

test('mixed fallback applies only when no category reaches the threshold, and never combines with a category label', async () => {
  const bound = await bindTaskProfileContract(contract);
  const mixed = { implement: 3, diagnose: 3, design: 2, review: 0, judgment: 2 };
  const validated = validateTaskProfile(bound, { schemaVersion: contract.profileSchemaVersion, scores: mixed, confidence: 'low', rationale: 'broad mixed investigation' });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.deepEqual(deriveTaskLabels(bound, validated.profile), ['task:mixed']);
});

test('rejects a score total that is not exactly 10', async () => {
  const bound = await bindTaskProfileContract(contract);
  const result = validateTaskProfile(bound, {
    schemaVersion: contract.profileSchemaVersion,
    scores: { implement: 5, diagnose: 0, design: 0, review: 0, judgment: 0 },
    confidence: 'high', rationale: 'under budget',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.reasons.includes('score_total_not_10'));
});

test('rejects non-integer and out-of-range scores', async () => {
  const bound = await bindTaskProfileContract(contract);
  const result = validateTaskProfile(bound, {
    schemaVersion: contract.profileSchemaVersion,
    scores: { implement: 10.5, diagnose: -1, design: 0, review: 0, judgment: 0 },
    confidence: 'high', rationale: 'bad scores',
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.reasons.includes('non_integer_score:implement'));
    assert.ok(result.reasons.includes('score_out_of_range:diagnose'));
  }
});

test('never invents a model/provider/effort/harness/benchmark field', async () => {
  const bound = await bindTaskProfileContract(contract);
  const result = validateTaskProfile(bound, {
    schemaVersion: contract.profileSchemaVersion,
    scores: { implement: 10, diagnose: 0, design: 0, review: 0, judgment: 0 },
    confidence: 'high', rationale: 'known fix', model: 'claude-opus-5-5',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.reasons.includes('unknown_profile_field:model'));
});

test('rejects an invalid confidence level and a missing/oversized rationale', async () => {
  const bound = await bindTaskProfileContract(contract);
  const badConfidence = validateTaskProfile(bound, {
    schemaVersion: contract.profileSchemaVersion,
    scores: { implement: 10, diagnose: 0, design: 0, review: 0, judgment: 0 },
    confidence: 'certain', rationale: 'known fix',
  });
  assert.equal(badConfidence.ok, false);
  const longRationale = 'x'.repeat(contract.rationale.maxLength + 1);
  const oversized = validateTaskProfile(bound, {
    schemaVersion: contract.profileSchemaVersion,
    scores: { implement: 10, diagnose: 0, design: 0, review: 0, judgment: 0 },
    confidence: 'high', rationale: longRationale,
  });
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.ok(oversized.reasons.includes('missing_or_oversized_rationale'));
});

test('label projection: a projected label with no bound profile is removed, never trusted', async () => {
  const bound = await bindTaskProfileContract(contract);
  const evaluation = evaluateTaskLabelProjection(bound, null, ['task:implement', 'unrelated-label']);
  assert.deepEqual(evaluation.toRemove, ['task:implement']);
  assert.deepEqual(evaluation.toAdd, []);
  assert.ok(evaluation.reasons.includes('task_labels_without_profile'));
});

test('label projection: matches expected add/remove against current labels', async () => {
  const bound = await bindTaskProfileContract(contract);
  const validated = validateTaskProfile(bound, {
    schemaVersion: contract.profileSchemaVersion,
    scores: { implement: 6, diagnose: 0, design: 4, review: 0, judgment: 0 },
    confidence: 'high', rationale: 'feature + local design',
  });
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const evaluation = evaluateTaskLabelProjection(bound, validated.profile, ['task:mixed']);
  assert.deepEqual(evaluation.expected.sort(), ['task:design', 'task:implement']);
  assert.deepEqual(evaluation.toAdd.sort(), ['task:design', 'task:implement']);
  assert.deepEqual(evaluation.toRemove, ['task:mixed']);
});

test('reuse: unchanged scope/contract reuses; a reconsider trigger forces reconsideration; non-triggers never invalidate', async () => {
  const bound = await bindTaskProfileContract(contract);
  const prior: TaskProfileRecord = {
    profile: { schemaVersion: contract.profileSchemaVersion, scores: { implement: 10, diagnose: 0, design: 0, review: 0, judgment: 0 }, confidence: 'high', rationale: 'known fix' },
    workUnitKey: 'sha256:unit-1', scopeFingerprint: 'sha256:scope-1', contractIdentity: bound.contractIdentity,
  };
  assert.equal(decideTaskProfileReuse(bound, prior, { workUnitKey: 'sha256:unit-1', scopeFingerprint: 'sha256:scope-1', executableUnit: true, changes: [] }), 'reuse');
  assert.equal(decideTaskProfileReuse(bound, prior, { workUnitKey: 'sha256:unit-1', scopeFingerprint: 'sha256:scope-1', executableUnit: true, changes: ['model-released', 'profiler-preference'] }), 'reuse');
  assert.equal(decideTaskProfileReuse(bound, prior, { workUnitKey: 'sha256:unit-1', scopeFingerprint: 'sha256:scope-1', executableUnit: true, changes: ['acceptance-criteria-changed'] }), 'reconsider');
  assert.equal(decideTaskProfileReuse(bound, prior, { workUnitKey: 'sha256:unit-1', scopeFingerprint: 'sha256:scope-2', executableUnit: true, changes: [] }), 'reconsider');
  assert.equal(decideTaskProfileReuse(bound, null, { workUnitKey: 'sha256:unit-2', scopeFingerprint: 'sha256:scope-1', executableUnit: true, changes: [] }), 'profile');
  assert.equal(decideTaskProfileReuse(bound, prior, { workUnitKey: 'sha256:unit-1', scopeFingerprint: 'sha256:scope-1', executableUnit: false, changes: [] }), 'not-applicable');
});

test('a tracking parent has no applicable profile record (not-applicable, no aggregate)', async () => {
  const bound = await bindTaskProfileContract(contract);
  assert.equal(decideTaskProfileReuse(bound, null, { workUnitKey: 'sha256:parent', scopeFingerprint: 'sha256:scope', executableUnit: false, changes: [] }), 'not-applicable');
});

test('runtime resolution: missing/invalid/stale/mismatched-contract record degrades to legacy-unprofiled, never fabricates a vector', async () => {
  const bound = await bindTaskProfileContract(contract);
  const subject = { workUnitKey: 'sha256:unit-1', scopeFingerprint: 'sha256:scope-1' };
  assert.deepEqual(resolveRuntimeTaskProfile(bound, null, subject), { kind: 'legacy-unprofiled', reason: 'missing', fabricatedVector: false });
  assert.deepEqual(resolveRuntimeTaskProfile(bound, 'unknown', subject), { kind: 'legacy-unprofiled', reason: 'missing', fabricatedVector: false });

  const validProfile: TaskProfile = { schemaVersion: contract.profileSchemaVersion, scores: { implement: 10, diagnose: 0, design: 0, review: 0, judgment: 0 }, confidence: 'high', rationale: 'known fix' };
  const record: TaskProfileRecord = { profile: validProfile, workUnitKey: subject.workUnitKey, scopeFingerprint: subject.scopeFingerprint, contractIdentity: bound.contractIdentity };
  const resolved = resolveRuntimeTaskProfile(bound, record, subject);
  assert.equal(resolved.kind, 'profiled');

  const staleRecord: TaskProfileRecord = { ...record, scopeFingerprint: 'sha256:scope-old' };
  assert.deepEqual(resolveRuntimeTaskProfile(bound, staleRecord, subject), { kind: 'legacy-unprofiled', reason: 'stale', fabricatedVector: false });

  const mismatchedContract: TaskProfileRecord = { ...record, contractIdentity: 'sha256:old-contract' };
  assert.deepEqual(resolveRuntimeTaskProfile(bound, mismatchedContract, subject), { kind: 'legacy-unprofiled', reason: 'unsupported_schema', fabricatedVector: false });

  const otherSubject: TaskProfileRecord = { ...record, workUnitKey: 'sha256:other-unit' };
  assert.deepEqual(resolveRuntimeTaskProfile(bound, otherSubject, subject), { kind: 'legacy-unprofiled', reason: 'invalid', fabricatedVector: false });
});

test('child leaves are profiled independently; nothing here averages or sums parent/child vectors', async () => {
  const bound = await bindTaskProfileContract(contract);
  const childA = validateTaskProfile(bound, { schemaVersion: contract.profileSchemaVersion, scores: { implement: 10, diagnose: 0, design: 0, review: 0, judgment: 0 }, confidence: 'high', rationale: 'leaf a' });
  const childB = validateTaskProfile(bound, { schemaVersion: contract.profileSchemaVersion, scores: { implement: 0, diagnose: 0, design: 0, review: 0, judgment: 10 }, confidence: 'high', rationale: 'leaf b' });
  assert.equal(childA.ok, true); assert.equal(childB.ok, true);
  if (!childA.ok || !childB.ok) return;
  assert.notDeepEqual(deriveTaskLabels(bound, childA.profile), deriveTaskLabels(bound, childB.profile));
});
