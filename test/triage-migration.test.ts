import test from 'node:test';
import assert from 'node:assert/strict';
import { planChecklistDelta, validateChecklistRelease, checklistItemSignature,
  type ChecklistRelease, type PriorChecklistEvidence } from '../contracts/governed-intake-triage-state.migrate.ts';

const ids = ['value-direction', 'fix-owner', 'effort', 'tier', 'verify', 'cloud-runnable', 'taxonomy'];
function priorRelease(): ChecklistRelease {
  return { revision: 16, items: ids.map(id => ({ id, title: id, text: `Original ${id} obligation`,
    evidenceKeys: id === 'value-direction' ? ['direction'] : ['scope'],
    ...(id === 'effort' ? { evidenceKeys: ['scope', 'rubric-meaning'] } : {}),
  })) };
}
function evidence(): PriorChecklistEvidence {
  return { completionVerified: true, completedItemIds: [...ids], staleItemIds: [], changedEvidenceKeys: [], changedResultItemIds: [] };
}
function revisions(): [ChecklistRelease, ChecklistRelease] {
  const before = priorRelease(); const after = structuredClone(before); after.revision = 17;
  after.items.find(item => item.id === 'cloud-runnable')!.text = 'Exactly one cloud-ready/local-required label, evidence required.';
  return [before, after];
}
const pending = (delta: ReturnType<typeof planChecklistDelta>) => delta.reevaluatedItems.map(item => item.id);

