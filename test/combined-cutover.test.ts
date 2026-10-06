// .github#32 composed cutover: the four accepted inputs (taxonomy #32, direction impact #35,
// type:proposal #45, second opinion/agent_unattested #48) are ONE revision-23 contract. These
// regressions pin the places where the inputs overlapped, so a later edit cannot silently
// drop one input while the others keep the suite green.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract, generateTaskYaml, generateTaskMarkdown } from "../contracts/governed-intake-body.generate.ts";
import { isTriagedChecklistLabel, CURRENT_TRIAGE_REVISION, GOVERNED_TRIAGE_CHECKLIST } from "../contracts/governed-intake-triage-state.evaluate.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = loadContract();
type Item = { id: string; text: string; dependsOn?: string[]; evidenceKeys?: string[] };
const items = contract.triageChecklist.items as Item[];
const item = (id: string): Item => {
  const found = items.find((candidate) => candidate.id === id);
  assert.ok(found, `checklist item ${id} missing`);
  return found;
};
const policy = JSON.parse(readFileSync(path.join(REPO, "contracts/governed-intake-triage-policy.v1.json"), "utf8"));

test("one combined revision 23 carries every accepted input", () => {
  assert.equal(contract.version, 23);
  assert.equal(CURRENT_TRIAGE_REVISION, 23);
  // #32 taxonomy
  assert.equal(contract.triageChecklist.triagedLabelPrefix, "metadata:triage-v");
  assert.deepEqual(contract.triageChecklist.pendingLabels, ["priority:triage-tbd", "progress:triage"]);
  // #45 proposal classification, wired into completion
  assert.match(item("proposal-classification").text, /type:proposal/);
  assert.ok(item("confirm-receipt").dependsOn?.includes("proposal-classification"));
  // #35 direction impact evidence on the stable obligations
  for (const key of ["accepted-decision", "direction-source", "direction-ownership", "related-work"]) {
    assert.ok(item("value-direction").evidenceKeys?.includes(key), `value-direction evidence ${key}`);
    assert.ok(item("dedup-queue-synergy").evidenceKeys?.includes(key), `dedup-queue-synergy evidence ${key}`);
  }
  // #48 high effort second opinion is a suggestion
  assert.equal(policy.secondOpinion.status, "suggestion");
  assert.equal(policy.dispositions["atomic-high"].secondOpinion, "encouraged");
  assert.doesNotMatch(item("higher-intelligence-handoff").text, /^`effort:high`/);
});

test("confirm-receipt states both the #32 stamp and the #48 agent_unattested rule", () => {
  const text = item("confirm-receipt").text;
  assert.match(text, /`metadata:triage-vN` stamp/);
  assert.doesNotMatch(text, /`triaged:vN`/);
  assert.match(text, /agent_unattested/);
  assert.match(text, /no `triaged-by-\*` label/);
});

test("the contract description narrates one Version 23, not an inactive candidate", () => {
  const versions = [...contract.description.matchAll(/Version 23\b/g)];
  assert.equal(versions.length, 1);
  for (const input of ["#32", "#35", "#45", "#48", "type:proposal", "agent_unattested", "metadata:triage-vN"]) {
    assert.ok(contract.description.includes(input), `description names ${input}`);
  }
  assert.doesNotMatch(contract.description, /does not activate candidate taxonomy/);
});

test("the stamp reader accepts the new stamp and the legacy triaged:vN stamp", () => {
  assert.equal(isTriagedChecklistLabel(`metadata:triage-v${CURRENT_TRIAGE_REVISION}`), true);
  assert.equal(isTriagedChecklistLabel("triaged:v22"), true);
  assert.equal(GOVERNED_TRIAGE_CHECKLIST.triagedLabelPrefix, "metadata:triage-v");
});

test("the live task form projects the combined revision", () => {
  const live = readFileSync(path.join(REPO, ".github/ISSUE_TEMPLATE/task.yml"), "utf8");
  assert.equal(live, generateTaskYaml(contract));
  assert.match(live, /governed-triage-checklist: revision=23/);
  assert.match(live, /governed-triage-item: proposal-classification/);
  assert.match(live, /- progress:triage/);
  assert.match(live, /agent_unattested/);
  assert.equal(readFileSync(path.join(REPO, "contracts/generated/governed-intake/task.md"), "utf8"), generateTaskMarkdown(contract));
});
