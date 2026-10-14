/**
 * Compatible governed-intake revisions (.github#52).
 * A release names the oldest revision whose completions it still accepts and classifies
 * each checklist item that changed. Pure: no filesystem, network, clock, or effects.
 */
export const ITEM_CHANGE_CLASSIFICATIONS = ["wording-only", "relaxed", "tightened", "new"] as const;
export type ItemChangeClassification = (typeof ITEM_CHANGE_CLASSIFICATIONS)[number];

export interface ItemAppliesTo {
  dispositions?: string[];
  workTypes?: string[];
  labels?: string[];
}

export interface RevisionItemChange {
  id: string;
  classification: ItemChangeClassification;
  predecessor?: { title: string; text: string };
  appliesTo?: ItemAppliesTo;
}

export interface AcceptedRevisionIdentity {
  revision: number;
  policyIdentity: string;
  rubricIdentity: string;
}

export interface RevisionCompatibility {
  oldestAcceptedRevision: number;
  acceptedIdentities: AcceptedRevisionIdentity[];
  itemChanges: RevisionItemChange[];
}

export interface ChecklistItemSnapshot {
  id: string;
  title: string;
  text: string;
  dependsOn?: string[];
  evidenceKeys?: string[];
  resultDependencies?: string[];
  semantics?: unknown;
}

export interface RevisionSnapshot {
  revision: number;
  policyIdentity: string;
  rubricIdentity: string;
  items: ChecklistItemSnapshot[];
}

export interface RevisionCompatibilityContract {
  version: number;
  revisionCompatibility?: unknown;
  triageChecklist?: { items?: ChecklistItemSnapshot[] };
}

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const ITEM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) return null;
  if (new Set(value).size !== value.length) return null;
  return value;
}

export function emptyRevisionCompatibility(version: number): RevisionCompatibility {
  return { oldestAcceptedRevision: version, acceptedIdentities: [], itemChanges: [] };
}

/** Absent means the live revision only: every older completion stays stale. */
export function parseRevisionCompatibility(
  contract: RevisionCompatibilityContract,
): { ok: true; compatibility: RevisionCompatibility } | { ok: false; messages: string[] } {
  const version = contract.version;
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, messages: [`invalid governed intake revision: ${String(version)}`] };
  }
  if (contract.revisionCompatibility === undefined) {
    return { ok: true, compatibility: emptyRevisionCompatibility(version) };
  }
  const raw = contract.revisionCompatibility;
  const messages: string[] = [];
  if (!isObject(raw)) return { ok: false, messages: ["revisionCompatibility must be an object"] };
  const oldest = raw.oldestAcceptedRevision;
  if (!Number.isInteger(oldest) || Number(oldest) < 1 || Number(oldest) > version) {
    messages.push(`oldestAcceptedRevision must be an integer from 1 through ${version}`);
  }
  const identities: AcceptedRevisionIdentity[] = [];
  if (!Array.isArray(raw.acceptedIdentities)) messages.push("acceptedIdentities must be an array");
  else {
    for (const entry of raw.acceptedIdentities) {
      if (!isObject(entry) || !Number.isInteger(entry.revision)
        || typeof entry.policyIdentity !== "string" || !SHA256.test(entry.policyIdentity)
        || typeof entry.rubricIdentity !== "string" || !SHA256.test(entry.rubricIdentity)) {
        messages.push("acceptedIdentities entries require a revision and sha256 policy and rubric identities");
        continue;
      }
      identities.push({
        revision: Number(entry.revision),
        policyIdentity: entry.policyIdentity,
        rubricIdentity: entry.rubricIdentity,
      });
    }
  }
  const itemChanges: RevisionItemChange[] = [];
  if (!Array.isArray(raw.itemChanges)) messages.push("itemChanges must be an array");
  else {
    for (const entry of raw.itemChanges) {
      const parsed = parseItemChange(entry);
      if (typeof parsed === "string") messages.push(parsed);
      else itemChanges.push(parsed);
    }
  }
  if (messages.length || !Number.isInteger(oldest)) return { ok: false, messages };
  const compatibility: RevisionCompatibility = {
    oldestAcceptedRevision: Number(oldest),
    acceptedIdentities: identities,
    itemChanges,
  };
  messages.push(...declarationShapeMessages(version, compatibility));
  return messages.length ? { ok: false, messages } : { ok: true, compatibility };
}