test('v16 -> v17 reevaluates the changed stable-ID cloud item only', () => {
  const [before, after] = revisions(); const delta = planChecklistDelta(before, after, evidence());
  assert.deepEqual(pending(delta), ['cloud-runnable']);
  assert.deepEqual(delta.reusedItemIds, ids.filter(id => id !== 'cloud-runnable'));
  assert.deepEqual(delta.reevaluatedItems[0].reasons, ['semantic-change']);
});
test('expired direction + changed cloud semantics is exactly the two-item delta', () => {
  const [before, after] = revisions(); const e = evidence(); e.staleItemIds = ['value-direction'];
  assert.deepEqual(pending(planChecklistDelta(before, after, e)), ['value-direction', 'cloud-runnable']);
});
for (const field of ['title', 'text', 'semantics'] as const) {
  test(`stable ID with changed ${field} is not silently reused`, () => {
    const before = priorRelease(); const after = structuredClone(before); after.revision++;
    if (field === 'semantics') after.items[2].semantics = { required: 'new-evidence' };
    else after.items[2][field] = 'Changed requirement';
    assert.deepEqual(pending(planChecklistDelta(before, after, evidence())), ['effort']);
  });
}
test('new early scope item does not force downstream judgment before its result is known', () => {
  const before = priorRelease(); const after = structuredClone(before); after.revision++;
  after.items.splice(1, 0, { id: 'scope-decomposition', title: 'Scope', text: 'Resolve shape', dependsOn: ['value-direction'] });
  for (const item of after.items) {
    if (!['scope-decomposition', 'value-direction'].includes(item.id)) {
      item.dependsOn = ['scope-decomposition']; item.resultDependencies = ['scope-decomposition'];
    }
  }
  const delta = planChecklistDelta(before, after, evidence());
  assert.deepEqual(pending(delta), ['scope-decomposition']);
  assert.equal(delta.mechanicallyChangedItemIds.length, 6);
  assert.ok(delta.executionOrder.indexOf('scope-decomposition') < delta.executionOrder.indexOf('effort'));
  assert.equal(delta.requiresResultReconciliation, true);
});
test('actual scope split reopens exactly scope-dependent judgments', () => {
  const before = priorRelease(); const after = structuredClone(before); after.revision++;
  after.items.splice(1, 0, { id: 'scope-decomposition', title: 'Scope', text: 'Resolve shape' });
  for (const item of after.items) if (item.id !== 'value-direction' && item.id !== 'scope-decomposition') {
    item.resultDependencies = ['scope-decomposition'];
  }
  const e = evidence(); e.changedResultItemIds = ['scope-decomposition'];
  const delta = planChecklistDelta(before, after, e);
  assert.deepEqual(delta.reusedItemIds, ['value-direction']);
  for (const item of delta.reevaluatedItems.filter(item => item.id !== 'scope-decomposition')) {
    assert.ok(item.reasons.includes('dependency-invalidated'));
  }
});
test('changed rubric meaning reevaluates effort, not speculative downstream outputs', () => {
  const before = priorRelease(); before.items.find(i => i.id === 'tier')!.resultDependencies = ['effort'];
  const e = evidence(); e.changedEvidenceKeys = ['rubric-meaning'];
  const delta = planChecklistDelta(before, structuredClone(before), e);
  assert.deepEqual(pending(delta), ['effort']);
  assert.ok(delta.reusedItemIds.includes('tier'));
});
test('observed effort result change invalidates its direct semantic dependent', () => {
  const before = priorRelease(); before.items.find(i => i.id === 'tier')!.resultDependencies = ['effort'];
  const e = evidence(); e.changedResultItemIds = ['effort'];
  assert.deepEqual(pending(planChecklistDelta(before, structuredClone(before), e)), ['tier']);
});
test('execution ordering alone is not a semantic invalidation edge', () => {
  const before = priorRelease(); before.items.find(i => i.id === 'tier')!.dependsOn = ['effort'];
  const e = evidence(); e.changedResultItemIds = ['effort'];
  assert.deepEqual(pending(planChecklistDelta(before, structuredClone(before), e)), []);
});
test('unrelated provider, wall-clock, child progress and cosmetic-label keys do not invalidate judgments', () => {
  const before = priorRelease(); const e = evidence();
  e.changedEvidenceKeys = ['provider', 'elapsed-time', 'child-progress', 'decomp-in-progress-cleanup'];
  assert.deepEqual(pending(planChecklistDelta(before, structuredClone(before), e)), []);
});
test('changed scope key invalidates the declared material consumers, not direction', () => {
  const before = priorRelease(); const e = evidence(); e.changedEvidenceKeys = ['scope'];
  const delta = planChecklistDelta(before, structuredClone(before), e);
  assert.deepEqual(delta.reusedItemIds, ['value-direction']);
});
test('removed item is conserved in migration receipt, not rerun', () => {
  const before = priorRelease(); const after = structuredClone(before); after.revision++; after.items = after.items.filter(i => i.id !== 'taxonomy');
  const delta = planChecklistDelta(before, after, evidence());
  assert.deepEqual(delta.removedItemIds, ['taxonomy']); assert.deepEqual(pending(delta), []);
});
test('repeat unchanged fully completed run is a semantic no-op', () => {
  const before = priorRelease(); const delta = planChecklistDelta(before, structuredClone(before), evidence());
  assert.deepEqual(pending(delta), []); assert.equal(delta.requiresResultReconciliation, false);
});
test('verified subset permits safe resume of partial triage', () => {
  const before = priorRelease(); const e = evidence(); e.completionVerified = false;
  e.verifiedItemIds = ids.filter(id => id !== 'verify');
  assert.deepEqual(pending(planChecklistDelta(before, structuredClone(before), e)), ['verify']);
});
test('unchecked prior item with no completed evidence remains pending', () => {
  const before = priorRelease(); const e = evidence(); e.completedItemIds = e.completedItemIds.filter(id => id !== 'tier');
  assert.deepEqual(pending(planChecklistDelta(before, structuredClone(before), e)), ['tier']);
});
test('an unverified old stamp cannot carry all items forward', () => {
  const before = priorRelease(); const e = evidence(); e.completionVerified = false;
  assert.deepEqual(pending(planChecklistDelta(before, structuredClone(before), e)), ids);
});
test('new issue has all items new and no invented previous revision', () => {
  const current = priorRelease(); const e = evidence(); e.completionVerified = false; e.completedItemIds = [];
  const delta = planChecklistDelta(null, current, e);
  assert.equal(delta.fromRevision, null); assert.deepEqual(pending(delta), ids);
  for (const item of delta.reevaluatedItems) assert.deepEqual(item.reasons, ['new-item']);
});
test('planner is pure and does not edit releases or prior evidence', () => {
  const [before, after] = revisions(); const e = evidence(); const all = structuredClone({ before, after, e });
  planChecklistDelta(before, after, e); assert.deepEqual({ before, after, e }, all);
});
test('machine semantic key order is irrelevant', () => {
  const a = { id: 'test', title: 'Test', text: 'Test', semantics: { a: 1, b: { c: 2, d: 3 } } };
  const b = { ...a, semantics: { b: { d: 3, c: 2 }, a: 1 } };
  assert.equal(checklistItemSignature(a), checklistItemSignature(b));
});
test('semantic array order remains significant', () => {
  const a = { id: 'test', title: 'Test', text: 'Test', semantics: ['first', 'second'] };
  assert.notEqual(checklistItemSignature(a), checklistItemSignature({ ...a, semantics: ['second', 'first'] }));
});
test('topological order resolves prerequisites declared later without reordering unrelated ties', () => {
  const r: ChecklistRelease = { revision: 1, items: [
    { id: 'leaf', title: 'leaf', text: 'leaf', dependsOn: ['scope'] },
    { id: 'scope', title: 'scope', text: 'scope' },
  ] };
  assert.deepEqual(validateChecklistRelease(r), ['scope', 'leaf']);
});
for (const kind of ['dependsOn', 'resultDependencies'] as const) {
  test(`${kind} cycles fail closed`, () => {
    const r = priorRelease(); r.items[0][kind] = [r.items[1].id]; r.items[1][kind] = [r.items[0].id];
    assert.throws(() => validateChecklistRelease(r), /cycle/);
  });
  test(`${kind} unknown target fails closed`, () => {
    const r = priorRelease(); r.items[0][kind] = ['does-not-exist'];
    assert.throws(() => validateChecklistRelease(r), /unknown_checklist_dependency/);
  });
}
test('duplicate stable IDs fail closed', () => {
  const r = priorRelease(); r.items.push(structuredClone(r.items[0]));
  assert.throws(() => validateChecklistRelease(r), /duplicate/);
});
test('changing semantic bytes without version change fails closed', () => {
  const before = priorRelease(); const after = structuredClone(before); after.items[0].text = 'different';
  assert.throws(() => planChecklistDelta(before, after, evidence()), /without_revision/);
});
test('changing dependency metadata without version change also fails closed', () => {
  const before = priorRelease(); const after = structuredClone(before); after.items[1].dependsOn = ['value-direction'];
  assert.throws(() => planChecklistDelta(before, after, evidence()), /without_revision/);
});
test('rollback to an older release is not automatic migration', () => {
  const [before, after] = revisions(); assert.throws(() => planChecklistDelta(after, before, evidence()), /rollback/);
});
test('missing prior release cannot have verified completion', () => {
  const e = evidence(); e.completedItemIds = [];
  assert.throws(() => planChecklistDelta(null, priorRelease(), e), /without_previous_release/);
});
test('unknown evidence item is not silently discarded', () => {
  const r = priorRelease(); const e = evidence(); e.staleItemIds = ['mistyped-id'];
  assert.throws(() => planChecklistDelta(r, r, e), /unknown_evidence_item/);
});
for (const invalid of [undefined, NaN, Infinity, new Date(0), () => true]) {
  test(`invalid semantic value ${String(invalid)} is rejected`, () => {
    if (invalid === undefined) return assert.throws(() => checklistItemSignature({ id:'a',title:'a',text:'a',semantics:{ invalid } }), /non_json/);
    assert.throws(() => checklistItemSignature({ id:'a',title:'a',text:'a',semantics:invalid }), /non_json/);
  });
}
test('cyclic semantic input is rejected, not hung', () => {
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  assert.throws(() => checklistItemSignature({ id: 'a', title: 'a', text: 'a', semantics: cyclic }), /cyclic/);
});
