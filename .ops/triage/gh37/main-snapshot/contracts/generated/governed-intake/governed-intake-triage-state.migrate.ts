/**
 * Pure, dependency-aware delta planning for governed-intake releases (code#6449).
 * Adapters must verify releases and prior completion before using this planner.
 * This returns obligations, not checked boxes, model invocations or GitHub mutations.
 */
export interface ChecklistItem {
  id: string;
  title: string;
  text: string;
  /** Additional machine semantics. Omit only if the item has no extra contract. */
  semantics?: unknown;
  /** Execution-order prerequisites, not automatic semantic invalidation edges. */
  dependsOn?: string[];
  /** Input identities that invalidate this judgment when they materially change. */
  evidenceKeys?: string[];
  /** Only material result dependencies invalidate a judgment when that result changes. */
  resultDependencies?: string[];
}
export interface ChecklistRelease {
  revision: number;
  items: ChecklistItem[];
}
export interface PriorChecklistEvidence {
  /** Set only after the existing evaluator verifies prior revision/fingerprint/receipt. */
  completionVerified: boolean;
  completedItemIds: string[];
  /** Independently validated item receipts permit safe resume of partial prior triage. */
  verifiedItemIds?: string[];
  staleItemIds: string[];
  /** Actual changes, not merely a newer timestamp, provider switch or cleaned label. */
  changedEvidenceKeys: string[];
  /** Results observed to differ after reevaluation; propagate only these outcomes. */
  changedResultItemIds: string[];
}
export type ReevaluationReason = 'new-item' | 'semantic-change' | 'evidence-stale' | 'dependency-invalidated';
export interface ChecklistDelta {
  fromRevision: number | null;
  toRevision: number;
  reusedItemIds: string[];
  reevaluatedItems: { id: string; reasons: ReevaluationReason[] }[];
  removedItemIds: string[];
  mechanicallyChangedItemIds: string[];
  executionOrder: string[];
  /** Re-plan after changed items return; a changed requirement need not change its result. */
  requiresResultReconciliation: boolean;
}

