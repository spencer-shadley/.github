// code#7594: completed-state triage checklist (TriageChecklistCompletedStateV1).
// Spencer, chat, Oct 30 2026: "The checklist stays in the body until it's complete and then the
// checklist is replaced with a link to the checklist saying it's done as of triage version x at timestamp y"
import test from "node:test";
import assert from "node:assert/strict";
import {
  collapseTriageChecklist,
  computeTriageStateFingerprint,
  computeTriageStateFingerprintV2,
  evaluateTriageChecklistStructure,
  expandTriageChecklist,
  parseTriageChecklist,
  parseTriageObligations,
  renderTriageChecklistBlock,
  renderTriageCompletionMarker,
  triageChecklistUrl,
  CURRENT_TRIAGED_LABEL,
  CURRENT_TRIAGE_REVISION,
  GOVERNED_TRIAGE_CHECKLIST,
} from "../contracts/governed-intake-triage-state.evaluate.ts";
import { normalizeIssueScopeBody } from "../contracts/governed-intake-policy-binding.ts";

const ids = GOVERNED_TRIAGE_CHECKLIST.items.map((item) => item.id);
const labels = [CURRENT_TRIAGED_LABEL, "effort:medium"];
const completedAt = "2026-11-03T22:30:00.123Z";
const head = "## Work type\nTask\n\n## What happened or what is needed?\nSomething.\n\n";
const tail = "\n\n## Human-decision state\nNone - agent-executable leaf.\n";

function openBody(checked: boolean): string {
  return head + renderTriageChecklistBlock({ checked }) + tail;
}

test("collapse replaces a fully checked current checklist with the link line", () => {
  const result = collapseTriageChecklist(openBody(true), { completedAt, sourceCommit: "abc1234" });
  assert.equal(result.collapsed, true);
  assert.ok(result.body.startsWith(head));
  assert.ok(result.body.endsWith(tail));
  assert.ok(!result.body.includes("- [x]"));
  assert.match(
    result.body,
    new RegExp(`Triage checklist done as of triage version ${CURRENT_TRIAGE_REVISION} at 2026-11-03T22:30:00Z: \\[canonical checklist\\]\\(https://github\\.com/spencer-shadley/\\.github/blob/abc1234/contracts/governed-intake-body\\.v1\\.json\\)`),
  );
  assert.match(result.body, new RegExp(`<!-- governed-triage-checklist: revision=${CURRENT_TRIAGE_REVISION} state=complete -->`));
  const parsed = parseTriageChecklist(result.body);
  assert.equal(parsed?.state, "complete");
  assert.equal(parsed?.completedAt, "2026-11-03T22:30:00Z");
  assert.deepEqual(Object.keys(parsed?.obligations ?? {}), ids);
  assert.ok(Object.values(parsed?.obligations ?? {}).every((state) => state === "checked"));
});

test("an incomplete checklist stays in the body", () => {
  const body = openBody(false);
  const result = collapseTriageChecklist(body, { completedAt });
  assert.equal(result.collapsed, false);
  assert.equal(result.reason, "not_collapsible");
  assert.equal(result.body, body);
});

test("v2 fingerprint is identical for the expanded and collapsed bodies; v1 is not", async () => {
  const expanded = openBody(true);
  const collapsed = collapseTriageChecklist(expanded, { completedAt }).body;
  assert.equal(await computeTriageStateFingerprintV2(expanded, labels), await computeTriageStateFingerprintV2(collapsed, labels));
  assert.notEqual(await computeTriageStateFingerprint(expanded, labels), await computeTriageStateFingerprint(collapsed, labels));
});

test("evaluator accepts a collapsed body with a v2 marker and keeps per-obligation state", async () => {
  const collapsed = collapseTriageChecklist(openBody(true), { completedAt }).body;
  const fingerprint = await computeTriageStateFingerprintV2(collapsed, labels);
  const body = collapsed + "\n" + renderTriageCompletionMarker(fingerprint, { scope: "v2" });
  assert.match(body, /fingerprint=sha256:[0-9a-f]{64} scope=v2 -->/);
  const state = await evaluateTriageChecklistStructure(body, labels);
  assert.deepEqual(state.reasons, []);
  assert.equal(state.needs_triage, false);
  assert.equal(state.checklist_state, "complete");
  assert.equal(state.completion_fingerprint_scope, "v2");
  assert.deepEqual(state.observed_item_ids, ids);
});

test("a v2 marker written before collapse still verifies after collapse", async () => {
  const expanded = openBody(true);
  const marker = renderTriageCompletionMarker(await computeTriageStateFingerprintV2(expanded, labels), { scope: "v2" });
  const before = await evaluateTriageChecklistStructure(expanded + "\n" + marker, labels);
  assert.deepEqual(before.reasons, []);
  const after = collapseTriageChecklist(expanded + "\n" + marker, { completedAt }).body;
  assert.deepEqual((await evaluateTriageChecklistStructure(after, labels)).reasons, []);
});

