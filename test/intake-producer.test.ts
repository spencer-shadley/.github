import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadContract, generateTaskMarkdown, generateTaskYaml, generateFeatureYaml, assertGitHubIssueFormTopLevel, checkProjections, writeProjections, assertProducerCheckout, redactRemoteUrl, stripRemoteUrlCredentials, UNDISPLAYABLE_ORIGIN } from "../contracts/governed-intake-body.generate.ts";
import { validateIssueTemplate, validateGovernedIntakeBody, computeGovernedWorkUnitKey, validateGovernedWorkUnitKey, renderGovernedWorkUnitKeyMarker } from "../contracts/governed-intake-body.evaluate.ts";
import { buildGovernedIntakeRelease } from "../contracts/governed-intake-body.release.ts";
import { admitGovernedIntakeRelease, verifyGovernedIntakeRelease, computePayloadDigest, sha256, type GovernedIntakeReleasePin } from "../contracts/governed-intake-release.verify.ts";
import { renderTriageChecklistBlock, renderTriageCompletionMarker, computeTriageStateFingerprint, evaluateTriageChecklistStructure as evaluateTriageChecklistState, CURRENT_TRIAGED_LABEL } from "../contracts/governed-intake-triage-state.evaluate.ts";

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
  cpSync(path.join(root, ".github/ISSUE_TEMPLATE"), path.join(source, ".github/ISSUE_TEMPLATE"), { recursive: true });
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
test("live issue forms satisfy GitHub's top-level Issue Form schema (.github#31)", () => {
  const forms = {
    task: readFileSync(path.join(root, ".github/ISSUE_TEMPLATE/task.yml"), "utf8"),
    feature: readFileSync(path.join(root, ".github/ISSUE_TEMPLATE/feature.yml"), "utf8"),
    generatedTask: generateTaskYaml(c),
    generatedFeature: generateFeatureYaml(c),
  };
  for (const [name, yaml] of Object.entries(forms)) {
    assert.doesNotThrow(() => assertGitHubIssueFormTopLevel(yaml, name), name);
    assert.doesNotMatch(yaml, /^title:\s*(?:""|''|~|null)?\s*$/m, `${name}: optional title must be omitted, not empty`);
  }
  const withTitle = (value: string) => forms.task.replace(/^labels:/m, `title: ${value}\nlabels:`);
  // GitHub: "title must be of type String and cannot be empty" hides every inherited form.
  for (const bad of ['""', "''", "", "~", "null", '"   "']) {
    assert.throws(() => assertGitHubIssueFormTopLevel(withTitle(bad)), /title must be of type String and cannot be empty/, `title: ${bad}`);
  }
  assert.doesNotThrow(() => assertGitHubIssueFormTopLevel(withTitle('"[Task] "')));
  assert.throws(() => assertGitHubIssueFormTopLevel(forms.task.replace(/^name: .*$/m, 'name: ""')), /name must be of type String/);
  assert.throws(() => assertGitHubIssueFormTopLevel(forms.task.replace(/^description: .*\n/m, "")), /description is required/);
  assert.throws(() => assertGitHubIssueFormTopLevel(forms.task.replace(/^labels:/m, "titel: x\nlabels:")), /unknown top-level key titel/);
  assert.throws(() => assertGitHubIssueFormTopLevel(forms.task.replace(/^body:\n[\s\S]*$/m, "body:\n")), /body must be a non-empty array/);
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
test("body with empty acceptance criteria is refused; a file:line reference warns without blocking (code#7074)", () => {
  const empty = validBody().replace(
    "## Durable fix and acceptance\nProducer and verified consumers agree on release identity.",
    "## Durable fix and acceptance\n",
  );
  const emptyResult = validateGovernedIntakeBody(empty);
  assert.equal(emptyResult.ok, false);
  assert.ok(
    !emptyResult.ok && emptyResult.missing.some((m) => /Durable fix and acceptance content/.test(m)),
  );

  const prescriptive = validBody().replace(
    "Producer and verified consumers agree on release identity.",
    "Edit contracts/governed-intake-body.evaluate.ts:171 to change the regex.",
  );
  const prescriptiveResult = validateGovernedIntakeBody(prescriptive);
  assert.equal(prescriptiveResult.ok, true);
  assert.ok(prescriptiveResult.warnings?.some((w) => /file:line reference/.test(w)));

  assert.equal(validateGovernedIntakeBody(validBody()).warnings, undefined);
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
/** Error text plus any `actual`/`expected` the test runner would print for it. */
function printedError(fn: () => void): string {
  try { fn(); } catch (error) {
    const e = error as { message?: unknown; actual?: unknown; expected?: unknown; stack?: unknown };
    return [e.message, e.actual, e.expected, e.stack].map((part) => String(part ?? "")).join("\n");
  }
  assert.fail("expected a refusal");
}
test("producer identity ignores a credentialed insteadOf rewrite and never prints the credential (.github#39)", (t) => {
  const s = scratch(t);
  const secret = "DUMMYSECRET39abc";
  // Repository-local rewrite, as a host's global `url.<base>.insteadOf` would apply it.
  s.git("config", `url.https://x-access-token:${secret}@github.com/.insteadOf`, "https://github.com/");
  // Precondition without echoing the URL: the effective (rewritten) origin carries a credential.
  assert.ok(s.git("remote", "get-url", "origin").includes("x-access-token:"), "the effective URL carries a credential");
  assert.doesNotThrow(() => assertProducerCheckout(s.source));
  assert.doesNotThrow(() => buildGovernedIntakeRelease({ repoRoot: s.source, commit: s.commit }));

  s.git("remote", "set-url", "origin", "https://github.com/spencer-shadley/code.git");
  const refusal = printedError(() => assertProducerCheckout(s.source));
  assert.match(refusal, /projection writes belong only/);
  assert.match(refusal, /origin: https:\/\/github\.com\/spencer-shadley\/code\.git/);
  assert.doesNotMatch(refusal, new RegExp(secret));
});
test("a credential stored in origin itself is stripped for matching and redacted in the refusal (.github#39)", (t) => {
  const s = scratch(t);
  const secret = "DUMMYSECRET39def";
  s.git("remote", "set-url", "origin", `https://x-access-token:${secret}@github.com/spencer-shadley/.github.git`);
  assert.doesNotThrow(() => assertProducerCheckout(s.source));
  s.git("remote", "set-url", "origin", `https://x-access-token:${secret}@github.com/spencer-shadley/code.git`);
  const refusal = printedError(() => writeProjections(s.source));
  assert.match(refusal, /projection writes belong only.*origin: https:\/\/<redacted>@github\.com\/spencer-shadley\/code\.git/);
  assert.doesNotMatch(refusal, new RegExp(secret));
  s.git("remote", "remove", "origin");
  assert.throws(() => assertProducerCheckout(s.source), /no origin remote configured/);
});
test("remote URL credential helpers keep the canonical producer forms (.github#39)", () => {
  for (const url of ["https://github.com/spencer-shadley/.github.git", "git@github.com:spencer-shadley/.github.git", "ssh://git@github.com/spencer-shadley/.github"]) {
    assert.equal(stripRemoteUrlCredentials(url), url);
    assert.equal(redactRemoteUrl(url), url);
  }
  assert.equal(stripRemoteUrlCredentials("https://x-access-token:s3cr3t@github.com/o/r.git"), "https://github.com/o/r.git");
  assert.equal(stripRemoteUrlCredentials("https://ghp_token@github.com/o/r.git"), "https://github.com/o/r.git");
  assert.equal(stripRemoteUrlCredentials("ssh://git:s3cr3t@github.com/o/r"), "ssh://git@github.com/o/r");
  assert.equal(redactRemoteUrl("https://x-access-token:s3cr3t@github.com/o/r.git"), "https://<redacted>@github.com/o/r.git");
  assert.equal(redactRemoteUrl("ssh://git:s3cr3t@github.com/o/r"), "ssh://<redacted>@github.com/o/r");
});
test("the refusal never echoes any credential fragment, whatever the stored origin looks like (.github#39)", () => {
  const secret = "DUMMYSECRET39ghi";
  const inputs = [
    `https://user:pa@${secret}@github.com/o/r.git`, // raw "@" inside the password
    `https://user:${secret}/x@github.com/o/r.git`, // "/" inside the password
    `https://user:${secret} x@github.com/o/r.git`, // whitespace inside the password
    `ssh://${secret}@github.com/o/r`,
    `https://github.com/o/r.git?access_token=${secret}`,
    `https:/user:${secret}@github.com/o/r.git`,
    `user:${secret}@github.com:o/r.git`,
    `git+https://user:${secret}@github.com/o/r.git`,
    `https://x-access-token:${secret}@github.com/o/r.git`,
  ];
  for (const url of inputs) {
    const shown = redactRemoteUrl(url);
    assert.ok(!shown.includes(secret) && !shown.includes(secret.slice(4)), `credential fragment echoed for input #${inputs.indexOf(url)}`);
  }
  assert.equal(redactRemoteUrl(`https://user:pa@${secret}@github.com/o/r.git`), "https://<redacted>@github.com/o/r.git");
  assert.equal(redactRemoteUrl(`https://github.com/o/r.git?access_token=${secret}`), UNDISPLAYABLE_ORIGIN);
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
test("portable release ships policy, delta planner and compose as executable JS with matching aliases", async (t) => {
  const s = scratch(t);
  assert.equal(admitGovernedIntakeRelease(s.out, s.pin).ok, true);
  assert.equal(readFileSync(path.join(s.out, "policy.json")).equals(readFileSync(path.join(s.out, "governed-intake-triage-policy.v1.json"))), true);
  assert.equal(readFileSync(path.join(s.out, "compose.js")).equals(readFileSync(path.join(s.out, "governed-intake-triage.compose.js"))), true);
  const compose = await import(pathToFileURL(path.join(s.out, "compose.js")).href);
  const planner = await import(pathToFileURL(path.join(s.out, "delta-planner.js")).href);
  const policyEval = await import(pathToFileURL(path.join(s.out, "policy-evaluator.js")).href);
  const isolated = await compose.evaluateGovernedIntakeTriage({
    body: validBody(),
    labels: [CURRENT_TRIAGED_LABEL],
    evidence: { kind: "missing" },
  });
  assert.equal(isolated.status, "pending");
  assert.ok(isolated.reasons.includes("missing_semantic_evidence"));
  assert.equal(isolated.consumerCutover, false);
  assert.equal(typeof planner.planChecklistDelta, "function");
  assert.equal(typeof policyEval.evaluateTriagePolicy, "function");
  assert.match(readFileSync(path.join(s.out, "compose.js"), "utf8"), /from "\.\/governed-intake-triage-policy\.evaluate\.js"/);
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
test("missing payload fails closed", (t) => {
  const s = scratch(t);
  unlinkSync(path.join(s.out, "task.md"));
  assert.equal(verifyGovernedIntakeRelease(s.out).ok, false);
});
test("symlink payload fails closed", (t) => {
  const s = scratch(t);
  const payload = path.join(s.out, "task.md");
  unlinkSync(payload);
  try {
    symlinkSync(path.join(s.source, "contracts/generated/governed-intake/task.md"), payload);
  } catch (error) {
    // Non-elevated Windows cannot create file symlinks; a directory junction is still not a regular file.
    const code = error && typeof error === "object" && "code" in error ? String((error as NodeJS.ErrnoException).code) : "";
    if (code !== "EPERM" && code !== "EACCES") throw error;
    execFileSync("cmd.exe", ["/c", "mklink", "/J", payload, path.join(s.source, "contracts", "generated", "governed-intake")], {
      windowsHide: true,
    });
  }
  const result = verifyGovernedIntakeRelease(s.out);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "corrupt_file");
});
test("missing policy payload fails closed without requiring a symlink", (t) => {
  const s = scratch(t);
  unlinkSync(path.join(s.out, "governed-intake-triage-policy.v1.json"));
  const result = verifyGovernedIntakeRelease(s.out);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "missing_file");
});

test("revision 23 adds proposal classification as a delta-only new item (type:proposal)", async () => {
  const { planChecklistDelta } = await import("../contracts/governed-intake-triage-state.migrate.ts");
  assert.equal(c.version, 23);
  const items = c.triageChecklist.items as Array<{ id: string; title: string; text: string; dependsOn?: string[]; evidenceKeys?: string[]; resultDependencies?: string[] }>;
  const item = items.find((i) => i.id === "proposal-classification");
  assert.ok(item && /type:proposal/.test(item.text));
  assert.ok(items.find((i) => i.id === "confirm-receipt")?.dependsOn?.includes("proposal-classification"));
  const previousItems = items.filter((i) => i.id !== "proposal-classification").map((i) => i.id === "confirm-receipt"
    ? { ...i, dependsOn: (i.dependsOn ?? []).filter((d) => d !== "proposal-classification") } : i);
  const delta = planChecklistDelta({ revision: 22, items: previousItems }, { revision: 23, items }, {
    completionVerified: true, completedItemIds: previousItems.map((i) => i.id), staleItemIds: [], changedEvidenceKeys: [], changedResultItemIds: [],
  });
  assert.deepEqual(delta.reevaluatedItems, [{ id: "proposal-classification", reasons: ["new-item"] }]);
  assert.deepEqual(delta.mechanicallyChangedItemIds, ["confirm-receipt"]);
});

// #35 uses the real composition and public completion API with independently observed facts.
import { evaluateGovernedIntakeTriage, currentChecklistRelease, type ComposedTriageInput, type DirectionObservation } from '../contracts/governed-intake-triage.compose.ts';
import { boundTriagePolicyFromProducer, fingerprintIssueScope, fingerprintDirectionFacts } from '../contracts/governed-intake-policy-binding.ts';
import { fingerprintAssessment } from '../contracts/governed-intake-triage-policy.evaluate.ts';
import { evaluateTriageChecklistState as evaluateSemanticChecklist } from '../contracts/governed-intake-triage-state.evaluate.ts';
import { planChecklistDelta } from '../contracts/governed-intake-triage-state.migrate.ts';
const directionHash = (letter: string) => `sha256:${letter.repeat(64)}`;
async function directionFixture(material = false): Promise<ComposedTriageInput> {
  const subject = { repository: 'spencer-shadley/.github', issueNumber: 35, title: 'Direction-impact producer' };
  const body = validBody() + '\n' + renderTriageChecklistBlock({ checked: true });
  const labels = [CURRENT_TRIAGED_LABEL, 'effort:medium', 'decomp-not-needed', 'cloud-ready', 'tier:auto'];
  const completed = body + '\n' + renderTriageCompletionMarker(await computeTriageStateFingerprint(body, labels));
  const scopeFingerprint = fingerprintIssueScope({ ...subject, body: completed });
  const workUnitKey = `sha256:${computeGovernedWorkUnitKey(identity)}`;
  const bound = boundTriagePolicyFromProducer();
  const assessment = { workUnitKey, scopeFingerprint, policyIdentity: bound.policyIdentity, rubricIdentity: bound.rubricIdentity,
    disposition: 'ordinary' as const, effort: 'medium' as const, rationale: 'Bounded producer change.', verification: 'Named semantic fixtures.',
    resumability: 'Existing receipt and settlement.', confidence: 'high' as const, blockingAssessmentUnknowns: [], implementationUnknowns: [], assessmentFingerprint: '' };
  assessment.assessmentFingerprint = await fingerprintAssessment(assessment, null);
  const publication = { repository: 'spencer-shadley/.github', sourceCommit: 'a'.repeat(40), payloadDigest: 'b'.repeat(64), revision: c.version };
  const facts = { seed: subject, threads: [
    { ...subject, materialFingerprint: directionHash('a'), decisions: [{ commentId: 5974265449, state: 'accepted' as const, contentFingerprint: directionHash('b') }] },
    { repository: 'spencer-shadley/code', issueNumber: 7472, materialFingerprint: directionHash('c'), decisions: [] },
  ], sourceFingerprint: directionHash('d'), ownershipFingerprint: directionHash('e'), relatedWorkFingerprint: directionHash('f') };
  const factsFingerprint = fingerprintDirectionFacts(facts);
  const directionObservation: DirectionObservation = { facts, coverage: 'complete', publication };
  if (material) directionObservation.reconciliation = {
    receiptId: 'existing-audit-settlement', factsFingerprint, scopeFingerprint, publication, status: 'verified',
    selectedSubjects: [{ repository: 'spencer-shadley/code', issueNumber: 7472 }],
    outcomes: [{ subject: { repository: 'spencer-shadley/code', issueNumber: 7472 }, disposition: 'obsolete',
      decision: { repository: subject.repository, issueNumber: subject.issueNumber, commentId: 5974265449 },
      readbackFingerprint: directionHash('a'), conservationVerified: true, relationshipsVerified: true }],
  };
  return { subject, body: completed, labels, evidence: { kind: 'adapter-verified', workUnitKey, scopeFingerprint, assessment,
    state: 'open', repositoryActive: true, priorHighEffort: false, requiresQualifiedAssessment: false, currentGraphFingerprint: null,
    hasExecutableChildGraph: false, finalAttributesScopeFingerprint: scopeFingerprint, directionEvidenceFresh: true,
    trusted: { admissions: [], graphs: [], requiredCapabilities: { 'scope-assessment': 'floor', 'atomic-confirmation': 'floor', implementation: 'floor' } } },
    directionImpact: { workUnitKey, scopeFingerprint, factsFingerprint, revision: c.version, assessment: material ? 'potential-impact' : 'no-impact',
      rationale: material ? 'Accepted direction affects old cross-repo work.' : 'No component, SSOT, owner or related-work impact.',
      ...(material ? { reconciliationReceiptId: 'existing-audit-settlement' } : {}) }, directionObservation };
}
test('direction no-impact completes with zero cohort effects and unchanged repeat is a pure no-op', async () => {
  const input = await directionFixture(); const before = structuredClone(input);
  const first = await evaluateGovernedIntakeTriage(input);
  assert.equal(first.status, 'complete', JSON.stringify(first.reasons));
  assert.deepEqual(await evaluateGovernedIntakeTriage(input), first); assert.deepEqual(input, before);
  const release = currentChecklistRelease();
  const delta = planChecklistDelta(release, release, { completionVerified: true, completedItemIds: release.items.map(i => i.id),
    staleItemIds: [], changedEvidenceKeys: [], changedResultItemIds: [] });
  assert.deepEqual(delta.reevaluatedItems, []); assert.equal(delta.requiresResultReconciliation, false);
});
test('accepted retirement verified through existing audit completes; proposal cannot authorize it', async () => {
  const input = await directionFixture(true);
  assert.equal((await evaluateGovernedIntakeTriage(input)).status, 'complete');
  input.directionObservation!.facts.threads[0].decisions[0].state = 'proposed';
  input.directionImpact!.factsFingerprint = fingerprintDirectionFacts(input.directionObservation!.facts);
  input.directionObservation!.reconciliation!.factsFingerprint = input.directionImpact!.factsFingerprint;
  const result = await evaluateGovernedIntakeTriage(input);
  assert.equal(result.status, 'pending'); assert.ok(result.reasons.includes('direction_accepted_decision_required'));
});
for (const state of ['launched','failed','incomplete','unknown','unsupported'] as const) {
  test(`direction ${state} settlement stays explicit/resumable instead of complete`, async () => {
    const input = await directionFixture(true); input.directionObservation!.reconciliation!.status = state;
    const result = await evaluateGovernedIntakeTriage(input);
    assert.equal(result.status, 'pending'); assert.ok(result.reasons.includes(`direction_reconciliation_${state}`));
    assert.equal(input.directionObservation!.reconciliation!.receiptId, 'existing-audit-settlement');
    const publicResult = await evaluateSemanticChecklist(input.body, input.labels, input);
    assert.equal(publicResult.needs_triage, true);
    assert.ok(publicResult.unchecked_item_ids.includes('value-direction')); assert.ok(publicResult.unchecked_item_ids.includes('dedup-queue-synergy'));
  });
}
test('changed accepted thread facts invalidate prior assessment despite matching scope and checked boxes', async () => {
  const input = await directionFixture(); input.directionObservation!.facts.threads[0].decisions[0].contentFingerprint = directionHash('f');
  const result = await evaluateGovernedIntakeTriage(input); assert.equal(result.status, 'pending');
  assert.ok(result.reasons.includes('direction_impact_subject_or_facts_mismatch'));
  const release = currentChecklistRelease();
  const delta = planChecklistDelta(release, release, { completionVerified: true, completedItemIds: release.items.map(i => i.id),
    staleItemIds: [], changedEvidenceKeys: ['accepted-decision'], changedResultItemIds: [] });
  assert.deepEqual(delta.reevaluatedItems.map(i => i.id), ['value-direction','dedup-queue-synergy']);
  assert.ok(delta.reusedItemIds.includes('priority-work-dimensions'));
});
for (const fault of ['seed','decision-thread','selection','readback','publication','coverage','missing'] as const) {
  test(`direction independently observed ${fault} cannot be forged by receipt assertions`, async () => {
    const input = await directionFixture(true); const observation = input.directionObservation!;
    if(fault==='seed') observation.facts.seed.issueNumber++;
    if(fault==='decision-thread') observation.reconciliation!.outcomes[0].decision!.issueNumber++;
    if(fault==='selection') observation.reconciliation!.outcomes=[];
    if(fault==='readback') observation.reconciliation!.outcomes[0].relationshipsVerified=false;
    if(fault==='publication') observation.publication.revision++;
    if(fault==='coverage') observation.coverage='unknown';
    if(fault==='missing') delete input.directionObservation;
    assert.equal((await evaluateGovernedIntakeTriage(input)).status,'pending');
  });
}
test('superseded valid work requires a conserved readback destination, while obsolete needs no successor', async () => {
  const input = await directionFixture(true); const outcome=input.directionObservation!.reconciliation!.outcomes[0];
  outcome.disposition='superseded'; assert.equal((await evaluateGovernedIntakeTriage(input)).status,'pending');
  outcome.destination={repository:'spencer-shadley/.github',issueNumber:35};
  assert.equal((await evaluateGovernedIntakeTriage(input)).status,'complete');
  outcome.conservationVerified=false; assert.equal((await evaluateGovernedIntakeTriage(input)).status,'pending');
});
test('candidate taxonomy stamp cannot replace the actually current producer revision', async () => {
  const input=await directionFixture(); input.labels=[...input.labels.filter(l=>l!==CURRENT_TRIAGED_LABEL),`metadata:triage-v${c.version+1}`];
  assert.equal((await evaluateGovernedIntakeTriage(input)).status,'pending');
  input.directionImpact!.revision++; assert.ok((await evaluateGovernedIntakeTriage(input)).reasons.includes('direction_impact_subject_or_facts_mismatch'));
});
test('direction facts ignore ordering but retain actual thread and decision identity', async () => {
  const input=await directionFixture(); const facts=input.directionObservation!.facts;
  const identity=fingerprintDirectionFacts(facts); facts.threads.reverse(); assert.equal(fingerprintDirectionFacts(facts),identity);
  facts.threads[1].decisions[0].commentId++; assert.notEqual(fingerprintDirectionFacts(facts),identity);
});

test('no-impact cannot erase an existing unknown audit merely because outcome rows are empty', async () => {
  const input = await directionFixture(true);
  input.directionImpact!.assessment = 'no-impact';
  delete input.directionImpact!.reconciliationReceiptId;
  input.directionObservation!.reconciliation!.status = 'unknown';
  input.directionObservation!.reconciliation!.outcomes = [];
  input.directionObservation!.reconciliation!.selectedSubjects = [];
  const result = await evaluateGovernedIntakeTriage(input);
  assert.equal(result.status, 'pending');
  assert.ok(result.reasons.includes('no_impact_has_cohort_effects'));
  assert.equal(input.directionObservation!.reconciliation!.receiptId, 'existing-audit-settlement');
});