function parseItemChange(entry: unknown): RevisionItemChange | string {
  if (!isObject(entry) || typeof entry.id !== "string" || !ITEM_ID.test(entry.id)) {
    return "itemChanges entries require a kebab-case id";
  }
  if (typeof entry.classification !== "string" || !ITEM_CHANGE_CLASSIFICATIONS.includes(entry.classification as ItemChangeClassification)) {
    return `item ${entry.id} classification must be wording-only, relaxed, tightened, or new`;
  }
  const change: RevisionItemChange = { id: entry.id, classification: entry.classification as ItemChangeClassification };
  if (entry.predecessor !== undefined) {
    if (!isObject(entry.predecessor) || typeof entry.predecessor.title !== "string" || !entry.predecessor.title.trim()
      || typeof entry.predecessor.text !== "string" || !entry.predecessor.text.trim()) {
      return `item ${entry.id} predecessor requires title and text`;
    }
    change.predecessor = { title: entry.predecessor.title, text: entry.predecessor.text };
  }
  if (entry.appliesTo !== undefined) {
    if (!isObject(entry.appliesTo)) return `item ${entry.id} appliesTo must be an object`;
    const appliesTo: ItemAppliesTo = {};
    for (const key of ["dispositions", "workTypes", "labels"] as const) {
      if (entry.appliesTo[key] === undefined) continue;
      const values = stringArray(entry.appliesTo[key]);
      if (!values) return `item ${entry.id} appliesTo.${key} must be unique non-empty strings`;
      appliesTo[key] = values;
    }
    change.appliesTo = appliesTo;
  }
  return change;
}

function hasAppliesTo(change: RevisionItemChange): boolean {
  const spec = change.appliesTo;
  return Boolean(spec && [spec.dispositions, spec.workTypes, spec.labels].some((values) => values && values.length > 0));
}

function declarationShapeMessages(version: number, compatibility: RevisionCompatibility): string[] {
  const messages: string[] = [];
  const ids = compatibility.itemChanges.map((change) => change.id);
  if (new Set(ids).size !== ids.length) messages.push("itemChanges ids must be unique");
  const identityRevisions = compatibility.acceptedIdentities.map((entry) => entry.revision);
  if (new Set(identityRevisions).size !== identityRevisions.length) messages.push("acceptedIdentities revisions must be unique");
  if (compatibility.oldestAcceptedRevision === version) {
    if (compatibility.itemChanges.length || compatibility.acceptedIdentities.length) {
      messages.push("compatibility declaration contradicts item changes: the live revision accepts no predecessor, so itemChanges and acceptedIdentities must be empty");
    }
    return messages;
  }
  for (let revision = compatibility.oldestAcceptedRevision; revision < version; revision += 1) {
    if (!compatibility.acceptedIdentities.some((entry) => entry.revision === revision)) {
      messages.push(`acceptedIdentities omits revision ${revision}`);
    }
  }
  for (const entry of compatibility.acceptedIdentities) {
    if (entry.revision < compatibility.oldestAcceptedRevision || entry.revision >= version) {
      messages.push(`acceptedIdentities names revision ${entry.revision}, outside ${compatibility.oldestAcceptedRevision}..${version - 1}`);
    }
  }
  for (const change of compatibility.itemChanges) {
    if ((change.classification === "tightened" || change.classification === "new") && !hasAppliesTo(change)) {
      messages.push(`compatibility declaration contradicts item changes: ${change.classification} item ${change.id} does not say which issues it applies to`);
    }
    if ((change.classification === "wording-only" || change.classification === "relaxed") && change.appliesTo) {
      messages.push(`compatibility declaration contradicts item changes: ${change.classification} item ${change.id} must not re-pend issues`);
    }
    if (change.classification === "new" && change.predecessor) {
      messages.push(`compatibility declaration contradicts item changes: new item ${change.id} must not carry predecessor text`);
    }
    if (change.classification !== "new" && !change.predecessor) {
      messages.push(`compatibility declaration contradicts item changes: ${change.classification} item ${change.id} requires predecessor title and text`);
    }
  }
  return messages;
}

export function isRevisionInAcceptedRange(revision: number, current: number, compatibility: RevisionCompatibility): boolean {
  return Number.isInteger(revision) && revision >= compatibility.oldestAcceptedRevision && revision <= current;
}