test("legacy v1 markers still verify on open bodies and fail on collapsed bodies", async () => {
  const expanded = openBody(true);
  const v1 = expanded + "\n" + renderTriageCompletionMarker(await computeTriageStateFingerprint(expanded, labels));
  const legacy = await evaluateTriageChecklistStructure(v1, labels);
  assert.deepEqual(legacy.reasons, []);
  assert.equal(legacy.completion_fingerprint_scope, "v1");
  const collapsedWithV1 = collapseTriageChecklist(v1, { completedAt }).body;
  assert.ok((await evaluateTriageChecklistStructure(collapsedWithV1, labels)).reasons.includes("fingerprint_mismatch"));
});

test("an edited body outside the checklist mismatches the v2 fingerprint", async () => {
  const collapsed = collapseTriageChecklist(openBody(true), { completedAt }).body;
  const body = collapsed + "\n" + renderTriageCompletionMarker(await computeTriageStateFingerprintV2(collapsed, labels), { scope: "v2" });
  const edited = body.replace("Something.", "Something else.");
  assert.ok((await evaluateTriageChecklistStructure(edited, labels)).reasons.includes("fingerprint_mismatch"));
});

test("a completed block with an unchecked obligation, or a missing link line, needs triage", async () => {
  const collapsed = collapseTriageChecklist(openBody(true), { completedAt }).body;
  const reopened = collapsed.replace(`${ids[0]}=checked`, `${ids[0]}=unchecked`);
  const state = await evaluateTriageChecklistStructure(reopened, labels);
  assert.ok(state.reasons.includes("unchecked_checklist_item"));
  assert.deepEqual(state.unchecked_item_ids, [ids[0]]);
  const noLink = collapsed.replace(/^Triage checklist done as of.*$/m, "");
  assert.ok((await evaluateTriageChecklistStructure(noLink, labels)).reasons.includes("malformed_checklist"));
});

test("expand restores the full checklist; reused obligations stay checked, others reopen", () => {
  const collapsed = collapseTriageChecklist(openBody(true), { completedAt }).body;
  const same = expandTriageChecklist(collapsed);
  assert.equal(same.expanded, true);
  assert.equal(same.body, openBody(true));
  const delta = expandTriageChecklist(collapsed, { reusedItemIds: ids.slice(1) });
  const parsed = parseTriageChecklist(delta.body);
  assert.equal(parsed?.state, "open");
  assert.equal(parsed?.obligations[ids[0]], "unchecked");
  assert.ok(ids.slice(1).every((id) => parsed?.obligations[id] === "checked"));
});

test("an older-revision completed block expands to the current revision with every item reopened by default", () => {
  const collapsed = collapseTriageChecklist(openBody(true), { completedAt }).body;
  const older = collapsed
    .replace(`revision=${CURRENT_TRIAGE_REVISION} state=complete`, "revision=22 state=complete")
    .replace(`triage version ${CURRENT_TRIAGE_REVISION} at`, "triage version 22 at");
  const parsed = parseTriageChecklist(expandTriageChecklist(older).body);
  assert.equal(parsed?.revision, CURRENT_TRIAGE_REVISION);
  assert.ok(Object.values(parsed?.obligations ?? {}).every((state) => state === "unchecked"));
});

test("issue scope normalization is unchanged by collapse, so assessment bindings stay valid", () => {
  const expanded = openBody(true);
  const collapsed = collapseTriageChecklist(expanded, { completedAt }).body;
  assert.equal(normalizeIssueScopeBody(collapsed), normalizeIssueScopeBody(expanded));
  assert.ok(!normalizeIssueScopeBody(collapsed).includes("done as of triage version"));
  // Foreign prose inside a completed-state block stays substantive scope.
  const tampered = collapsed.replace(/(Triage checklist done as of[^\n]*)/, "$1\nExtra scope text.");
  assert.notEqual(normalizeIssueScopeBody(tampered), normalizeIssueScopeBody(expanded));
});

test("obligation parsing and checklist URLs", () => {
  assert.deepEqual(parseTriageObligations("a=checked,b-c=unchecked"), { a: "checked", "b-c": "unchecked" });
  assert.equal(parseTriageObligations("a=checked,a=checked"), null);
  assert.equal(parseTriageObligations("a=done"), null);
  assert.equal(triageChecklistUrl(null), "https://github.com/spencer-shadley/.github/blob/master/contracts/governed-intake-body.v1.json");
  assert.equal(triageChecklistUrl("not a sha"), triageChecklistUrl(null));
});
