/** Consumer-pin integration test (spencer-shadley/code#8013): a governed-intake release must not
 * merge while code's deployed github-mcp-worker would refuse it, unless a paired consumer PR admits it.
 * Fixtures are byte-exact git blobs recorded from spencer-shadley/.github and spencer-shadley/code
 * (each named by its git blob id and re-hashed on load). Offline and deterministic.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CONSUMER_FILES, evaluateConsumerPinGate, loadRecordedCase, main, parsePairingTrailer, type GateInput,
} from "../contracts/governed-intake-consumer-pin.check.ts";
import {
  VENDORED_WORKER_RESOLUTION, extractWorkerDeclaration, extractWorkerFunction, fingerprintWorkerSource, gitBlobSha, resolveWorkerAdmission, sha256Hex, workerResolutionDrift,
} from "../contracts/governed-intake-worker-admission.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "test/fixtures/consumer-pin");
const load = (name: string) => loadRecordedCase(path.join(fixtures, `${name}.case.json`));
const encode = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
const withConsumerFile = (input: GateInput, file: string, edit: (value: any) => void): GateInput => {
  const value = decode(input.consumer.files[file]);
  edit(value);
  return { ...input, consumer: { ...input.consumer, files: { ...input.consumer.files, [file]: encode(value) } } };
};

test("every recorded fixture blob is the byte-exact git object it is named after", () => {
  const blobs = readdirSync(path.join(fixtures, "blobs"));
  assert.ok(blobs.length > 0);
  for (const name of blobs) {
    const bytes = new Uint8Array(readFileSync(path.join(fixtures, "blobs", name)));
    assert.equal(gitBlobSha(bytes), name);
  }
});

test("regression .github#40: same-revision republish f2257602 vs worker pin d2ee7995 is refused with commit_mismatch", () => {
  const { input } = load("dotgithub-40-same-revision-republish");
  const verdict = evaluateConsumerPinGate(input);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.outcome, "refused");
  assert.ok(!verdict.master.ok);
  if (verdict.master.ok) return;
  assert.equal(verdict.master.refusal.code, "commit_mismatch");
  assert.equal(verdict.master.refusal.slot, "published");
  assert.equal(verdict.master.refusal.field, "producer.producerCommit");
  assert.equal(verdict.master.refusal.expected, "d2ee7995026cfceba4ecb1d459a19dd893a28948");
  assert.equal(verdict.master.refusal.actual, "f2257602988ba9f5d5e94470958a1eb3ba469940");
  assert.match(verdict.lines.join("\n"), /tools\/work-spine\/governed-intake-worker-published-release\.pin\.json producer\.producerCommit = d2ee7995.*candidate release has f2257602/);
  assert.match(verdict.lines.join("\n"), /Consumer-Pin-Pair: spencer-shadley\/code#<number>/);
});

test("regression .github#43: released bytes changed without republishing are refused even though the manifest is unchanged", () => {
  const { input } = load("dotgithub-43-unpublished-source-change");
  assert.ok(input.baseManifest && gitBlobSha(input.baseManifest) === gitBlobSha(input.candidate.manifest), "fixture keeps the manifest unchanged");
  const verdict = evaluateConsumerPinGate(input);
  assert.equal(verdict.ok, false);
  assert.ok(!verdict.master.ok);
  if (verdict.master.ok) return;
  assert.equal(verdict.master.refusal.code, "corrupt_file");
  assert.equal(verdict.master.refusal.field, "cached manifest files[governed-intake-body.v1.json]");
  assert.match(verdict.lines.join("\n"), /released bytes changed without republishing/);
});

test("a declared pairing cannot rescue the .github#40 shape when the paired head still pins the old producer", () => {
  const { input } = load("dotgithub-40-same-revision-republish");
  const verdict = evaluateConsumerPinGate({
    ...input, pairedPullRequest: 9999,
    paired: { pullRequest: 9999, state: "open", merged: false, baseRef: "master", consumer: input.consumer },
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.lines.join("\n"), /paired spencer-shadley\/code#9999 head c144fbd1 does not admit this release either/);
});

test("current main with an unchanged manifest is admitted by code master's worker pin", () => {
  const { input } = load("main-0a9a6cbd-unchanged");
  const verdict = evaluateConsumerPinGate(input);
  assert.equal(verdict.outcome, "admitted");
  assert.ok(verdict.master.ok);
  if (!verdict.master.ok) return;
  assert.equal(verdict.master.slot, "published");
  assert.equal(verdict.master.identity.producerCommit, "69809c201a9650fbc6d9129b2c7be03738bc83de");
  assert.equal(verdict.master.identity.payloadDigest, "sha256:3b732d9153237110a4a3dcb465301dc673421d944628aea1175bfdd5e8814203");
});

test("an unchanged manifest passes with a pre-existing drift warning when only manifest identity is refused", () => {
  const { input } = load("dotgithub-40-same-revision-republish");
  const verdict = evaluateConsumerPinGate({ ...input, baseManifest: input.candidate.manifest });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.outcome, "unchanged-pre-existing-drift");
});

test(".github#55 + code#8014: refused alone, admitted only through the declared paired consumer PR", () => {
  const { input } = load("dotgithub-55-paired-with-code-8014");
  const alone = evaluateConsumerPinGate({ ...input, pairedPullRequest: null, paired: null });
  assert.equal(alone.ok, false);
  const paired = evaluateConsumerPinGate(input);
  assert.equal(paired.outcome, "admitted-by-paired-consumer-pr");
  assert.match(paired.lines.join("\n"), /merge spencer-shadley\/code#8014 at head d5c7e16f9bf509769ce85b48509665523c2e8b4c first/);
});

test("pairing is refused when the paired PR is closed unmerged, targets another branch, or its pin digest differs", () => {
  const { input } = load("dotgithub-55-paired-with-code-8014");
  const paired = input.paired!;
  assert.equal(evaluateConsumerPinGate({ ...input, paired: { ...paired, state: "closed", merged: false } }).ok, false);
  assert.equal(evaluateConsumerPinGate({ ...input, paired: { ...paired, baseRef: "release" } }).ok, false);
  assert.equal(evaluateConsumerPinGate({ ...input, paired: undefined }).ok, false);
  const merged = evaluateConsumerPinGate({ ...input, paired: { ...paired, state: "closed", merged: true } });
  assert.equal(merged.ok, true);
  const tampered = withConsumerFile({ ...input, consumer: paired.consumer }, CONSUMER_FILES.publishedPin, (pin) => {
    pin.payloadDigest = `sha256:${"0".repeat(64)}`;
  });
  const verdict = evaluateConsumerPinGate({ ...input, paired: { ...paired, consumer: tampered.consumer } });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.paired && !verdict.paired.ok && verdict.paired.refusal.code === "invalid_pin");
});

test("digest and source/manifest blob mismatches are refused even when the producer commit matches", () => {
  const { input } = load("main-0a9a6cbd-unchanged");
  const pinned = (edit: (pin: any) => void) => withConsumerFile(input, CONSUMER_FILES.publishedPin, edit);
  const cached = (edit: (manifest: any) => void) => withConsumerFile(input, CONSUMER_FILES.publishedManifest, edit);
  const code = (gate: GateInput) => {
    const resolution = resolveWorkerAdmission(gate.candidate, {
      published: { pin: decode(gate.consumer.files[CONSUMER_FILES.publishedPin]), manifest: decode(gate.consumer.files[CONSUMER_FILES.publishedManifest]) },
      prepared: { pin: decode(gate.consumer.files[CONSUMER_FILES.preparedPin]), manifest: decode(gate.consumer.files[CONSUMER_FILES.preparedManifest]) },
    });
    return resolution.ok ? "ok" : resolution.refusal.code;
  };
  assert.equal(code(input), "ok");
  assert.equal(code(pinned((pin) => { pin.producer.sourceBlobSha = "0".repeat(40); })), "source_blob_mismatch");
  assert.equal(code(pinned((pin) => { pin.producer.releaseManifestBlobSha = "0".repeat(40); })), "manifest_blob_mismatch");
  const otherDigest = "1".repeat(64);
  assert.equal(code(cached((manifest) => { manifest.payloadDigest = otherDigest; })), "invalid_pin");
  const both = withConsumerFile(cached((manifest) => { manifest.payloadDigest = otherDigest; }), CONSUMER_FILES.publishedPin, (pin) => { pin.payloadDigest = `sha256:${otherDigest}`; });
  assert.equal(code(both), "digest_mismatch");
  const taskForm = new TextEncoder().encode(`${new TextDecoder().decode(input.candidate.taskForm)}\n# drift\n`);
  assert.equal(code({ ...input, candidate: { ...input.candidate, taskForm } }), "corrupt_file");
});

test("a live revision matching the prepared slot selects it and never falls back to the published slot", () => {
  const { input } = load("main-0a9a6cbd-unchanged");
  const manifest = decode(input.candidate.manifest);
  manifest.revision = 23;
  const verdict = evaluateConsumerPinGate({ ...input, candidate: { ...input.candidate, manifest: encode(manifest) } });
  assert.equal(verdict.ok, false);
  assert.ok(!verdict.master.ok && verdict.master.refusal.slot === "prepared" && verdict.master.refusal.code === "commit_mismatch");
  assert.match(verdict.lines.join("\n"), /governed-intake-candidate-release\.pin\.json producer\.producerCommit = 6425de19/);
});

test("the PR-body pairing trailer is exact and names a spencer-shadley/code PR", () => {
  assert.equal(parsePairingTrailer("Summary\n\nConsumer-Pin-Pair: spencer-shadley/code#7969\n"), 7969);
  assert.equal(parsePairingTrailer("Consumer-Pin-Pair: spencer-shadley/agent-orchestrator#1"), null);
  assert.equal(parsePairingTrailer("mentions Consumer-Pin-Pair: spencer-shadley/code#1 inline"), null);
  assert.equal(parsePairingTrailer(undefined), null);
});

test("worker-rule drift detection flags a changed or missing mirrored function", () => {
  const source = "function verifyLiveManifest(value) {\n  return value;\n}\n";
  const text = extractWorkerFunction(source, "verifyLiveManifest");
  assert.equal(text, "function verifyLiveManifest(value) {\n  return value;\n}");
  const drift = workerResolutionDrift(source);
  assert.deepEqual(drift.map((entry) => entry.function).sort(),
    [...Object.keys(VENDORED_WORKER_RESOLUTION.functions), ...Object.keys(VENDORED_WORKER_RESOLUTION.declarations)].sort());
  assert.equal(drift.find((entry) => entry.function === "verifyLiveManifest")?.actual, sha256Hex(text!));
  assert.equal(drift.find((entry) => entry.function === "verifyProducerPayload")?.actual, null);
});

test("the CLI replays recorded cases with gate exit codes", () => {
  const silence = process.stdout.write;
  const lines: string[] = [];
  process.stdout.write = ((chunk: string) => { lines.push(String(chunk)); return true; }) as typeof process.stdout.write;
  try {
    assert.equal(main(["--case", "test/fixtures/consumer-pin/dotgithub-40-same-revision-republish.case.json"], () => { throw new Error("offline"); }, root), 1);
    assert.equal(main(["--case", "test/fixtures/consumer-pin/dotgithub-43-unpublished-source-change.case.json"], () => { throw new Error("offline"); }, root), 1);
    assert.equal(main(["--case", "test/fixtures/consumer-pin/main-0a9a6cbd-unchanged.case.json"], () => { throw new Error("offline"); }, root), 0);
  } finally {
    process.stdout.write = silence;
  }
  assert.match(lines.join(""), /verdict: refused/);
  assert.match(lines.join(""), /verdict: admitted/);
});

test("fingerprints cover every helper the resolution path copies, and a mutated helper or constant is drift (.github#57 review)", () => {
  assert.deepEqual(Object.keys(VENDORED_WORKER_RESOLUTION.functions).sort(),
    ["decodeProducerContent", "requireString", "resolveGovernedIntakeRuntime", "selectAdmittedRelease", "sha256Utf8", "verifyLiveManifest", "verifyProducerPayload"]);
  assert.deepEqual(Object.keys(VENDORED_WORKER_RESOLUTION.declarations).sort(), ["PRODUCER_REPOSITORY", "PRODUCER_SOURCE_PATH"]);
  // A worker-shaped source: every mirrored function and constant, so only a mutation can differ.
  const source = [
    'const PRODUCER_REPOSITORY = "spencer-shadley/.github" as const;',
    'const PRODUCER_SOURCE_PATH = "contracts/governed-intake-body.v1.json" as const;',
    ...Object.keys(VENDORED_WORKER_RESOLUTION.functions).map((name) => `export function ${name}(value: string): string {\n  return value;\n}`),
  ].join("\n");
  const recorded = fingerprintWorkerSource(source);
  assert.deepEqual(workerResolutionDrift(source, recorded), []);
  assert.equal(extractWorkerDeclaration(source, "PRODUCER_REPOSITORY"), 'const PRODUCER_REPOSITORY = "spencer-shadley/.github" as const;');
  assert.equal(recorded.declarations.PRODUCER_REPOSITORY, VENDORED_WORKER_RESOLUTION.declarations.PRODUCER_REPOSITORY, "the constant line is the worker's");
  assert.equal(recorded.declarations.PRODUCER_SOURCE_PATH, VENDORED_WORKER_RESOLUTION.declarations.PRODUCER_SOURCE_PATH);
  const helper = source.replace("export function decodeProducerContent(value: string): string {\n  return value;", "export function decodeProducerContent(value: string): string {\n  return value.trim();");
  assert.deepEqual(workerResolutionDrift(helper, recorded).map((entry) => entry.function), ["decodeProducerContent"]);
  const removed = source.replace("export function requireString(", "export function requireStringOrEmpty(");
  assert.deepEqual(workerResolutionDrift(removed, recorded).map((entry) => [entry.function, entry.actual]), [["requireString", null]]);
  const constant = source.replace('"spencer-shadley/.github" as const', '"spencer-shadley/github" as const');
  assert.deepEqual(workerResolutionDrift(constant, recorded).map((entry) => entry.function), ["PRODUCER_REPOSITORY"]);
});

test("code#8013 dual accept: a same-revision republish staged in the prepared slot is admitted there; the pinned identity still is too", () => {
  // .github#55 (r22 republished from 69809c20) against code c144fbd1, whose published slot pins d2ee7995.
  const { input } = load("dotgithub-55-paired-with-code-8014");
  const staged = input.paired!.consumer.files;
  const consumer = { ...input.consumer, files: { ...input.consumer.files,
    [CONSUMER_FILES.preparedPin]: staged[CONSUMER_FILES.publishedPin],
    [CONSUMER_FILES.preparedManifest]: staged[CONSUMER_FILES.publishedManifest] } };
  const verdict = evaluateConsumerPinGate({ ...input, consumer, pairedPullRequest: null, paired: null });
  assert.equal(verdict.outcome, "admitted");
  assert.ok(verdict.master.ok && verdict.master.slot === "prepared" && verdict.master.identity.revision === 22);
  assert.equal(verdict.master.ok && verdict.master.identity.producerCommit, "69809c201a9650fbc6d9129b2c7be03738bc83de");
  // Before the producer flip, main's old release (d2ee7995) still resolves through the published slot.
  const before = load("dotgithub-40-same-revision-republish").input;
  assert.equal(before.consumer.commit, input.consumer.commit);
  const stillPinned = resolveWorkerAdmission(input.candidate, {
    published: { pin: decode(staged[CONSUMER_FILES.publishedPin]), manifest: decode(staged[CONSUMER_FILES.publishedManifest]) },
    prepared: { pin: decode(input.consumer.files[CONSUMER_FILES.preparedPin]), manifest: decode(input.consumer.files[CONSUMER_FILES.preparedManifest]) },
  });
  assert.ok(stillPinned.ok && stillPinned.slot === "published");
});