export function formatCompatibleRevisionWarning(
  evaluatedRevision: number,
  liveRevision: number,
  issue?: { repository: string; issueNumber: number } | null,
): string {
  const named = issue && /^[^/\s]+\/[^/\s]+$/.test(issue.repository)
    && Number.isSafeInteger(issue.issueNumber) && issue.issueNumber >= 1
    ? `${issue.repository}#${issue.issueNumber}`
    : "unspecified";
  return `compatible revision mismatch: evaluated revision ${evaluatedRevision}, live revision ${liveRevision}, issue ${named}`;
}

export function issueDisposition(labels: readonly string[]): "ordinary" | "atomic-high" | "parent" | null {
  if (labels.includes("decomp:complete")) return "parent";
  if (labels.includes("decomp:unnecessary")) return labels.includes("effort:high") ? "atomic-high" : "ordinary";
  return null;
}

export function issueWorkType(body: string): string | null {
  const match = /^## Work type\s*\n+([^\n#]+)/m.exec(body.replaceAll("\r\n", "\n"));
  const value = match?.[1]?.trim().toLowerCase();
  return value || null;
}

function appliesToIssue(change: RevisionItemChange, issue: { labels: readonly string[]; body: string }): boolean {
  const spec = change.appliesTo;
  if (!spec) return false;
  const parts: boolean[] = [];
  if (spec.dispositions && spec.dispositions.length > 0) {
    parts.push(spec.dispositions.includes(issueDisposition(issue.labels) ?? ""));
  }
  if (spec.workTypes && spec.workTypes.length > 0) {
    const workType = issueWorkType(issue.body) ?? "";
    parts.push(spec.workTypes.some((value) => value.toLowerCase() === workType));
  }
  if (spec.labels && spec.labels.length > 0) parts.push(spec.labels.some((label) => issue.labels.includes(label)));
  return parts.length > 0 && parts.every(Boolean);
}

/** Tightened and new items re-pend only the issues their selectors match. */
export function applicableTightenedOrNewItemIds(
  compatibility: RevisionCompatibility,
  issue: { labels: readonly string[]; body: string },
): string[] {
  return compatibility.itemChanges
    .filter((change) => (change.classification === "tightened" || change.classification === "new") && appliesToIssue(change, issue))
    .map((change) => change.id);
}

/** Checklist text of an accepted revision. Item changes are the step from the immediate predecessor. */
export function itemsAtRevision(
  currentItems: readonly ChecklistItemSnapshot[],
  revision: number,
  current: number,
  compatibility: RevisionCompatibility,
): ChecklistItemSnapshot[] {
  if (revision === current) return currentItems.map((item) => ({ ...item }));
  const changes = new Map(compatibility.itemChanges.map((change) => [change.id, change]));
  const items: ChecklistItemSnapshot[] = [];
  for (const item of currentItems) {
    const change = changes.get(item.id);
    if (change?.classification === "new") continue;
    if (change?.predecessor) items.push({ ...item, title: change.predecessor.title, text: change.predecessor.text });
    else items.push({ ...item });
  }
  return items;
}

function sorted(values: readonly string[] | undefined): string[] {
  return [...(values ?? [])].sort();
}