function stableJson(value: unknown, stack = new Set<object>()): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || value === null) throw new Error('non_json_checklist_semantics');
  if (stack.has(value)) throw new Error('cyclic_checklist_semantics');
  stack.add(value);
  let result: string;
  if (Array.isArray(value)) result = `[${value.map(child => stableJson(child, stack)).join(',')}]`;
  else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error('non_json_checklist_semantics');
    }
    const record = value as Record<string, unknown>;
    result = `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key], stack)}`).join(',')}}`;
  }
  stack.delete(value);
  return result;
}

/** A canonical comparison value, NOT a cryptographic release signature. */
export function checklistItemSignature(item: ChecklistItem): string {
  return stableJson({
    id: item.id, title: item.title, text: item.text, semantics: item.semantics ?? null,
  });
}
function dependencySignature(item: ChecklistItem): string {
  return stableJson({
    dependsOn: [...(item.dependsOn ?? [])].sort(), evidenceKeys: [...(item.evidenceKeys ?? [])].sort(),
    resultDependencies: [...(item.resultDependencies ?? [])].sort(),
  });
}
const isStrings = (value: unknown): value is string[] => Array.isArray(value)
  && value.every(item => typeof item === 'string' && item.trim().length > 0)
  && new Set(value).size === value.length;

/** Validate once and return a stable topological order, preserving source-order ties. */
export function validateChecklistRelease(release: ChecklistRelease): string[] {
  if (!release || !Number.isInteger(release.revision) || release.revision < 1
    || !Array.isArray(release.items) || release.items.length === 0) throw new Error('invalid_checklist_release');
  const items = new Map<string, ChecklistItem>();
  for (const item of release.items) {
    if (!item || typeof item.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)
      || typeof item.title !== 'string' || !item.title.trim() || typeof item.text !== 'string' || !item.text.trim()
      || !isStrings(item.dependsOn ?? []) || !isStrings(item.evidenceKeys ?? [])
      || !isStrings(item.resultDependencies ?? []) || items.has(item.id)) {
      throw new Error('invalid_or_duplicate_checklist_item');
    }
    checklistItemSignature(item);
    items.set(item.id, item);
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const order: string[] = [];
  const visit = (id: string): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error('checklist_dependency_cycle');
    const item = items.get(id);
    if (!item) throw new Error(`unknown_checklist_dependency:${id}`);
    visiting.add(id);
    for (const dependency of new Set([...(item.dependsOn ?? []), ...(item.resultDependencies ?? [])])) visit(dependency);
    visiting.delete(id);
    done.add(id);
    order.push(id);
  };
  for (const id of items.keys()) visit(id);
  return order;
}

export function planChecklistDelta(
  previous: ChecklistRelease | null,
  current: ChecklistRelease,
  prior: PriorChecklistEvidence,
): ChecklistDelta {
  const executionOrder = validateChecklistRelease(current);
  if (previous) validateChecklistRelease(previous);
  if (previous && previous.revision > current.revision) throw new Error('checklist_revision_rollback');
  if (!prior || typeof prior.completionVerified !== 'boolean'
    || ![prior.completedItemIds, prior.verifiedItemIds ?? [], prior.staleItemIds, prior.changedEvidenceKeys, prior.changedResultItemIds].every(isStrings)) {
    throw new Error('invalid_prior_checklist_evidence');
  }
  const previousItems = new Map((previous?.items ?? []).map(item => [item.id, item]));
  const currentItems = new Map(current.items.map(item => [item.id, item]));
  const knownIds = new Set([...previousItems.keys(), ...currentItems.keys()]);
  for (const id of [...prior.completedItemIds, ...(prior.verifiedItemIds ?? []), ...prior.staleItemIds, ...prior.changedResultItemIds]) {
    if (!knownIds.has(id)) throw new Error(`unknown_evidence_item:${id}`);
  }
  if (!previous && prior.completionVerified) throw new Error('verified_evidence_without_previous_release');
  const changedSemanticIds = current.items.filter(item => {
    const old = previousItems.get(item.id);
    return !old || checklistItemSignature(old) !== checklistItemSignature(item);
  }).map(item => item.id);
  const removedItemIds = (previous?.items ?? []).filter(item => !currentItems.has(item.id)).map(item => item.id);
  const mechanicallyChangedItemIds = current.items.filter(item => {
    const old = previousItems.get(item.id);
    return old && dependencySignature(old) !== dependencySignature(item);
  }).map(item => item.id);
  if (previous && previous.revision === current.revision
    && (changedSemanticIds.length || removedItemIds.length || mechanicallyChangedItemIds.length)) {
    throw new Error('checklist_semantics_changed_without_revision');
  }
  const completed = new Set(prior.completedItemIds);
  const verifiedItems = new Set(prior.verifiedItemIds ?? []);
  const stale = new Set(prior.staleItemIds);
  const changedKeys = new Set(prior.changedEvidenceKeys);
  const changedResults = new Set(prior.changedResultItemIds);
  const invalidated = new Set<string>();
  // Propagate OBSERVED result changes one step, then re-plan after evaluating that step.
  // Invalidating an input does not prove the resulting judgment will change. Ordering
  // prerequisites alone also do not create semantic invalidation edges.
  for (const id of executionOrder) {
    const item = currentItems.get(id)!;
    if ((item.evidenceKeys ?? []).some(key => changedKeys.has(key))
      || (item.resultDependencies ?? []).some(dependency => changedResults.has(dependency))) {
      invalidated.add(id);
    }
  }
  const reusedItemIds: string[] = [];
  const reevaluatedItems: ChecklistDelta['reevaluatedItems'] = [];
  for (const id of executionOrder) {
    const item = currentItems.get(id)!;
    const old = previousItems.get(id);
    const reasons: ReevaluationReason[] = [];
    if (!old) reasons.push('new-item');
    else if (checklistItemSignature(old) !== checklistItemSignature(item)) reasons.push('semantic-change');
    if (old && (!(prior.completionVerified || verifiedItems.has(id)) || !completed.has(id) || stale.has(id))) reasons.push('evidence-stale');
    if (invalidated.has(id)) reasons.push('dependency-invalidated');
    if (reasons.length) reevaluatedItems.push({ id, reasons });
    else reusedItemIds.push(id);
  }
  return {
    fromRevision: previous?.revision ?? null,
    toRevision: current.revision,
    reusedItemIds,
    reevaluatedItems,
    removedItemIds,
    mechanicallyChangedItemIds,
    executionOrder,
    requiresResultReconciliation: reevaluatedItems.length > 0,
  };
}
