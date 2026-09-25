import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadContract, generateTaskMarkdown, generateTaskYaml, checkProjections, writeProjections } from "../contracts/governed-intake-body.generate.ts";
import { validateIssueTemplate, validateGovernedIntakeBody, computeGovernedWorkUnitKey, validateGovernedWorkUnitKey, renderGovernedWorkUnitKeyMarker } from "../contracts/governed-intake-body.evaluate.ts";
import { buildGovernedIntakeRelease } from "../contracts/governed-intake-body.release.ts";
import { admitGovernedIntakeRelease, verifyGovernedIntakeRelease, computePayloadDigest, sha256, type GovernedIntakeReleasePin } from "../contracts/governed-intake-release.verify.ts";
import { renderTriageChecklistBlock, renderTriageCompletionMarker, computeTriageStateFingerprint, evaluateTriageChecklistState, CURRENT_TRIAGED_LABEL } from "../contracts/governed-intake-triage-state.evaluate.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const c = loadContract(root);
const identity = { fixOwnerGitHubSlug: "Spencer-Shadley/.github", workType: "Task", canonicalWorkUnitIdentity: "producer relocation" };
function validBody() {
  const ranks = c.taxonomyRanks;
  return [
    "## Work type", "Task", "## Governed work-unit key", renderGovernedWorkUnitKeyMarker(identity),
    "## What happened or what is needed?", "Move the intake producer with preserved validation behavior.",
    "## Initial priority guess", "P2", "## Why this initial priority?", "Prevent template drift.",
    "## Relevant details", "- repository: spencer-shadley/.github", `- commit: ${"a".repeat(40)}`, "- path: .github/ISSUE_TEMPLATE/task.yml",
    "## Exact leases", "contracts/governed-intake-body.generate.ts",
    "## Root-cause taxonomy and disposition", "| Rank | Finding | Disposition | Reified as |", "|---|---|---|---|",
    ...ranks.map((r: string) => `| ${r} | Producer ownership mismatch | assigned-issue | spencer-shadley/.github#13 |`),
    `### A. ${c.defectLadders.prevention.heading}`, "| Rank | Preventive control | Status |", "|---|---|---|",
    ...ranks.map((r: string) => `| ${r} | Reject independently authored copies | assigned-issue |`),
    `### B. ${c.defectLadders.detectHealRecover.heading}`, "| Rank | Notice | Self-heal / contain | Restore | Escalate if no progress | Status |", "|---|---|---|---|---|---|",
    ...ranks.map((r: string) => `| ${r} | Digest check | Reject corrupt release | Restore admitted release | Owner issue | assigned-issue |`),
    "## Durable fix and acceptance", "Producer and verified consumers agree on release identity.",
    "## Human-decision state", "No human decision required",
  ].join("\n");
}
function scratch(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "intake-producer-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "producer"), out = path.join(dir, "release");
  mkdirSync(source);
  cpSync(path.join(root, "contracts"), path.join(source, "contracts"), { recursive: true });
  mkdirSync(path.join(source, ".github", "ISSUE_TEMPLATE"), { recursive: true });
  cpSync(path.join(root, ".github/ISSUE_TEMPLATE/task.yml"), path.join(source, ".github/ISSUE_TEMPLATE/task.yml"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: source, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main"); git("remote", "add", "origin", "https://github.com/spencer-shadley/.github.git");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "test source");
  const commit = git("rev-parse", "HEAD");
  const release = buildGovernedIntakeRelease({ repoRoot: source, commit, outputDir: out });
  const pin: GovernedIntakeReleasePin = { repository: "spencer-shadley/.github", commit, revision: c.version, payloadDigest: release.manifest.payloadDigest };
  return { source, out, git, commit, release, pin };
}

test("canonical projections are exact, valid, and contain no cross-repository copy instruction", () => {
  assert.equal(checkProjections(root).ok, true);
  assert.equal(validateIssueTemplate(generateTaskMarkdown(c)).ok, true);
  assert.doesNotMatch(generateTaskYaml(c), /Copy this file|Generated projection of Code/);
  assert.match(generateTaskMarkdown(c), /repository: spencer-shadley\/\.github/);
  assert.equal(c.owner, "spencer-shadley/.github");
  assert.match(generateTaskYaml(c), /description: "One paragraph\. For bugs: symptom \+ repro\. For features: the user-visible outcome\."/);
});
test("complete body is accepted while incomplete or malformed identities are refused", () => {
  assert.deepEqual(validateGovernedIntakeBody(validBody()), { ok: true, schemaVersion: "governed-intake-body-v1" });
  assert.equal(validateGovernedIntakeBody(generateTaskMarkdown(c)).ok, false);
  const marker = renderGovernedWorkUnitKeyMarker(identity);
  assert.equal(validateGovernedWorkUnitKey(marker).ok, true);
  assert.equal(validateGovernedWorkUnitKey(marker + "\n" + marker).reason, "multiple");
  assert.equal(validateGovernedWorkUnitKey(marker.replace("sha256:", "sha256:x")).reason, "malformed");
  assert.equal(validateGovernedIntakeBody(validBody().replace("| Domain | Producer", "| Wrong | Producer")).ok, false);
});
test("governed key preserves canonical identity case and length-framed Unicode normalization", () => {
  const a = computeGovernedWorkUnitKey({ ...identity, canonicalWorkUnitIdentity: " Café " });
  const b = computeGovernedWorkUnitKey({ ...identity, fixOwnerGitHubSlug: " spencer-shadley/.github ", workType: "task", canonicalWorkUnitIdentity: "Cafe\u0301" });
  assert.equal(a, b);
  assert.notEqual(a, computeGovernedWorkUnitKey({ ...identity, canonicalWorkUnitIdentity: "café" }));
});
test("current checklist still requires fingerprint, completed items and exactly one substrate", async () => {
  const body = validBody() + "\n" + renderTriageChecklistBlock({ checked: true });
  const labels = [CURRENT_TRIAGED_LABEL, "cloud-ready", "effort:medium", "tier:auto"];
  const completed = body + "\n" + renderTriageCompletionMarker(await computeTriageStateFingerprint(body, labels));
  assert.equal((await evaluateTriageChecklistState(completed, labels)).needs_triage, false);
  assert.equal((await evaluateTriageChecklistState(completed, [...labels, "local-required"])).needs_triage, true);
  assert.equal((await evaluateTriageChecklistState(completed.replace("- [x]", "- [ ]"), labels)).needs_triage, true);
});
test("release is reproducible, source-bound and independently pinned", (t) => {
  const s = scratch(t);
  const second = buildGovernedIntakeRelease({ repoRoot: s.source, commit: s.commit });
  assert.equal(second.manifestJson, s.release.manifestJson);
  assert.equal(admitGovernedIntakeRelease(s.out, s.pin).ok, true);
  assert.equal(admitGovernedIntakeRelease(s.out, { ...s.pin, commit: "b".repeat(40) }).ok, false);
  assert.equal(admitGovernedIntakeRelease(s.out, { ...s.pin, revision: c.version + 1 }).ok, false);
  assert.equal(admitGovernedIntakeRelease(s.out, { ...s.pin, payloadDigest: "0".repeat(64) }).ok, false);
  assert.equal(admitGovernedIntakeRelease(s.out, { ...s.pin, commit: "0".repeat(40) }).ok, false);
  assert.equal(admitGovernedIntakeRelease(s.out, null as never).ok, false);
});
test("producer refuses uncommitted source, a branch instead of commit, and ordinary consumer origin", (t) => {
  const s = scratch(t);
  assert.throws(() => buildGovernedIntakeRelease({ repoRoot: s.source, commit: "main" }));
  const file = path.join(s.source, "contracts/governed-intake-body.evaluate.ts");
  writeFileSync(file, readFileSync(file, "utf8") + "\n// uncommitted\n");
  assert.throws(() => buildGovernedIntakeRelease({ repoRoot: s.source, commit: s.commit }), /source does not match/);
  s.git("remote", "set-url", "origin", "https://github.com/spencer-shadley/code.git");
  assert.throws(() => writeProjections(s.source), /projection writes belong only/);
});
test("published JavaScript actually executes the same body and checklist evaluators", async (t) => {
  const s = scratch(t);
  assert.equal(admitGovernedIntakeRelease(s.out, s.pin).ok, true);
  const evaluator = await import(pathToFileURL(path.join(s.out, "evaluator.js")).href);
  const triage = await import(pathToFileURL(path.join(s.out, "triage-evaluator.js")).href);
  assert.deepEqual(evaluator.validateGovernedIntakeBody(validBody()), validateGovernedIntakeBody(validBody()));
  assert.equal(triage.CURRENT_TRIAGED_LABEL, CURRENT_TRIAGED_LABEL);
  assert.equal(evaluator.computeGovernedWorkUnitKey(identity), computeGovernedWorkUnitKey(identity));
});
test("corrupt runtime JavaScript is rejected, not hidden by intact TypeScript", (t) => {
  const s = scratch(t);
  writeFileSync(path.join(s.out, "evaluator.js"), "throw new Error('untrusted');\n");
  const result = admitGovernedIntakeRelease(s.out, s.pin);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "corrupt_file");
});
test("manifest rejects foreign producer, traversal, aliases, null and absent payloads", (t) => {
  const s = scratch(t);
  const original = s.release.manifest;
  for (const bad of [null, [], {}, { ...original, producer: { ...original.producer, repository: "spencer-shadley/code" } },
    { ...original, files: { ...original.files, "../escape": { path: "../escape", sha256: "a".repeat(64), byteLength: 0 } } },
    { ...original, files: {} }]) {
    writeFileSync(path.join(s.out, "manifest.json"), JSON.stringify(bad));
    assert.equal(verifyGovernedIntakeRelease(s.out).ok, false);
  }
  const changed = structuredClone(original);
  const bytes = Buffer.from(JSON.stringify({ ...c, version: c.version + 1 }));
  writeFileSync(path.join(s.out, "contract.json"), bytes);
  changed.files["contract.json"] = { path: "contract.json", sha256: sha256(bytes), byteLength: bytes.length };
  changed.payloadDigest = computePayloadDigest(changed.files);
  writeFileSync(path.join(s.out, "manifest.json"), JSON.stringify(changed));
  assert.equal(verifyGovernedIntakeRelease(s.out).ok, false, "even internally rehashed metadata cannot hide alias mismatch");
});
test("missing payload and symlink payload fail closed", (t) => {
  const s = scratch(t);
  unlinkSync(path.join(s.out, "task.md"));
  assert.equal(verifyGovernedIntakeRelease(s.out).ok, false);
  symlinkSync(path.join(s.source, "contracts/generated/governed-intake/task.md"), path.join(s.out, "task.md"));
  const result = verifyGovernedIntakeRelease(s.out);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "corrupt_file");
});