function stable(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function dependenciesEqual(left: ChecklistItemSnapshot, right: ChecklistItemSnapshot): boolean {
  return JSON.stringify(sorted(left.dependsOn)) === JSON.stringify(sorted(right.dependsOn))
    && JSON.stringify(sorted(left.evidenceKeys)) === JSON.stringify(sorted(right.evidenceKeys))
    && JSON.stringify(sorted(left.resultDependencies)) === JSON.stringify(sorted(right.resultDependencies))
    && stable(left.semantics ?? null) === stable(right.semantics ?? null);
}

/**
 * Refuse a compatibility declaration that does not match the predecessor snapshot's item changes.
 * A release with no predecessor (oldest === live) is not a compatibility declaration.
 */
export function checkRevisionCompatibility(
  contract: RevisionCompatibilityContract & { triageChecklist: { items: ChecklistItemSnapshot[] } },
  snapshots: readonly RevisionSnapshot[],
): { ok: true } | { ok: false; messages: string[] } {
  const parsed = parseRevisionCompatibility(contract);
  if (!parsed.ok) return parsed;
  const compatibility = parsed.compatibility;
  const version = contract.version;
  if (compatibility.oldestAcceptedRevision === version) return { ok: true };
  const messages: string[] = [];
  const byRevision = new Map<number, RevisionSnapshot>();
  for (const snapshot of snapshots) {
    if (!snapshot || !Number.isInteger(snapshot.revision)) {
      messages.push("predecessor snapshot is missing a revision");
      continue;
    }
    if (byRevision.has(snapshot.revision)) messages.push(`duplicate predecessor snapshot for revision ${snapshot.revision}`);
    byRevision.set(snapshot.revision, snapshot);
  }
  for (let revision = compatibility.oldestAcceptedRevision; revision < version; revision += 1) {
    const snapshot = byRevision.get(revision);
    const declared = compatibility.acceptedIdentities.find((entry) => entry.revision === revision);
    if (!snapshot) {
      messages.push(`missing predecessor snapshot for revision ${revision}`);
      continue;
    }
    if (!SHA256.test(snapshot.policyIdentity) || !SHA256.test(snapshot.rubricIdentity) || !Array.isArray(snapshot.items)) {
      messages.push(`predecessor snapshot for revision ${revision} is malformed`);
      continue;
    }
    if (!declared || declared.policyIdentity !== snapshot.policyIdentity || declared.rubricIdentity !== snapshot.rubricIdentity) {
      messages.push(`acceptedIdentities for revision ${revision} contradict the predecessor snapshot`);
    }
  }
  if (version - compatibility.oldestAcceptedRevision > 1 && compatibility.itemChanges.length > 0) {
    messages.push("compatibility declaration contradicts item changes: item text changes across more than one predecessor revision need a single immediate predecessor step");
  }
  const previous = byRevision.get(version - 1);
  if (previous && Array.isArray(previous.items)) {
    messages.push(...itemChangeMessages(contract.triageChecklist.items, previous.items, compatibility.itemChanges));
  }
  return messages.length ? { ok: false, messages } : { ok: true };
}

function itemChangeMessages(
  currentItems: readonly ChecklistItemSnapshot[],
  previousItems: readonly ChecklistItemSnapshot[],
  itemChanges: readonly RevisionItemChange[],
): string[] {
  const messages: string[] = [];
  const current = new Map(currentItems.map((item) => [item.id, item]));
  const previous = new Map(previousItems.map((item) => [item.id, item]));
  const declared = new Map(itemChanges.map((change) => [change.id, change]));
  if (current.size !== currentItems.length || previous.size !== previousItems.length) {
    messages.push("checklist item ids must be unique");
  }
  for (const [id, item] of current) {
    const old = previous.get(id);
    const change = declared.get(id);
    if (!old) {
      if (!change || change.classification !== "new") {
        messages.push(`compatibility declaration contradicts item changes: item ${id} is absent from the predecessor and is not classified new`);
      }
      continue;
    }
    const textChanged = old.title !== item.title || old.text !== item.text;
    const depsChanged = !dependenciesEqual(old, item);
    if (!textChanged && !depsChanged) {
      if (change) messages.push(`compatibility declaration contradicts item changes: item ${id} is unchanged but classified ${change.classification}`);
      continue;
    }
    if (!textChanged && depsChanged) {
      messages.push(`compatibility declaration contradicts item changes: item ${id} dependencies changed without a wording, relaxation, or tightening classification`);
      continue;
    }
    if (!change || !["wording-only", "relaxed", "tightened"].includes(change.classification)) {
      messages.push(`compatibility declaration contradicts item changes: item ${id} text changed and is not classified wording-only, relaxed, or tightened`);
      continue;
    }
    if (!change.predecessor || change.predecessor.title !== old.title || change.predecessor.text !== old.text) {
      messages.push(`compatibility declaration contradicts item changes: item ${id} predecessor text does not match revision snapshot`);
    }
  }
  for (const id of previous.keys()) {
    if (!current.has(id)) {
      messages.push(`compatibility declaration contradicts item changes: item ${id} was removed from the predecessor checklist`);
    }
  }
  for (const change of itemChanges) {
    if (!current.has(change.id)) {
      messages.push(`compatibility declaration contradicts item changes: item ${change.id} is classified but is not in the current checklist`);
    }
  }
  return messages;
}
